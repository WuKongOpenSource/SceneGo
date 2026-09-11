





from __future__ import annotations

import json
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

import asyncpg

from db_manager import get_db_manager

logger = logging.getLogger(__name__)


class CreditDAOError(Exception):
    """Base error for credit persistence operations."""


class InsufficientCreditBalance(CreditDAOError):
    """Raised when a locked account cannot cover a debit/freeze."""


class CreditAccountNotFound(CreditDAOError):
    """Raised when an account-scoped credit operation cannot find the account."""


class CreditFreezeNotFound(CreditDAOError):
    """Raised when a task has no active credit freeze to settle/release."""


def _coerce_jsonb(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


def _normalize(row: Optional[Dict[str, Any]], json_fields: tuple = ('factors', 'metadata')) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    out = dict(row)
    for k in json_fields:
        if k in out:
            out[k] = _coerce_jsonb(out[k])
    return out


async def _get_or_create_account_for_update(conn, owner_type: str, owner_id: str) -> Dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT * FROM credit_accounts
        WHERE owner_type = $1 AND owner_id = $2
        FOR UPDATE
        """,
        owner_type,
        owner_id,
    )
    if not row:
        account_id = f"acct_{uuid.uuid4().hex[:16]}"
        await conn.fetchrow(
            """
            INSERT INTO credit_accounts (account_id, owner_type, owner_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (owner_type, owner_id) DO UPDATE
              SET updated_at = CURRENT_TIMESTAMP
            RETURNING account_id
            """,
            account_id,
            owner_type,
            owner_id,
        )
        row = await conn.fetchrow(
            """
            SELECT * FROM credit_accounts
            WHERE owner_type = $1 AND owner_id = $2
            FOR UPDATE
            """,
            owner_type,
            owner_id,
        )
    if not row:
        raise CreditAccountNotFound(f"credit account not found: {owner_type}/{owner_id}")
    return _normalize(row, json_fields=())


async def _insert_credit_transaction(
    conn,
    account_id: str,
    change_type: str,
    amount: int,
    balance_before: int,
    balance_after: int,
    *,
    user_id: Optional[str] = None,
    team_id: Optional[str] = None,
    project_id: Optional[str] = None,
    task_id: Optional[str] = None,
    feature_key: Optional[str] = None,
    rule_version: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    operated_by: Optional[str] = None,
    operation_reason: Optional[str] = None,
) -> Dict[str, Any]:
    txn_id = f"txn_{uuid.uuid4().hex[:16]}"
    try:
        # The managed schema includes operated_by/operation_reason. A nested
        # transaction gives older schemas a savepoint so the fallback does not
        # poison the outer ledger transaction.
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                INSERT INTO credit_transactions (
                    transaction_id, account_id, user_id, team_id, project_id,
                    task_id, feature_key, change_type, amount,
                    balance_before, balance_after, rule_version, metadata,
                    operated_by, operation_reason
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)
                RETURNING *
                """,
                txn_id,
                account_id,
                user_id,
                team_id,
                project_id,
                task_id,
                feature_key,
                change_type,
                amount,
                balance_before,
                balance_after,
                rule_version,
                json.dumps(metadata or {}),
                operated_by,
                operation_reason,
            )
    except asyncpg.UndefinedColumnError:
        meta = dict(metadata or {})
        if operated_by:
            meta['operated_by'] = operated_by
        if operation_reason:
            meta['operation_reason'] = operation_reason
        row = await conn.fetchrow(
            """
            INSERT INTO credit_transactions (
                transaction_id, account_id, user_id, team_id, project_id,
                task_id, feature_key, change_type, amount,
                balance_before, balance_after, rule_version, metadata
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
            RETURNING *
            """,
            txn_id,
            account_id,
            user_id,
            team_id,
            project_id,
            task_id,
            feature_key,
            change_type,
            amount,
            balance_before,
            balance_after,
            rule_version,
            json.dumps(meta),
        )
    return _normalize(row, json_fields=('metadata',))


class CreditAccountDAO:

    @staticmethod
    async def get_or_create(owner_type: str, owner_id: str) -> Dict[str, Any]:

        db = get_db_manager()
        row = await db.fetchrow(
            "SELECT * FROM credit_accounts WHERE owner_type = $1 AND owner_id = $2",
            owner_type, owner_id,
        )
        if row:
            return await CreationPointDAO.expire_available_gifts(owner_type, owner_id)
        account_id = f"acct_{uuid.uuid4().hex[:16]}"
        row = await db.fetchrow(
            """
            INSERT INTO credit_accounts (account_id, owner_type, owner_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (owner_type, owner_id) DO UPDATE
              SET updated_at = CURRENT_TIMESTAMP
            RETURNING *
            """,
            account_id, owner_type, owner_id,
        )
        return await CreationPointDAO.expire_available_gifts(owner_type, owner_id)

    @staticmethod
    async def get(account_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow(
            "SELECT * FROM credit_accounts WHERE account_id = $1", account_id,
        )
        return _normalize(row, json_fields=())

    @staticmethod
    async def adjust_balances(
        account_id: str,
        *,
        available_delta: int = 0,
        frozen_delta: int = 0,
        used_delta: int = 0,
    ) -> Dict[str, Any]:

        db = get_db_manager()
        row = await db.fetchrow(
            """
            UPDATE credit_accounts
               SET available_credits = available_credits + $2,
                   frozen_credits    = frozen_credits    + $3,
                   total_used_credits = total_used_credits + $4
             WHERE account_id = $1
             RETURNING *
            """,
            account_id, available_delta, frozen_delta, used_delta,
        )
        return _normalize(row, json_fields=())

    @staticmethod
    async def list_all(
        *,
        limit: int = 50,
        offset: int = 0,
        search: Optional[str] = None,
    ) -> List[Dict[str, Any]]:

        db = get_db_manager()
        where = ["TRUE"]
        params: List[Any] = []
        idx = 1
        if search:
            where.append(f"(ca.owner_id ILIKE ${idx} OR u.username ILIKE ${idx})")
            params.append(f"%{search}%"); idx += 1
        params.extend([limit, offset])
        try:
            rows = await db.fetch(
                f"""
                SELECT ca.*, u.username AS owner_username, u.email AS owner_email
                FROM credit_accounts ca
                LEFT JOIN users u ON u.user_id = ca.owner_id AND ca.owner_type = 'user'
                WHERE {' AND '.join(where)}
                ORDER BY ca.created_at DESC
                LIMIT ${idx} OFFSET ${idx + 1}
                """,
                *params,
            )
            return [_normalize(r, json_fields=()) for r in rows]
        except Exception:

            rows = await db.fetch(
                """
                SELECT * FROM credit_accounts
                ORDER BY created_at DESC
                LIMIT $1 OFFSET $2
                """,
                limit, offset,
            )
            return [_normalize(r, json_fields=()) for r in rows]


class CreationPointDAO:
    """Permanent account points plus gift points that expire at a fixed instant."""

    @staticmethod
    def _is_expired(account: Dict[str, Any]) -> bool:
        expires_at = account.get('gift_expires_at')
        if not expires_at or int(account.get('gift_credits') or 0) <= 0:
            return False
        if getattr(expires_at, 'tzinfo', None) is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        return expires_at <= datetime.now(timezone.utc)

    @staticmethod
    async def _expire_locked(conn, account: Dict[str, Any]) -> Dict[str, Any]:
        if not CreationPointDAO._is_expired(account):
            return account
        amount = int(account.get('gift_credits') or 0)
        balance_before = int(account.get('available_credits') or 0)
        updated = await conn.fetchrow(
            """
            UPDATE credit_accounts
            SET available_credits = available_credits - gift_credits,
                gift_credits = 0,
                gift_expires_at = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE account_id = $1
            RETURNING *
            """,
            account['account_id'],
        )
        await _insert_credit_transaction(
            conn,
            account['account_id'],
            change_type='expire',
            amount=amount,
            balance_before=balance_before,
            balance_after=balance_before - amount,
            user_id=account['owner_id'] if account.get('owner_type') == 'user' else None,
            team_id=account['owner_id'] if account.get('owner_type') == 'team' else None,
            metadata={
                'point_bucket': 'gift',
                'expired_at': datetime.now(timezone.utc).isoformat(),
            },
        )
        return _normalize(updated, json_fields=())

    @staticmethod
    async def expire_available_gifts(owner_type: str, owner_id: str) -> Dict[str, Any]:
        db = get_db_manager()
        async with db.acquire() as conn:
            async with conn.transaction():
                account = await _get_or_create_account_for_update(conn, owner_type, owner_id)
                return await CreationPointDAO._expire_locked(conn, account)

    @staticmethod
    async def get_daily_grant_streak(
        user_id: str,
        *,
        before_date: date,
        lookback_days: int = 31,
    ) -> int:
        """Count consecutive claim days ending immediately before before_date."""
        db = get_db_manager()
        rows = await db.fetch(
            """
            SELECT grant_date
            FROM daily_creation_point_grants
            WHERE user_id=$1 AND grant_date < $2
            ORDER BY grant_date DESC
            LIMIT $3
            """,
            user_id,
            before_date,
            max(1, min(int(lookback_days), 366)),
        )
        expected = before_date - timedelta(days=1)
        streak = 0
        for row in rows:
            grant_date = row['grant_date']
            if grant_date != expected:
                break
            streak += 1
            expected -= timedelta(days=1)
        return streak

    @staticmethod
    async def grant_daily_gift(
        user_id: str,
        *,
        grant_date: date,
        amount: int,
        expires_at: datetime,
        grant_policy: str = 'standard',
    ) -> Dict[str, Any]:
        if amount < 10 or amount > 50:
            raise CreditDAOError("daily gift must be between 10 and 50 points")
        db = get_db_manager()
        async with db.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
                    f"daily-creation-points:{user_id}:{grant_date.isoformat()}",
                )
                account = await _get_or_create_account_for_update(conn, 'user', user_id)
                account = await CreationPointDAO._expire_locked(conn, account)
                grant = await conn.fetchrow(
                    """
                    INSERT INTO daily_creation_point_grants (user_id, grant_date, amount, expires_at)
                    VALUES ($1,$2,$3,$4)
                    ON CONFLICT (user_id, grant_date) DO NOTHING
                    RETURNING *
                    """,
                    user_id,
                    grant_date,
                    amount,
                    expires_at,
                )
                if not grant:
                    existing = await conn.fetchrow(
                        """
                        SELECT * FROM daily_creation_point_grants
                        WHERE user_id=$1 AND grant_date=$2
                        """,
                        user_id,
                        grant_date,
                    )
                    return {
                        'granted': False,
                        'amount': int(existing['amount'] or 0) if existing else 0,
                        'expires_at': existing['expires_at'] if existing else expires_at,
                        'account': account,
                    }

                balance_before = int(account.get('available_credits') or 0)
                updated = await conn.fetchrow(
                    """
                    UPDATE credit_accounts
                    SET available_credits = available_credits + $2,
                        gift_credits = gift_credits + $2,
                        gift_expires_at = $3,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE account_id = $1
                    RETURNING *
                    """,
                    account['account_id'],
                    amount,
                    expires_at,
                )
                await _insert_credit_transaction(
                    conn,
                    account['account_id'],
                    change_type='gift',
                    amount=amount,
                    balance_before=balance_before,
                    balance_after=balance_before + amount,
                    user_id=user_id,
                    metadata={
                        'source': 'daily_login',
                        'point_bucket': 'gift',
                        'grant_policy': grant_policy,
                        'grant_date': grant_date.isoformat(),
                        'expires_at': expires_at.isoformat(),
                    },
                )
                return {
                    'granted': True,
                    'amount': amount,
                    'expires_at': expires_at,
                    'account': _normalize(updated, json_fields=()),
                }


class CreditLedgerDAO:
    """Transactional credit ledger operations across account/freeze/transaction tables."""

    @staticmethod
    async def freeze_credits(
        owner_type: str,
        owner_id: str,
        *,
        feature_key: str,
        amount: int,
        task_id: Optional[str] = None,
        rule_version: Optional[str] = None,
        project_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        async with db.acquire() as conn:
            async with conn.transaction():
                if task_id:
                    # Serialize retries for the same task before touching an account.
                    # This makes task submission idempotent even when two requests
                    # arrive before either one has committed its freeze.
                    await conn.execute(
                        "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
                        task_id,
                    )
                    existing_row = await conn.fetchrow(
                        """
                        SELECT f.*, a.owner_type AS freeze_owner_type,
                               a.owner_id AS freeze_owner_id,
                               a.available_credits, a.frozen_credits,
                               a.account_credits, a.gift_credits,
                               a.frozen_account_credits, a.frozen_gift_credits,
                               a.gift_expires_at AS account_gift_expires_at,
                               a.total_used_credits, a.created_at AS account_created_at,
                               a.updated_at AS account_updated_at
                        FROM credit_freezes f
                        JOIN credit_accounts a ON a.account_id = f.account_id
                        WHERE f.task_id = $1 AND f.status = 'frozen'
                        ORDER BY f.created_at DESC
                        LIMIT 1
                        FOR UPDATE OF f, a
                        """,
                        task_id,
                    )
                    if existing_row:
                        existing = dict(existing_row)
                        if (
                            str(existing.get('freeze_owner_type') or '') != owner_type
                            or str(existing.get('freeze_owner_id') or '') != owner_id
                            or str(existing.get('feature_key') or '') != feature_key
                            or int(existing.get('amount') or 0) != amount
                        ):
                            raise CreditDAOError(
                                f"Conflicting active credit freeze for task_id={task_id}"
                            )
                        transaction_row = await conn.fetchrow(
                            """
                            SELECT * FROM credit_transactions
                            WHERE task_id = $1 AND change_type = 'freeze'
                            ORDER BY created_at DESC
                            LIMIT 1
                            """,
                            task_id,
                        )
                        account = {
                            'account_id': existing['account_id'],
                            'owner_type': existing['freeze_owner_type'],
                            'owner_id': existing['freeze_owner_id'],
                            'available_credits': existing['available_credits'],
                            'frozen_credits': existing['frozen_credits'],
                            'account_credits': existing.get('account_credits', 0),
                            'gift_credits': existing.get('gift_credits', 0),
                            'frozen_account_credits': existing.get('frozen_account_credits', 0),
                            'frozen_gift_credits': existing.get('frozen_gift_credits', 0),
                            'gift_expires_at': existing.get('account_gift_expires_at'),
                            'total_used_credits': existing['total_used_credits'],
                            'created_at': existing.get('account_created_at'),
                            'updated_at': existing.get('account_updated_at'),
                        }
                        transaction = _normalize(transaction_row, json_fields=('metadata',))
                        balance_before = int(
                            (transaction or {}).get('balance_before')
                            if transaction and transaction.get('balance_before') is not None
                            else int(account['available_credits'] or 0) + amount
                        )
                        balance_after = int(
                            (transaction or {}).get('balance_after')
                            if transaction and transaction.get('balance_after') is not None
                            else account['available_credits'] or 0
                        )
                        freeze = {
                            key: value
                            for key, value in existing.items()
                            if not key.startswith('freeze_owner_')
                            and key not in {
                                'available_credits', 'frozen_credits', 'total_used_credits',
                                'account_credits', 'gift_credits',
                                'frozen_account_credits', 'frozen_gift_credits',
                                'account_gift_expires_at',
                                'account_created_at', 'account_updated_at',
                            }
                        }
                        return {
                            'freeze': freeze,
                            'transaction': transaction,
                            'account': account,
                            'freeze_id': freeze['freeze_id'],
                            'account_id': freeze['account_id'],
                            'balance_before': balance_before,
                            'balance_after': balance_after,
                            'frozen_after': int(account['frozen_credits'] or 0),
                            'idempotent': True,
                        }

                account_row = await _get_or_create_account_for_update(conn, owner_type, owner_id)
                account_row = await CreationPointDAO._expire_locked(conn, account_row)
                available = int(account_row['available_credits'] or 0)
                if available < amount:
                    raise InsufficientCreditBalance(
                        f"Insufficient credits: need {amount}, available {available}"
                    )

                balance_before = available
                balance_after = available - amount
                gift_amount = min(int(account_row.get('gift_credits') or 0), amount)
                account_amount = amount - gift_amount
                updated_account = await conn.fetchrow(
                    """
                    UPDATE credit_accounts
                    SET available_credits = available_credits - $2,
                        frozen_credits    = frozen_credits + $2,
                        account_credits  = account_credits - $3,
                        gift_credits     = gift_credits - $4,
                        frozen_account_credits = frozen_account_credits + $3,
                        frozen_gift_credits = frozen_gift_credits + $4,
                        updated_at        = CURRENT_TIMESTAMP
                    WHERE account_id = $1
                    RETURNING *
                    """,
                    account_row['account_id'],
                    amount,
                    account_amount,
                    gift_amount,
                )

                freeze_id = f"frz_{uuid.uuid4().hex[:16]}"
                freeze_row = await conn.fetchrow(
                    """
                    INSERT INTO credit_freezes (
                        freeze_id, account_id, task_id, feature_key, amount, rule_version, status,
                        account_amount, gift_amount, gift_expires_at
                    ) VALUES ($1,$2,$3,$4,$5,$6,'frozen',$7,$8,$9)
                    RETURNING *
                    """,
                    freeze_id,
                    account_row['account_id'],
                    task_id,
                    feature_key,
                    amount,
                    rule_version,
                    account_amount,
                    gift_amount,
                    account_row.get('gift_expires_at'),
                )
                transaction_row = await _insert_credit_transaction(
                    conn,
                    account_row['account_id'],
                    change_type='freeze',
                    amount=amount,
                    balance_before=balance_before,
                    balance_after=balance_after,
                    user_id=owner_id if owner_type == 'user' else None,
                    team_id=owner_id if owner_type == 'team' else None,
                    project_id=project_id,
                    task_id=task_id,
                    feature_key=feature_key,
                    rule_version=rule_version,
                    metadata={
                        **(metadata or {}),
                        'point_allocation': {'gift': gift_amount, 'account': account_amount},
                    },
                )

        updated_account = _normalize(updated_account, json_fields=())
        freeze = dict(freeze_row)
        return {
            'freeze': freeze,
            'transaction': transaction_row,
            'account': updated_account,
            'freeze_id': freeze['freeze_id'],
            'account_id': account_row['account_id'],
            'balance_before': balance_before,
            'balance_after': balance_after,
            'frozen_after': int(updated_account['frozen_credits'] or 0),
            'idempotent': False,
        }

    @staticmethod
    async def confirm_task_freeze(
        task_id: str,
        final_amount: int,
        *,
        operator: Optional[str] = None,
        project_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        async with db.acquire() as conn:
            async with conn.transaction():
                freeze_row = await conn.fetchrow(
                    """
                    SELECT * FROM credit_freezes
                    WHERE task_id = $1 AND status = 'frozen'
                    ORDER BY created_at DESC
                    LIMIT 1
                    FOR UPDATE
                    """,
                    task_id,
                )
                if not freeze_row:
                    raise CreditFreezeNotFound(f"No active credit freeze for task_id={task_id}")

                freeze = dict(freeze_row)
                account_id = freeze['account_id']
                frozen_amount = int(freeze['amount'] or 0)
                if final_amount > frozen_amount:
                    raise CreditDAOError(
                        f"Final credit amount {final_amount} exceeds frozen amount {frozen_amount}"
                    )
                refund = frozen_amount - final_amount
                gift_reserved = int(freeze.get('gift_amount') or 0)
                account_reserved = int(freeze.get('account_amount') or (frozen_amount - gift_reserved))
                gift_consumed = min(gift_reserved, final_amount)
                account_consumed = final_amount - gift_consumed
                gift_refund = gift_reserved - gift_consumed
                account_refund = account_reserved - account_consumed
                gift_expiry = freeze.get('gift_expires_at')
                if gift_expiry and getattr(gift_expiry, 'tzinfo', None) is None:
                    gift_expiry = gift_expiry.replace(tzinfo=timezone.utc)
                gift_refund_expired = bool(
                    gift_refund > 0 and gift_expiry and gift_expiry <= datetime.now(timezone.utc)
                )
                valid_gift_refund = 0 if gift_refund_expired else gift_refund
                restored_amount = account_refund + valid_gift_refund

                account_row = await conn.fetchrow(
                    "SELECT * FROM credit_accounts WHERE account_id = $1 FOR UPDATE",
                    account_id,
                )
                if not account_row:
                    raise CreditAccountNotFound(f"credit account not found: {account_id}")
                balance_before = int(account_row['available_credits'] or 0)
                updated_account = await conn.fetchrow(
                    """
                    UPDATE credit_accounts
                    SET available_credits = available_credits + $2,
                        frozen_credits    = frozen_credits - $3,
                        total_used_credits = total_used_credits + $4,
                        account_credits = account_credits + $5,
                        gift_credits = gift_credits + $6,
                        frozen_account_credits = frozen_account_credits - $7,
                        frozen_gift_credits = frozen_gift_credits - $8,
                        updated_at        = CURRENT_TIMESTAMP
                    WHERE account_id = $1
                    RETURNING *
                    """,
                    account_id,
                    restored_amount,
                    frozen_amount,
                    final_amount,
                    account_refund,
                    valid_gift_refund,
                    account_reserved,
                    gift_reserved,
                )
                balance_after = balance_before + restored_amount

                await conn.execute(
                    """
                    UPDATE credit_freezes
                    SET status = 'settled', released_at = CURRENT_TIMESTAMP
                    WHERE freeze_id = $1
                    """,
                    freeze['freeze_id'],
                )

                release_txn = None
                consume_txn = None
                if restored_amount > 0:
                    release_txn = await _insert_credit_transaction(
                        conn,
                        account_id,
                        change_type='release',
                        amount=restored_amount,
                        balance_before=balance_before,
                        balance_after=balance_after,
                        user_id=account_row['owner_id'] if account_row['owner_type'] == 'user' else None,
                        project_id=project_id,
                        task_id=task_id,
                        feature_key=freeze.get('feature_key'),
                        rule_version=freeze.get('rule_version'),
                        metadata={
                            **(metadata or {}),
                            'point_allocation': {
                                'gift': valid_gift_refund,
                                'account': account_refund,
                            },
                        },
                        operated_by=operator,
                    )

                if final_amount > 0:
                    consume_txn = await _insert_credit_transaction(
                        conn,
                        account_id,
                        change_type='consume',
                        amount=final_amount,
                        balance_before=balance_after,
                        balance_after=balance_after,
                        user_id=account_row['owner_id'] if account_row['owner_type'] == 'user' else None,
                        project_id=project_id,
                        task_id=task_id,
                        feature_key=freeze.get('feature_key'),
                        rule_version=freeze.get('rule_version'),
                        metadata={
                            **(metadata or {}),
                            'point_allocation': {
                                'gift': gift_consumed,
                                'account': account_consumed,
                            },
                        },
                        operated_by=operator,
                    )

                if gift_refund_expired:
                    await _insert_credit_transaction(
                        conn,
                        account_id,
                        change_type='expire',
                        amount=gift_refund,
                        balance_before=balance_after,
                        balance_after=balance_after,
                        user_id=account_row['owner_id'] if account_row['owner_type'] == 'user' else None,
                        project_id=project_id,
                        task_id=task_id,
                        feature_key=freeze.get('feature_key'),
                        metadata={
                            'point_bucket': 'gift',
                            'source': 'expired_frozen_refund',
                        },
                        operated_by=operator,
                    )

        return {
            'task_id': task_id,
            'account_id': account_id,
            'account': _normalize(updated_account, json_fields=()),
            'freeze': freeze,
            'release_transaction': release_txn,
            'consume_transaction': consume_txn,
            'frozen_amount': frozen_amount,
            'final_amount': final_amount,
            'refund': restored_amount,
            'expired_refund': gift_refund if gift_refund_expired else 0,
            'balance_before': balance_before,
            'balance_after': balance_after,
        }

    @staticmethod
    async def release_task_freeze(
        task_id: str,
        *,
        operator: Optional[str] = None,
        reason: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        async with db.acquire() as conn:
            async with conn.transaction():
                freeze_row = await conn.fetchrow(
                    """
                    SELECT * FROM credit_freezes
                    WHERE task_id = $1 AND status = 'frozen'
                    ORDER BY created_at DESC
                    LIMIT 1
                    FOR UPDATE
                    """,
                    task_id,
                )
                if not freeze_row:
                    return None

                freeze = dict(freeze_row)
                account_id = freeze['account_id']
                amount = int(freeze['amount'] or 0)
                gift_amount = int(freeze.get('gift_amount') or 0)
                account_amount = int(freeze.get('account_amount') or (amount - gift_amount))
                gift_expiry = freeze.get('gift_expires_at')
                if gift_expiry and getattr(gift_expiry, 'tzinfo', None) is None:
                    gift_expiry = gift_expiry.replace(tzinfo=timezone.utc)
                gift_expired = bool(gift_amount and gift_expiry and gift_expiry <= datetime.now(timezone.utc))
                restored_gift = 0 if gift_expired else gift_amount
                restored_amount = account_amount + restored_gift
                account_row = await conn.fetchrow(
                    "SELECT * FROM credit_accounts WHERE account_id = $1 FOR UPDATE",
                    account_id,
                )
                if not account_row:
                    raise CreditAccountNotFound(f"credit account not found: {account_id}")
                balance_before = int(account_row['available_credits'] or 0)
                updated_account = await conn.fetchrow(
                    """
                    UPDATE credit_accounts
                    SET available_credits = available_credits + $2,
                        frozen_credits    = frozen_credits - $3,
                        account_credits  = account_credits + $4,
                        gift_credits     = gift_credits + $5,
                        frozen_account_credits = frozen_account_credits - $4,
                        frozen_gift_credits = frozen_gift_credits - $6,
                        updated_at        = CURRENT_TIMESTAMP
                    WHERE account_id = $1
                    RETURNING *
                    """,
                    account_id,
                    restored_amount,
                    amount,
                    account_amount,
                    restored_gift,
                    gift_amount,
                )
                balance_after = balance_before + restored_amount

                await conn.execute(
                    """
                    UPDATE credit_freezes
                    SET status = 'released', released_at = CURRENT_TIMESTAMP
                    WHERE freeze_id = $1
                    """,
                    freeze['freeze_id'],
                )

                transaction_row = None
                if restored_amount > 0:
                    transaction_row = await _insert_credit_transaction(
                        conn,
                        account_id,
                        change_type='release',
                        amount=restored_amount,
                        balance_before=balance_before,
                        balance_after=balance_after,
                        user_id=account_row['owner_id'] if account_row['owner_type'] == 'user' else None,
                        project_id=project_id,
                        task_id=task_id,
                        feature_key=freeze.get('feature_key'),
                        rule_version=freeze.get('rule_version'),
                        metadata={
                            **({'reason': reason} if reason else {}),
                            'point_allocation': {'gift': restored_gift, 'account': account_amount},
                        },
                        operated_by=operator,
                    )

                if gift_expired:
                    await _insert_credit_transaction(
                        conn,
                        account_id,
                        change_type='expire',
                        amount=gift_amount,
                        balance_before=balance_after,
                        balance_after=balance_after,
                        user_id=account_row['owner_id'] if account_row['owner_type'] == 'user' else None,
                        project_id=project_id,
                        task_id=task_id,
                        feature_key=freeze.get('feature_key'),
                        metadata={
                            'point_bucket': 'gift',
                            'source': 'expired_frozen_release',
                            **({'reason': reason} if reason else {}),
                        },
                        operated_by=operator,
                    )

        return {
            'task_id': task_id,
            'account_id': account_id,
            'account': _normalize(updated_account, json_fields=()),
            'freeze': freeze,
            'transaction': transaction_row,
            'amount': restored_amount,
            'expired_amount': gift_amount if gift_expired else 0,
            'balance_before': balance_before,
            'balance_after': balance_after,
        }

    @staticmethod
    async def admin_adjust_account(
        account_id: str,
        *,
        amount: int,
        reason: str,
        operator: str,
        feature_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        async with db.acquire() as conn:
            async with conn.transaction():
                account_row = await conn.fetchrow(
                    "SELECT * FROM credit_accounts WHERE account_id = $1 FOR UPDATE",
                    account_id,
                )
                if not account_row:
                    raise CreditAccountNotFound(f"credit account not found: {account_id}")

                balance_before = int(account_row['available_credits'] or 0)
                balance_after = balance_before + amount
                account_points_before = int(account_row.get('account_credits') or 0)
                if balance_after < 0 or account_points_before + amount < 0:
                    raise InsufficientCreditBalance(
                        f"Account-point adjustment would make balance negative (before={account_points_before}, delta={amount})"
                    )

                updated_account = await conn.fetchrow(
                    """
                    UPDATE credit_accounts
                    SET available_credits = available_credits + $2,
                        account_credits   = account_credits + $2,
                        updated_at        = CURRENT_TIMESTAMP
                    WHERE account_id = $1
                    RETURNING *
                    """,
                    account_id,
                    amount,
                )

                change_type = 'admin_credit' if amount > 0 else 'admin_debit'
                transaction_row = await _insert_credit_transaction(
                    conn,
                    account_id,
                    change_type=change_type,
                    amount=abs(amount),
                    balance_before=balance_before,
                    balance_after=balance_after,
                    user_id=account_row['owner_id'] if account_row['owner_type'] == 'user' else None,
                    feature_key=feature_key,
                    metadata={'reason': reason},
                    operated_by=operator,
                    operation_reason=reason,
                )

        return {
            'account_id': account_id,
            'account': _normalize(updated_account, json_fields=()),
            'transaction': transaction_row,
            'amount': amount,
            'balance_before': balance_before,
            'balance_after': balance_after,
        }


class CreditRuleDAO:

    @staticmethod
    async def get_by_feature(feature_key: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow(
            """
            SELECT * FROM credit_rules
            WHERE feature_key = $1 AND enabled = TRUE
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            feature_key,
        )
        return _normalize(row)

    @staticmethod
    async def get(rule_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow("SELECT * FROM credit_rules WHERE rule_id = $1", rule_id)
        return _normalize(row)

    @staticmethod
    async def list_all(only_enabled: bool = False) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if only_enabled:
            rows = await db.fetch(
                "SELECT * FROM credit_rules WHERE enabled = TRUE ORDER BY feature_key",
            )
        else:
            rows = await db.fetch(
                "SELECT * FROM credit_rules ORDER BY feature_key",
            )
        return [_normalize(r) for r in rows]

    @staticmethod
    async def create(
        feature_key: str,
        feature_name: str,
        base_cost: int,
        *,
        rule_id: Optional[str] = None,
        billing_unit: str = 'task',
        factors: Optional[List[Dict[str, Any]]] = None,
        min_cost: int = 0,
        max_cost: Optional[int] = None,
        enabled: bool = True,
        rule_version: Optional[str] = None,
        description: str = '',
    ) -> Dict[str, Any]:
        db = get_db_manager()
        rid = rule_id or f"rule_{uuid.uuid4().hex[:16]}"
        ver = rule_version or '2026-05-26-001'
        row = await db.fetchrow(
            """
            INSERT INTO credit_rules (
                rule_id, feature_key, feature_name, enabled, base_cost, billing_unit,
                factors, min_cost, max_cost, rule_version, description
            ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
            RETURNING *
            """,
            rid, feature_key, feature_name, enabled, base_cost, billing_unit,
            json.dumps(factors or []), min_cost, max_cost, ver, description,
        )
        return _normalize(row)

    @staticmethod
    async def update(rule_id: str, fields: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return await CreditRuleDAO._update_fields(get_db_manager(), rule_id, fields)

    @staticmethod
    async def update_validated(
        rule_id: str, validate_patch: Callable[[Dict[str, Any]], Dict[str, Any]],
    ) -> tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
        """Validate against the locked current rule and retain its audit snapshot.

        Reading bounds before acquiring the lock lets two individually valid
        patches produce an invalid min/max pair. The synchronous validator runs
        inside the transaction; a rejection rolls back without changing policy.
        """
        async with get_db_manager().acquire() as conn:
            async with conn.transaction():
                before = _normalize(await conn.fetchrow(
                    'SELECT * FROM credit_rules WHERE rule_id=$1 FOR UPDATE', rule_id,
                ))
                if before is None:
                    return None, None
                fields = validate_patch(before)
                return before, await CreditRuleDAO._update_fields(conn, rule_id, fields)

    @staticmethod
    async def _update_fields(conn, rule_id: str, fields: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        allowed = {
            'feature_key', 'feature_name', 'enabled', 'base_cost', 'billing_unit',
            'factors', 'min_cost', 'max_cost', 'rule_version', 'description',
        }
        sets = []
        params: List[Any] = []
        idx = 1
        for k, v in fields.items():
            if k not in allowed:
                continue
            if k == 'factors':
                sets.append(f"{k} = ${idx}::jsonb")
                params.append(json.dumps(v or []))
            else:
                sets.append(f"{k} = ${idx}")
                params.append(v)
            idx += 1
        if not sets:
            return _normalize(await conn.fetchrow('SELECT * FROM credit_rules WHERE rule_id=$1', rule_id))
        params.append(rule_id)
        row = await conn.fetchrow(
            f"UPDATE credit_rules SET {', '.join(sets)} WHERE rule_id = ${idx} RETURNING *",
            *params,
        )
        return _normalize(row)

    @staticmethod
    async def delete(rule_id: str) -> Optional[Dict[str, Any]]:
        """Return only the row actually removed, for race-safe success auditing."""
        db = get_db_manager()
        return _normalize(await db.fetchrow('DELETE FROM credit_rules WHERE rule_id=$1 RETURNING *', rule_id))


class CreditFreezeDAO:

    @staticmethod
    async def create(
        account_id: str,
        amount: int,
        *,
        task_id: Optional[str] = None,
        feature_key: Optional[str] = None,
        rule_version: Optional[str] = None,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        fid = f"frz_{uuid.uuid4().hex[:16]}"
        row = await db.fetchrow(
            """
            INSERT INTO credit_freezes (
                freeze_id, account_id, task_id, feature_key, amount, rule_version, status
            ) VALUES ($1,$2,$3,$4,$5,$6,'frozen')
            RETURNING *
            """,
            fid, account_id, task_id, feature_key, amount, rule_version,
        )
        return dict(row)

    @staticmethod
    async def get_active_for_task(task_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow(
            """
            SELECT * FROM credit_freezes
            WHERE task_id = $1 AND status = 'frozen'
            ORDER BY created_at DESC LIMIT 1
            """,
            task_id,
        )
        return dict(row) if row else None

    @staticmethod
    async def mark_status(freeze_id: str, status: str) -> None:
        db = get_db_manager()
        await db.execute(
            """
            UPDATE credit_freezes
            SET status = $2, released_at = CURRENT_TIMESTAMP
            WHERE freeze_id = $1
            """,
            freeze_id, status,
        )


class CreditTransactionDAO:

    @staticmethod
    async def get_consumption_for_task(
        task_id: str,
        *,
        owner_type: str,
        owner_id: str,
        feature_key: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        params: List[Any] = [task_id, owner_type, owner_id]
        feature_clause = ''
        if feature_key:
            params.append(feature_key)
            feature_clause = 'AND ct.feature_key = $4'
        row = await db.fetchrow(
            f"""
            SELECT ct.* FROM credit_transactions ct
            JOIN credit_accounts ca ON ca.account_id = ct.account_id
            WHERE ct.task_id = $1
              AND ca.owner_type = $2
              AND ca.owner_id = $3
              AND ct.change_type = 'consume'
              {feature_clause}
            ORDER BY ct.created_at DESC
            LIMIT 1
            """,
            *params,
        )
        return _normalize(row, json_fields=('metadata',))

    @staticmethod
    async def create(
        account_id: str,
        change_type: str,
        amount: int,
        balance_before: int,
        balance_after: int,
        *,
        user_id: Optional[str] = None,
        team_id: Optional[str] = None,
        project_id: Optional[str] = None,
        task_id: Optional[str] = None,
        feature_key: Optional[str] = None,
        rule_version: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        operated_by: Optional[str] = None,
        operation_reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        txn_id = f"txn_{uuid.uuid4().hex[:16]}"


        try:
            row = await db.fetchrow(
                """
                INSERT INTO credit_transactions (
                    transaction_id, account_id, user_id, team_id, project_id,
                    task_id, feature_key, change_type, amount,
                    balance_before, balance_after, rule_version, metadata,
                    operated_by, operation_reason
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)
                RETURNING *
                """,
                txn_id, account_id, user_id, team_id, project_id,
                task_id, feature_key, change_type, amount,
                balance_before, balance_after, rule_version, json.dumps(metadata or {}),
                operated_by, operation_reason,
            )
        except Exception:
            meta = dict(metadata or {})
            if operated_by:
                meta['operated_by'] = operated_by
            if operation_reason:
                meta['operation_reason'] = operation_reason
            row = await db.fetchrow(
                """
                INSERT INTO credit_transactions (
                    transaction_id, account_id, user_id, team_id, project_id,
                    task_id, feature_key, change_type, amount,
                    balance_before, balance_after, rule_version, metadata
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
                RETURNING *
                """,
                txn_id, account_id, user_id, team_id, project_id,
                task_id, feature_key, change_type, amount,
                balance_before, balance_after, rule_version, json.dumps(meta),
            )
        return _normalize(row, json_fields=('metadata',))

    @staticmethod
    async def list_for_user(
        user_id: str,
        *,
        feature_key: Optional[str] = None,
        change_type: Optional[str] = None,
        from_dt: Optional[str] = None,
        to_dt: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        where = ["user_id = $1"]
        params: List[Any] = [user_id]
        idx = 2
        if feature_key:
            where.append(f"feature_key = ${idx}"); params.append(feature_key); idx += 1
        if change_type:
            where.append(f"change_type = ${idx}"); params.append(change_type); idx += 1
        if from_dt:
            where.append(f"created_at >= ${idx}"); params.append(from_dt); idx += 1
        if to_dt:
            where.append(f"created_at <= ${idx}"); params.append(to_dt); idx += 1
        params.extend([limit, offset])
        db = get_db_manager()
        rows = await db.fetch(
            f"""
            SELECT * FROM credit_transactions
            WHERE {' AND '.join(where)}
            ORDER BY created_at DESC
            LIMIT ${idx} OFFSET ${idx + 1}
            """,
            *params,
        )
        return [_normalize(r, json_fields=('metadata',)) for r in rows]

    @staticmethod
    async def list_admin(
        *,
        user_id: Optional[str] = None,
        feature_key: Optional[str] = None,
        change_type: Optional[str] = None,
        tx_type: Optional[str] = None,            # alias for change_type
        operated_by: Optional[str] = None,
        business_type: Optional[str] = None,      # alias for feature_key
        from_dt: Optional[str] = None,
        to_dt: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        where = ["TRUE"]
        params: List[Any] = []
        idx = 1
        if user_id:
            where.append(f"user_id = ${idx}"); params.append(user_id); idx += 1
        if feature_key or business_type:
            where.append(f"feature_key = ${idx}")
            params.append(feature_key or business_type); idx += 1
        if change_type or tx_type:
            where.append(f"change_type = ${idx}")
            params.append(change_type or tx_type); idx += 1
        if operated_by:

            where.append(f"operated_by = ${idx}")
            params.append(operated_by); idx += 1
        if from_dt:
            where.append(f"created_at >= ${idx}"); params.append(from_dt); idx += 1
        if to_dt:
            where.append(f"created_at <= ${idx}"); params.append(to_dt); idx += 1
        params.extend([limit, offset])
        db = get_db_manager()
        try:
            rows = await db.fetch(
                f"""
                SELECT * FROM credit_transactions
                WHERE {' AND '.join(where)}
                ORDER BY created_at DESC
                LIMIT ${idx} OFFSET ${idx + 1}
                """,
                *params,
            )
        except Exception:

            if operated_by:
                return []
            raise
        return [_normalize(r, json_fields=('metadata',)) for r in rows]
