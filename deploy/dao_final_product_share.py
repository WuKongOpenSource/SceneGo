"""Persistence for public final-product links and visitor feedback."""
from __future__ import annotations

import secrets
import uuid
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager


class FinalProductShareDAO:
    @staticmethod
    async def create_or_get(
        *,
        library_item_id: str,
        owner_user_id: str,
        project_id: str,
        episode_id: Optional[str],
    ) -> Dict[str, Any]:
        db = get_db_manager()
        row = await db.fetchrow(
            """
            INSERT INTO final_product_shares (
                share_id, share_token, library_item_id, owner_user_id,
                project_id, episode_id
            ) VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (library_item_id) WHERE is_active = TRUE
            DO UPDATE SET updated_at = CURRENT_TIMESTAMP
            RETURNING *
            """,
            f"fps_{uuid.uuid4().hex[:20]}",
            secrets.token_urlsafe(32),
            library_item_id,
            owner_user_id,
            project_id,
            episode_id,
        )
        return dict(row or {})

    @staticmethod
    async def get_active_for_item(library_item_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow(
            """
            SELECT * FROM final_product_shares
            WHERE library_item_id = $1 AND is_active = TRUE
              AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
            ORDER BY created_at DESC
            LIMIT 1
            """,
            library_item_id,
        )
        return dict(row) if row else None

    @staticmethod
    async def deactivate(share_id: str, owner_user_id: str) -> bool:
        db = get_db_manager()
        result = await db.execute(
            """
            UPDATE final_product_shares
            SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
            WHERE share_id = $1 AND owner_user_id = $2 AND is_active = TRUE
            """,
            share_id,
            owner_user_id,
        )
        return str(result).endswith(" 1")

    @staticmethod
    async def get_public(share_token: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow(
            """
            SELECT s.share_id, s.share_token, s.created_at AS shared_at,
                   ml.library_item_id, ml.title, ml.description, ml.episode_id,
                   ml.created_at,
                   f.file_id, f.file_name, f.file_path, f.file_url,
                   f.thumbnail_url, f.mime_type, f.duration_seconds,
                   f.width, f.height, f.file_size_bytes
            FROM final_product_shares s
            JOIN media_library_items ml ON ml.library_item_id = s.library_item_id
            JOIN files f ON f.file_id = ml.file_id
            WHERE s.share_token = $1
              AND s.is_active = TRUE
              AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)
              AND ml.is_deleted = FALSE
              AND f.is_deleted = FALSE
              AND ml.source = 'composed_final'
            """,
            share_token,
        )
        return dict(row) if row else None

    @staticmethod
    async def increment_access(share_id: str) -> None:
        db = get_db_manager()
        await db.execute(
            "UPDATE final_product_shares SET access_count = access_count + 1 WHERE share_id = $1",
            share_id,
        )

    @staticmethod
    async def add_feedback(
        *,
        share_id: str,
        author_name: str,
        content: str,
        timestamp_seconds: Optional[float],
    ) -> Dict[str, Any]:
        db = get_db_manager()
        row = await db.fetchrow(
            """
            INSERT INTO final_product_feedback (
                feedback_id, share_id, author_name, content, timestamp_seconds
            ) VALUES ($1,$2,$3,$4,$5)
            RETURNING *
            """,
            f"fpf_{uuid.uuid4().hex[:20]}",
            share_id,
            author_name,
            content,
            timestamp_seconds,
        )
        return dict(row or {})

    @staticmethod
    async def list_feedback_for_share(share_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        db = get_db_manager()
        rows = await db.fetch(
            """
            SELECT feedback_id, author_name, content, timestamp_seconds, created_at
            FROM final_product_feedback
            WHERE share_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            """,
            share_id,
            limit,
        )
        return [dict(row) for row in rows]

    @staticmethod
    async def list_feedback_for_item(library_item_id: str, limit: int = 200) -> List[Dict[str, Any]]:
        db = get_db_manager()
        rows = await db.fetch(
            """
            SELECT f.feedback_id, f.author_name, f.content, f.timestamp_seconds,
                   f.created_at, s.share_id, s.is_active
            FROM final_product_feedback f
            JOIN final_product_shares s ON s.share_id = f.share_id
            WHERE s.library_item_id = $1
            ORDER BY f.created_at DESC
            LIMIT $2
            """,
            library_item_id,
            limit,
        )
        return [dict(row) for row in rows]
