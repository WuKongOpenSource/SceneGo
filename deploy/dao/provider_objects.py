"""Ownership records for objects created in shared provider accounts."""
from __future__ import annotations

import json
from typing import Any, Dict, Iterable, Optional

from db_manager import get_db_manager


class ProviderObjectDAO:
    @staticmethod
    async def upsert(
        *,
        provider: str,
        object_type: str,
        object_id: str,
        user_id: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        return await db.fetchrow(
            """
            INSERT INTO provider_remote_objects
                (provider, object_type, object_id, user_id, metadata)
            VALUES ($1, $2, $3, $4, $5::jsonb)
            ON CONFLICT (provider, object_type, object_id)
            DO UPDATE SET
                user_id = EXCLUDED.user_id,
                metadata = EXCLUDED.metadata,
                updated_at = NOW()
            RETURNING *
            """,
            provider,
            object_type,
            object_id,
            user_id,
            json.dumps(metadata or {}, ensure_ascii=False),
        )

    @staticmethod
    async def get(
        *,
        provider: str,
        object_type: str,
        object_id: str,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        return await db.fetchrow(
            """
            SELECT * FROM provider_remote_objects
            WHERE provider = $1 AND object_type = $2 AND object_id = $3
            """,
            provider,
            object_type,
            object_id,
        )

    @staticmethod
    async def list_ids(
        *,
        provider: str,
        object_types: Iterable[str],
        user_id: str,
    ) -> list[str]:
        db = get_db_manager()
        rows = await db.fetch(
            """
            SELECT object_id FROM provider_remote_objects
            WHERE provider = $1 AND object_type = ANY($2::text[]) AND user_id = $3
            """,
            provider,
            list(object_types),
            user_id,
        )
        return [str(row["object_id"]) for row in rows]

    @staticmethod
    async def delete(
        *,
        provider: str,
        object_type: str,
        object_id: str,
    ) -> None:
        db = get_db_manager()
        await db.execute(
            """
            DELETE FROM provider_remote_objects
            WHERE provider = $1 AND object_type = $2 AND object_id = $3
            """,
            provider,
            object_type,
            object_id,
        )
