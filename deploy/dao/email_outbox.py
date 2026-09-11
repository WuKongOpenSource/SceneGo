"""Persistent email outbox used by verification and business notifications."""
from __future__ import annotations

import json
import uuid
from typing import Any, Optional

from db_manager import get_db_manager


class EmailOutboxDAO:
    @staticmethod
    async def enqueue(
        *,
        recipient: str,
        message_type: str,
        subject: str,
        body_text: str,
        body_html: Optional[str] = None,
        user_id: Optional[str] = None,
        dedupe_key: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> Optional[dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """
            INSERT INTO email_outbox (
                message_id, dedupe_key, user_id, recipient, message_type,
                subject, body_text, body_html, metadata
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
            ON CONFLICT (dedupe_key) DO NOTHING
            RETURNING *
            """,
            f"mail_{uuid.uuid4().hex[:20]}",
            dedupe_key,
            user_id,
            recipient,
            message_type,
            subject,
            body_text,
            body_html,
            json.dumps(metadata or {}),
        )
        return dict(row) if row else None

    @staticmethod
    async def claim_next() -> Optional[dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """
            WITH candidate AS (
                SELECT id
                FROM email_outbox
                WHERE (
                    status = 'pending' AND available_at <= CURRENT_TIMESTAMP
                ) OR (
                    status = 'sending' AND claimed_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes'
                )
                ORDER BY created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE email_outbox AS outbox
            SET status = 'sending', claimed_at = CURRENT_TIMESTAMP,
                attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
            FROM candidate
            WHERE outbox.id = candidate.id
            RETURNING outbox.*
            """
        )
        return dict(row) if row else None

    @staticmethod
    async def mark_sent(message_id: str) -> bool:
        db = get_db_manager()
        result = await db.execute(
            """
            UPDATE email_outbox
            SET status='sent', sent_at=CURRENT_TIMESTAMP, last_error=NULL,
                updated_at=CURRENT_TIMESTAMP
            WHERE message_id=$1
            """,
            message_id,
        )
        return result == "UPDATE 1"

    @staticmethod
    async def mark_failed(message_id: str, error: str, attempts: int) -> bool:
        db = get_db_manager()
        terminal = attempts >= 5
        result = await db.execute(
            """
            UPDATE email_outbox
            SET status=$2,
                available_at=CURRENT_TIMESTAMP + ($3 * INTERVAL '1 minute'),
                last_error=$4,
                updated_at=CURRENT_TIMESTAMP
            WHERE message_id=$1
            """,
            message_id,
            "failed" if terminal else "pending",
            min(60, max(1, 2 ** max(0, attempts - 1))),
            error[:1000],
        )
        return result == "UPDATE 1"
