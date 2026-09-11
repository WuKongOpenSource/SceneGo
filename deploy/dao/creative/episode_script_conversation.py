"""Persistence for script conversations and immutable storyboard-script versions."""
from __future__ import annotations

import json
import uuid
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager
from utils.script_patch import build_script_patch


def _json(value: Any, fallback: Any) -> str:
    return json.dumps(value if value is not None else fallback, ensure_ascii=False)


class EpisodeScriptConversationDAO:
    @staticmethod
    async def fail_stale_messages(script_id: str, *, stale_after_seconds: int = 120) -> int:
        """Close browser-owned generations that can no longer be resumed."""
        db = get_db_manager()
        if not db:
            return 0
        status = await db.execute(
            """
            UPDATE episode_script_messages
            SET status = 'failed',
                metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                    'error', '页面刷新、网络中断或生成超时，任务未完成',
                    'interrupted', true,
                    'creditCharged', false
                ),
                updated_at = CURRENT_TIMESTAMP
            WHERE script_id = $1
              AND role = 'assistant'
              AND status IN ('pending', 'streaming')
              AND updated_at < CURRENT_TIMESTAMP - ($2::integer * INTERVAL '1 second')
            """,
            script_id,
            max(1, int(stale_after_seconds)),
        )
        try:
            return int(str(status).rsplit(" ", 1)[-1])
        except (TypeError, ValueError):
            return 0

    @staticmethod
    async def list_messages(script_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(
            """
            SELECT * FROM episode_script_messages
            WHERE script_id = $1
            ORDER BY created_at, id
            """,
            script_id,
        )
        return [dict(row) for row in rows or []]

    @staticmethod
    async def list_versions(script_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(
            """
            SELECT * FROM episode_script_versions
            WHERE script_id = $1
            ORDER BY version_no
            """,
            script_id,
        )
        return [dict(row) for row in rows or []]

    @staticmethod
    async def create_message(
        *,
        episode_id: str,
        script_id: str,
        role: str,
        content: str,
        status: str = "completed",
        model_alias: Optional[str] = None,
        provider: Optional[str] = None,
        model_name: Optional[str] = None,
        reply_to_message_id: Optional[str] = None,
        request_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        message_id = f"msg_{uuid.uuid4().hex}"
        row = await db.fetchrow(
            """
            INSERT INTO episode_script_messages (
                message_id, episode_id, script_id, role, content, status,
                model_alias, provider, model_name, reply_to_message_id,
                request_id, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
            ON CONFLICT DO NOTHING
            RETURNING *
            """,
            message_id,
            episode_id,
            script_id,
            role,
            content,
            status,
            model_alias,
            provider,
            model_name,
            reply_to_message_id,
            request_id,
            _json(metadata, {}),
        )
        if row:
            await db.execute(
                """
                UPDATE episode_scripts
                SET last_message_at = CURRENT_TIMESTAMP,
                    default_model = COALESCE($2, default_model)
                WHERE script_id = $1
                """,
                script_id,
                model_name,
            )
            return dict(row)
        if request_id:
            existing = await db.fetchrow(
                """
                SELECT * FROM episode_script_messages
                WHERE script_id = $1 AND request_id = $2
                """,
                script_id,
                request_id,
            )
            return dict(existing) if existing else None
        return None

    @staticmethod
    async def update_message(
        script_id: str,
        message_id: str,
        *,
        content: Optional[str] = None,
        status: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """
            UPDATE episode_script_messages
            SET content = COALESCE($3, content),
                status = COALESCE($4, status),
                metadata = COALESCE($5::jsonb, metadata),
                updated_at = CURRENT_TIMESTAMP
            WHERE script_id = $1 AND message_id = $2
            RETURNING *
            """,
            script_id,
            message_id,
            content,
            status,
            _json(metadata, {}) if metadata is not None else None,
        )
        return dict(row) if row else None

    @staticmethod
    async def create_version(
        *,
        episode_id: str,
        script_id: str,
        content: str,
        storyboard_items: list,
        message_id: Optional[str] = None,
        base_version_id: Optional[str] = None,
        source: str = "ai",
        status: str = "ready",
        model_alias: Optional[str] = None,
        provider: Optional[str] = None,
        model_name: Optional[str] = None,
        metadata: Optional[dict] = None,
        set_current: bool = True,
        user_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        async with db.acquire() as conn:
            async with conn.transaction():
                script = await conn.fetchrow(
                    """
                    SELECT script_id, current_version_id, adapted_script
                    FROM episode_scripts
                    WHERE script_id = $1 AND episode_id = $2
                    FOR UPDATE
                    """,
                    script_id,
                    episode_id,
                )
                if not script:
                    return None
                if message_id:
                    existing = await conn.fetchrow(
                        "SELECT * FROM episode_script_versions WHERE message_id = $1",
                        message_id,
                    )
                    if existing:
                        return dict(existing)
                version_no = await conn.fetchval(
                    """
                    SELECT COALESCE(MAX(version_no), 0) + 1
                    FROM episode_script_versions
                    WHERE script_id = $1
                    """,
                    script_id,
                )
                version_id = f"ver_{uuid.uuid4().hex}"
                requested_base_version_id = base_version_id
                base_version_id = requested_base_version_id or script.get("current_version_id")
                base_content = str(script.get("adapted_script") or "")
                if base_version_id:
                    base_version = await conn.fetchrow(
                        """
                        SELECT content
                        FROM episode_script_versions
                        WHERE version_id = $1 AND script_id = $2
                        """,
                        base_version_id,
                        script_id,
                    )
                    if requested_base_version_id and not base_version:
                        return None
                    if base_version:
                        base_content = str(base_version.get("content") or "")
                patch = build_script_patch(base_content, content)
                should_set_current = bool(set_current and status == "ready")
                row = await conn.fetchrow(
                    """
                    INSERT INTO episode_script_versions (
                        version_id, episode_id, script_id, message_id, version_no,
                        content, storyboard_items, source, status, model_alias,
                        provider, model_name, metadata,
                        base_version_id, patch, confirmed_at, confirmed_by
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9,
                            $10, $11, $12, $13::jsonb, $14, $15::jsonb,
                            CASE WHEN $16 THEN CURRENT_TIMESTAMP ELSE NULL END,
                            CASE WHEN $16 THEN $17 ELSE NULL END)
                    RETURNING *
                    """,
                    version_id,
                    episode_id,
                    script_id,
                    message_id,
                    version_no,
                    content,
                    _json(storyboard_items, []),
                    source,
                    status,
                    model_alias,
                    provider,
                    model_name,
                    _json(metadata, {}),
                    base_version_id,
                    _json(patch, {}),
                    should_set_current,
                    user_id,
                )
                if should_set_current:
                    await conn.execute(
                        """
                        UPDATE episode_scripts
                        SET current_version_id = $2,
                            adapted_script = $3,
                            last_message_at = CURRENT_TIMESTAMP,
                            default_model = COALESCE($4, default_model),
                            updated_at = CURRENT_TIMESTAMP
                        WHERE script_id = $1
                        """,
                        script_id,
                        version_id,
                        content,
                        model_name,
                    )
                return dict(row) if row else None

    @staticmethod
    async def confirm_version(
        script_id: str,
        version_id: str,
        user_id: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        async with db.acquire() as conn:
            async with conn.transaction():
                script = await conn.fetchrow(
                    "SELECT * FROM episode_scripts WHERE script_id = $1 FOR UPDATE",
                    script_id,
                )
                if not script:
                    return None
                version = await conn.fetchrow(
                    """
                    SELECT * FROM episode_script_versions
                    WHERE script_id = $1 AND version_id = $2
                    FOR UPDATE
                    """,
                    script_id,
                    version_id,
                )
                if not version or version["status"] not in {"draft", "ready"}:
                    return None
                previous_version_id = script.get("current_version_id")
                confirmation_metadata = {}
                if previous_version_id and previous_version_id != version_id:
                    confirmation_metadata = {
                        "confirmationBaseVersionId": previous_version_id,
                        "confirmationPatch": build_script_patch(
                            str(script.get("adapted_script") or ""),
                            str(version.get("content") or ""),
                        ),
                    }
                row = await conn.fetchrow(
                    """
                    UPDATE episode_script_versions
                    SET status = 'ready', confirmed_at = COALESCE(confirmed_at, CURRENT_TIMESTAMP),
                        confirmed_by = COALESCE(confirmed_by, $3),
                        rejected_at = NULL, rejected_by = NULL,
                        metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE script_id = $1 AND version_id = $2
                    RETURNING *
                    """,
                    script_id,
                    version_id,
                    user_id,
                    _json(confirmation_metadata, {}),
                )
                await conn.execute(
                    """
                    UPDATE episode_scripts
                    SET current_version_id = $2, adapted_script = $3,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE script_id = $1
                    """,
                    script_id,
                    version_id,
                    version["content"],
                )
                result = dict(row)
                result["previous_version_id"] = previous_version_id
                return result

    @staticmethod
    async def reject_version(
        script_id: str,
        version_id: str,
        user_id: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        async with db.acquire() as conn:
            async with conn.transaction():
                script = await conn.fetchrow(
                    "SELECT current_version_id FROM episode_scripts WHERE script_id = $1 FOR UPDATE",
                    script_id,
                )
                if not script:
                    return None
                version = await conn.fetchrow(
                    """
                    SELECT * FROM episode_script_versions
                    WHERE script_id = $1 AND version_id = $2
                    FOR UPDATE
                    """,
                    script_id,
                    version_id,
                )
                if not version:
                    return None

                current_version_id = script.get("current_version_id")
                current_status = str(version.get("status") or "")
                if current_status == "rejected":
                    result = dict(version)
                    result["rejection_outcome"] = "already_rejected"
                    result["current_version_id"] = current_version_id
                    return result
                if current_status != "draft" or current_version_id == version_id:
                    result = dict(version)
                    result["rejection_outcome"] = (
                        "already_confirmed" if current_status == "ready" else "not_rejectable"
                    )
                    result["current_version_id"] = current_version_id
                    return result

                row = await conn.fetchrow(
                    """
                    UPDATE episode_script_versions
                    SET status = 'rejected', rejected_at = CURRENT_TIMESTAMP,
                        rejected_by = $3, updated_at = CURRENT_TIMESTAMP
                    WHERE script_id = $1 AND version_id = $2 AND status = 'draft'
                    RETURNING *
                    """,
                    script_id,
                    version_id,
                    user_id,
                )
                if not row:
                    return None
                result = dict(row)
                result["rejection_outcome"] = "rejected"
                result["current_version_id"] = current_version_id
                return result

    @staticmethod
    async def select_version(script_id: str, version_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        async with db.acquire() as conn:
            async with conn.transaction():
                version = await conn.fetchrow(
                    """
                    SELECT * FROM episode_script_versions
                    WHERE script_id = $1 AND version_id = $2
                    """,
                    script_id,
                    version_id,
                )
                if not version:
                    return None
                if version["status"] != "ready":
                    return None
                await conn.execute(
                    """
                    UPDATE episode_scripts
                    SET current_version_id = $2,
                        adapted_script = $3,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE script_id = $1
                    """,
                    script_id,
                    version_id,
                    version["content"],
                )
                return dict(version)

    @staticmethod
    async def merge_version_metadata(
        script_id: str,
        version_id: str,
        metadata: dict,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """
            UPDATE episode_script_versions
            SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
                updated_at = CURRENT_TIMESTAMP
            WHERE script_id = $1 AND version_id = $2
            RETURNING *
            """,
            script_id,
            version_id,
            _json(metadata, {}),
        )
        return dict(row) if row else None
