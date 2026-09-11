"""Read-only database probes used by the runtime health endpoint."""
from __future__ import annotations

from typing import Any


class RuntimeHealthDAO:
    @staticmethod
    async def get_database_snapshot(db_manager: Any) -> dict[str, Any]:
        ping = await db_manager.fetchval("SELECT 1")
        ledger_exists = await db_manager.fetchval(
            "SELECT to_regclass('public.schema_migrations') IS NOT NULL"
        )
        latest = None
        if ledger_exists:
            latest = await db_manager.fetchrow(
                """
                SELECT
                    migration_id,
                    checksum_sha256,
                    applied_at,
                    execution_ms,
                    git_sha,
                    (SELECT COUNT(*)::INTEGER FROM schema_migrations) AS applied_count
                FROM schema_migrations
                ORDER BY applied_at DESC, migration_id DESC
                LIMIT 1
                """
            )
        task_queue_rows = await db_manager.fetch(
            """
            SELECT
                task_type,
                status,
                COUNT(*)::INTEGER AS task_count,
                MIN(created_at) AS oldest_created_at,
                MIN(started_at) AS oldest_started_at
            FROM tasks
            WHERE status IN ('pending', 'queued', 'processing')
            GROUP BY task_type, status
            """
        )
        return {
            "ping": ping,
            "ledger_exists": bool(ledger_exists),
            "latest": latest,
            "task_queue_rows": [dict(row) for row in (task_queue_rows or [])],
        }
