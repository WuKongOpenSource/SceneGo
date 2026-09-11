


import json
import logging
import uuid
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager

logger = logging.getLogger(__name__)


class FileDAO:
    @staticmethod
    def generate_file_id() -> str:
        return f"file_{uuid.uuid4().hex[:12]}"

    @staticmethod
    async def create(
        file_id: str,
        user_id: str,
        file_type: str,
        file_name: str,
        file_path: str,
        file_url: str,
        file_size_bytes: int = 0,
        mime_type: str = "application/octet-stream",
        version_id: Optional[str] = None,
        metadata: Optional[dict] = None,
        project_id: Optional[str] = None,
        episode_id: Optional[str] = None,
        source: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        meta_json = json.dumps(metadata or {}, ensure_ascii=False)
        query = """
            INSERT INTO files (
                file_id, version_id, user_id, file_type, file_name,
                file_path, file_url, file_size_bytes, mime_type, metadata,
                project_id, episode_id, source
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
            ON CONFLICT (file_id) DO NOTHING
            RETURNING *
        """
        try:
            return await db.fetchrow(
                query,
                file_id, version_id, user_id, file_type, file_name,
                file_path, file_url, file_size_bytes, mime_type, meta_json,
                project_id, episode_id, source,
            )
        except Exception as e:
            if not any(name in str(e) for name in ("project_id", "episode_id", "source")):
                raise
            logger.warning("files ownership columns unavailable, falling back to legacy insert: %s", e)

        legacy_query = """
            INSERT INTO files (
                file_id, version_id, user_id, file_type, file_name,
                file_path, file_url, file_size_bytes, mime_type, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
            ON CONFLICT (file_id) DO NOTHING
            RETURNING *
        """
        return await db.fetchrow(
            legacy_query,
            file_id, version_id, user_id, file_type, file_name,
            file_path, file_url, file_size_bytes, mime_type, meta_json,
        )

    @staticmethod
    async def get_by_id(file_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM files WHERE file_id = $1 AND is_deleted = FALSE",
            file_id,
        )

    @staticmethod
    async def merge_metadata(file_id: str, metadata: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            """
            UPDATE files
            SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
            WHERE file_id = $1 AND is_deleted = FALSE
            RETURNING *
            """,
            file_id,
            json.dumps(metadata or {}, ensure_ascii=False),
        )

    @staticmethod
    async def get_by_task_id(task_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            """SELECT * FROM files
               WHERE metadata->>'task_id' = $1 AND is_deleted = FALSE
               ORDER BY created_at""",
            task_id,
        )

    @staticmethod
    async def soft_delete(file_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        row = await db.fetchrow(
            """UPDATE files SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP
               WHERE file_id = $1 RETURNING file_id""",
            file_id,
        )
        return row is not None
