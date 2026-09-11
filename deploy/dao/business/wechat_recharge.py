"""Persistence boundary for WeChat creation-point recharge orders.

The payment service owns provider verification and lifecycle orchestration;
this DAO owns order storage and the atomic permanent-point credit transaction.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any, Callable, Dict, Mapping, Optional

from db_manager import get_db_manager
from dao.business.credit import CreationPointDAO, _get_or_create_account_for_update


class RechargeOrderNotFound(Exception):
    """Raised when a provider transaction has no matching local order."""


class RechargeTransactionConflict(Exception):
    """Raised when a paid order is replayed with a different transaction ID."""


class RechargeOrderStateError(Exception):
    """Raised when an order cannot transition to paid from its current state."""

    def __init__(self, status: str):
        super().__init__(status)
        self.status = status


class WechatRechargeDAO:
    """Database operations for WeChat Native creation-point recharge."""

    @staticmethod
    async def find_reusable_order(
        user_id: str,
        point_amount: int,
        amount_fen: int,
        now: datetime,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow(
            """
            SELECT * FROM wechat_creation_point_orders
            WHERE user_id=$1 AND point_amount=$2 AND amount_fen=$3
              AND status='pending' AND expires_at > $4 AND code_url IS NOT NULL
            ORDER BY created_at DESC LIMIT 1
            """,
            user_id,
            point_amount,
            amount_fen,
            now,
        )
        return dict(row) if row else None

    @staticmethod
    async def create_order(
        *,
        payment_order_id: str,
        user_id: str,
        out_trade_no: str,
        point_amount: int,
        base_amount_fen: int,
        discount_bps: int,
        amount_fen: int,
        expires_at: datetime,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        row = await db.fetchrow(
            """
            INSERT INTO wechat_creation_point_orders (
                payment_order_id, user_id, out_trade_no, point_amount,
                base_amount_fen, discount_bps, amount_fen, expires_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING *
            """,
            payment_order_id,
            user_id,
            out_trade_no,
            point_amount,
            base_amount_fen,
            discount_bps,
            amount_fen,
            expires_at,
        )
        return dict(row)

    @staticmethod
    async def mark_order_ready(
        payment_order_id: str,
        *,
        code_url: str,
        request_id: Optional[str],
    ) -> Dict[str, Any]:
        db = get_db_manager()
        row = await db.fetchrow(
            """
            UPDATE wechat_creation_point_orders
            SET code_url=$2, request_id=$3, updated_at=CURRENT_TIMESTAMP
            WHERE payment_order_id=$1 RETURNING *
            """,
            payment_order_id,
            code_url,
            request_id,
        )
        return dict(row)

    @staticmethod
    async def mark_order_failed(payment_order_id: str, failure_reason: str) -> None:
        db = get_db_manager()
        await db.execute(
            """
            UPDATE wechat_creation_point_orders
            SET status='failed', failure_reason=$2, updated_at=CURRENT_TIMESTAMP
            WHERE payment_order_id=$1
            """,
            payment_order_id,
            failure_reason,
        )

    @staticmethod
    async def get_user_order(user_id: str, out_trade_no: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow(
            """
            SELECT * FROM wechat_creation_point_orders
            WHERE user_id=$1 AND out_trade_no=$2
            """,
            user_id,
            out_trade_no,
        )
        return dict(row) if row else None

    @staticmethod
    async def update_provider_state(
        user_id: str,
        out_trade_no: str,
        *,
        status: str,
        failure_reason: str,
        request_id: Optional[str],
    ) -> Dict[str, Any]:
        db = get_db_manager()
        row = await db.fetchrow(
            """
            UPDATE wechat_creation_point_orders
            SET status=$3, failure_reason=$4, request_id=COALESCE($5, request_id),
                closed_at=CASE WHEN $3='closed' THEN CURRENT_TIMESTAMP ELSE closed_at END,
                last_checked_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
            WHERE user_id=$1 AND out_trade_no=$2 RETURNING *
            """,
            user_id,
            out_trade_no,
            status,
            failure_reason,
            request_id,
        )
        return dict(row)

    @staticmethod
    async def mark_checked(
        user_id: str,
        out_trade_no: str,
        *,
        request_id: Optional[str],
    ) -> Dict[str, Any]:
        db = get_db_manager()
        row = await db.fetchrow(
            """
            UPDATE wechat_creation_point_orders
            SET last_checked_at=CURRENT_TIMESTAMP,
                request_id=COALESCE($3, request_id), updated_at=CURRENT_TIMESTAMP
            WHERE user_id=$1 AND out_trade_no=$2 RETURNING *
            """,
            user_id,
            out_trade_no,
            request_id,
        )
        return dict(row)

    @staticmethod
    async def mark_expired(user_id: str, out_trade_no: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow(
            """
            UPDATE wechat_creation_point_orders
            SET status='expired', failure_reason='支付二维码已过期', updated_at=CURRENT_TIMESTAMP
            WHERE user_id=$1 AND out_trade_no=$2 AND status='pending' RETURNING *
            """,
            user_id,
            out_trade_no,
        )
        return dict(row) if row else None

    @staticmethod
    async def settle_order(
        *,
        out_trade_no: str,
        transaction_id: str,
        notify_event_id: str,
        paid_at: datetime,
        validate_order: Callable[[Mapping[str, Any]], None],
    ) -> Dict[str, Any]:
        """Atomically validate, credit permanent points, and mark the order paid.

        ``validate_order`` performs provider-specific merchant/application/
        amount checks while the local order row is locked. Any exception raised
        by the callback aborts the transaction before the account is changed.
        """
        db = get_db_manager()
        async with db.acquire() as conn:
            async with conn.transaction():
                order_row = await conn.fetchrow(
                    """
                    SELECT * FROM wechat_creation_point_orders
                    WHERE out_trade_no=$1 FOR UPDATE
                    """,
                    out_trade_no,
                )
                if not order_row:
                    raise RechargeOrderNotFound(out_trade_no)
                order = dict(order_row)
                validate_order(order)

                if order['status'] == 'paid':
                    if str(order.get('transaction_id') or '') != transaction_id:
                        raise RechargeTransactionConflict(out_trade_no)
                    return order
                if order['status'] not in ('pending', 'expired'):
                    raise RechargeOrderStateError(str(order['status']))

                account = await _get_or_create_account_for_update(conn, 'user', order['user_id'])
                account = await CreationPointDAO._expire_locked(conn, account)
                balance_before = int(account.get('available_credits') or 0)
                point_amount = int(order['point_amount'])
                balance_after = balance_before + point_amount
                await conn.execute(
                    """
                    UPDATE credit_accounts
                    SET available_credits=available_credits+$2,
                        account_credits=account_credits+$2,
                        updated_at=CURRENT_TIMESTAMP
                    WHERE account_id=$1
                    """,
                    account['account_id'],
                    point_amount,
                )
                await conn.execute(
                    """
                    INSERT INTO credit_transactions (
                        transaction_id, account_id, user_id, change_type, amount,
                        balance_before, balance_after, metadata, payment_order_id
                    ) VALUES ($1,$2,$3,'recharge',$4,$5,$6,$7::jsonb,$8)
                    """,
                    f"txn_{uuid.uuid4().hex[:16]}",
                    account['account_id'],
                    order['user_id'],
                    point_amount,
                    balance_before,
                    balance_after,
                    json.dumps(
                        {
                            'channel': 'wechat',
                            'point_bucket': 'account',
                            'out_trade_no': order['out_trade_no'],
                            'wechat_transaction_id': transaction_id,
                            'base_amount_fen': int(order['base_amount_fen']),
                            'discount_bps': int(order['discount_bps']),
                            'amount_fen': int(order['amount_fen']),
                        },
                        ensure_ascii=False,
                    ),
                    order['payment_order_id'],
                )
                updated = await conn.fetchrow(
                    """
                    UPDATE wechat_creation_point_orders
                    SET status='paid', transaction_id=$2,
                        notify_event_id=COALESCE($3, notify_event_id),
                        paid_at=$4, failure_reason=NULL, updated_at=CURRENT_TIMESTAMP
                    WHERE payment_order_id=$1 RETURNING *
                    """,
                    order['payment_order_id'],
                    transaction_id,
                    notify_event_id or None,
                    paid_at,
                )
                return dict(updated)

    @staticmethod
    async def list_orders(
        *,
        user_id: str = '',
        status: str = '',
        out_trade_no: str = '',
        limit: int = 100,
        offset: int = 0,
    ) -> list[Dict[str, Any]]:
        db = get_db_manager()
        where = ['TRUE']
        args: list[Any] = []
        if user_id:
            args.append(user_id)
            where.append(f"o.user_id=${len(args)}")
        if status:
            args.append(status.lower())
            where.append(f"o.status=${len(args)}")
        if out_trade_no:
            args.append(f"%{out_trade_no}%")
            where.append(f"o.out_trade_no ILIKE ${len(args)}")
        args.extend([min(max(limit, 1), 500), max(offset, 0)])
        rows = await db.fetch(
            f"""
            SELECT o.*, u.username, u.phone_number, u.email
            FROM wechat_creation_point_orders o
            LEFT JOIN users u ON u.user_id=o.user_id
            WHERE {' AND '.join(where)}
            ORDER BY o.created_at DESC
            LIMIT ${len(args)-1} OFFSET ${len(args)}
            """,
            *args,
        )
        return [dict(row) for row in rows]
