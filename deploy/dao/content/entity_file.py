
import json
import logging
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional
from db_manager import get_db_manager


logger = logging.getLogger(__name__)
DEPLOY_ROOT = Path(__file__).resolve().parents[2]
USER_STORAGE_ROOT = DEPLOY_ROOT / "persistent_storage"


def _resolve_owned_storage_path(file_path: Optional[str], storage_root: Optional[Path] = None) -> Optional[Path]:
    if not file_path:
        return None
    root = (storage_root or USER_STORAGE_ROOT).resolve()
    candidate = Path(file_path)
    if not candidate.is_absolute():
        candidate = DEPLOY_ROOT / candidate
    resolved = candidate.resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError("File path is outside managed persistent storage") from exc
    return resolved


class EntityFileDAO:
    @staticmethod
    async def count_user_files(user_id: str, file_type: Optional[str] = None) -> int:
        db = get_db_manager()
        if not db:
            return 0

        conditions = ["user_id = $1", "is_deleted = FALSE"]
        params: list[Any] = [user_id]
        if file_type:
            conditions.append("file_type = $2")
            params.append(file_type)

        total = await db.fetchval(
            f"SELECT COUNT(*) FROM files WHERE {' AND '.join(conditions)}",
            *params,
        )
        return int(total or 0)

    @staticmethod
    async def get_deleted_user_files(
        user_id: str,
        file_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        conditions = ["user_id = $1", "is_deleted = TRUE"]
        params: list[Any] = [user_id]
        if file_type:
            conditions.append(f"file_type = ${len(params) + 1}")
            params.append(file_type)
        params.extend([limit, offset])
        limit_idx = len(params) - 1
        rows = await db.fetch(
            f"""
            SELECT * FROM files
            WHERE {' AND '.join(conditions)}
            ORDER BY deleted_at DESC NULLS LAST, created_at DESC
            LIMIT ${limit_idx} OFFSET ${limit_idx + 1}
            """,
            *params,
        )
        return [dict(row) for row in rows]

    @staticmethod
    async def count_deleted_user_files(user_id: str, file_type: Optional[str] = None) -> int:
        db = get_db_manager()
        if not db:
            return 0
        conditions = ["user_id = $1", "is_deleted = TRUE"]
        params: list[Any] = [user_id]
        if file_type:
            conditions.append("file_type = $2")
            params.append(file_type)
        total = await db.fetchval(
            f"SELECT COUNT(*) FROM files WHERE {' AND '.join(conditions)}",
            *params,
        )
        return int(total or 0)

    @staticmethod
    async def get_deleted_user_file(file_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """SELECT * FROM files
               WHERE file_id = $1 AND user_id = $2 AND is_deleted = TRUE""",
            file_id,
            user_id,
        )
        return dict(row) if row else None

    @staticmethod
    async def get_entity_files(
        entity_type: str,
        entity_id: str,
        file_role: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        if not db:
            return {"items": [], "total": 0}

        conditions = [
            "entity_type = $1",
            "entity_id = $2",
            "is_deleted = FALSE",
        ]
        params: list = [entity_type, entity_id]
        idx = 3

        if file_role:
            conditions.append(f"file_role = ${idx}")
            params.append(file_role)
            idx += 1

        where = " AND ".join(conditions)

        count_q = f"SELECT COUNT(*) FROM files WHERE {where}"
        total = await db.fetchval(count_q, *params)

        params.extend([limit, offset])
        data_q = f"""
            SELECT * FROM files WHERE {where}
            ORDER BY created_at DESC
            LIMIT ${idx} OFFSET ${idx + 1}
        """
        rows = await db.fetch(data_q, *params)
        return {"items": [dict(r) for r in rows], "total": total or 0}

    @staticmethod
    async def link_file(
        file_id: str,
        entity_type: str,
        entity_id: str,
        file_role: str,
        is_selected: bool = False,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """UPDATE files
               SET entity_type = $2, entity_id = $3,
                   file_role = $4, is_selected = $5
               WHERE file_id = $1 AND is_deleted = FALSE
               RETURNING *""",
            file_id, entity_type, entity_id, file_role, is_selected,
        )
        return dict(row) if row else None

    @staticmethod
    async def sync_legacy_url(entity_type: str, entity_id: str, file_role: str, file_url: str) -> bool:
        """Keep legacy entity URL columns in sync after linking or saving files."""
        db = get_db_manager()
        if not db:
            return False

        if entity_type == "storyboard_item":
            query_map = {
                "generated_image": (
                    "UPDATE storyboard_items SET generated_image_url = $1 WHERE item_id = $2"
                ),
                "dialogue_audio": (
                    "UPDATE storyboard_items SET dialogue_audio_url = $1 WHERE item_id = $2"
                ),
                "narration_audio": (
                    "UPDATE storyboard_items SET narration_audio_url = $1 WHERE item_id = $2"
                ),
                "sfx": "UPDATE storyboard_items SET sfx_audio_url = $1 WHERE item_id = $2",
            }
            query = query_map.get(file_role)
            if not query:
                return False
            result = await db.execute(
                query,
                file_url,
                entity_id,
            )
            return result == "UPDATE 1"

        if entity_type == "asset":
            if file_role == "asset_thumbnail":
                result = await db.execute(
                    "UPDATE assets SET thumbnail_url = $1 WHERE asset_id = $2",
                    file_url,
                    entity_id,
                )
                return result == "UPDATE 1"

            if file_role == "reference_image":
                row = await db.fetchrow(
                    "SELECT reference_images FROM assets WHERE asset_id = $1",
                    entity_id,
                )
                if not row:
                    return False
                existing = row.get("reference_images") or []
                if isinstance(existing, str):
                    existing = json.loads(existing) if existing else []
                if file_url in existing:
                    return True
                existing.append(file_url)
                result = await db.execute(
                    "UPDATE assets SET reference_images = $1::jsonb WHERE asset_id = $2",
                    json.dumps(existing, ensure_ascii=False),
                    entity_id,
                )
                return result == "UPDATE 1"

        if entity_type == "video_segment":
            if file_role == "video":
                result = await db.execute(
                    "UPDATE video_segments SET video_url = $1 WHERE segment_id = $2",
                    file_url,
                    entity_id,
                )
                return result == "UPDATE 1"
            if file_role == "video_thumbnail":
                result = await db.execute(
                    "UPDATE video_segments SET thumbnail_url = $1 WHERE segment_id = $2",
                    file_url,
                    entity_id,
                )
                return result == "UPDATE 1"

        return False

    @staticmethod
    async def select_file(
        file_id: str,
        entity_type: str,
        entity_id: str,
        file_role: str,
    ) -> Optional[Dict[str, Any]]:

        db = get_db_manager()
        if not db:
            return None

        async with db.pool.acquire() as conn:
            async with conn.transaction():
                target = await conn.fetchrow(
                    """SELECT * FROM files
                       WHERE file_id = $1
                         AND entity_type = $2
                         AND entity_id = $3
                         AND file_role = $4
                         AND is_deleted = FALSE
                       FOR UPDATE""",
                    file_id, entity_type, entity_id, file_role,
                )
                if not target:
                    return None

                await conn.execute(
                    """UPDATE files SET is_selected = FALSE
                       WHERE entity_type = $1 AND entity_id = $2
                         AND file_role = $3 AND is_deleted = FALSE""",
                    entity_type, entity_id, file_role,
                )
                row = await conn.fetchrow(
                    """UPDATE files SET is_selected = TRUE
                       WHERE file_id = $1 RETURNING *""",
                    file_id,
                )
                return dict(row) if row else None

    @staticmethod
    async def soft_delete(file_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        row = await db.fetchrow(
            """UPDATE files
               SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP
               WHERE file_id = $1 AND is_deleted = FALSE
               RETURNING file_id""",
            file_id,
        )
        return row is not None

    @staticmethod
    async def restore(file_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """UPDATE files
               SET is_deleted = FALSE, deleted_at = NULL
               WHERE file_id = $1 AND user_id = $2 AND is_deleted = TRUE
               RETURNING *""",
            file_id,
            user_id,
        )
        return dict(row) if row else None

    @staticmethod
    async def hard_delete(
        file_id: str,
        user_id: str,
        storage_root: Optional[Path] = None,
    ) -> Optional[Dict[str, Any]]:
        """Delete an owned recycled file from managed storage, then delete its record."""
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """SELECT file_id, file_path, file_size_bytes FROM files
               WHERE file_id = $1 AND user_id = $2 AND is_deleted = TRUE""",
            file_id,
            user_id,
        )
        if not row:
            return None

        file_path = row["file_path"]
        path = _resolve_owned_storage_path(file_path, storage_root)
        freed_bytes = 0
        if path and path.exists():
            if not path.is_file():
                raise OSError("Managed file path is not a regular file")
            freed_bytes = path.stat().st_size
            path.unlink()

        result = await db.execute(
            """DELETE FROM files
               WHERE file_id = $1 AND user_id = $2 AND is_deleted = TRUE""",
            file_id,
            user_id,
        )
        if result != "DELETE 1":
            logger.error("Physical file was removed but its owned recycle record was not: %s", file_id)
            raise RuntimeError("File record changed during permanent deletion")
        return {"file_id": file_id, "freed_bytes": freed_bytes}

    @staticmethod
    async def delete_deleted_user_file_record(file_id: str, user_id: str) -> bool:
        """Delete only an owned recycled DB record after remote storage is gone."""
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            """DELETE FROM files
               WHERE file_id = $1 AND user_id = $2 AND is_deleted = TRUE""",
            file_id,
            user_id,
        )
        return result == "DELETE 1"

    @staticmethod
    async def soft_delete_entity_files(
        entity_type: str, entity_id: str
    ) -> int:
        db = get_db_manager()
        if not db:
            return 0
        result = await db.execute(
            """UPDATE files
               SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP
               WHERE entity_type = $1 AND entity_id = $2
                 AND is_deleted = FALSE""",
            entity_type, entity_id,
        )
        return int(result.split()[-1]) if result else 0

    @staticmethod
    async def get_selected_file(
        entity_type: str, entity_id: str, file_role: str
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """SELECT * FROM files
               WHERE entity_type = $1 AND entity_id = $2
                 AND file_role = $3 AND is_selected = TRUE
                 AND is_deleted = FALSE""",
            entity_type, entity_id, file_role,
        )
        return dict(row) if row else None

    @staticmethod
    async def copy_file(
        source_file_id: str,
        target_entity_type: str,
        target_entity_id: str,
        file_role: str,
    ) -> Optional[Dict[str, Any]]:

        db = get_db_manager()
        if not db:
            return None
        source = await db.fetchrow(
            "SELECT * FROM files WHERE file_id = $1 AND is_deleted = FALSE",
            source_file_id,
        )
        if not source:
            return None
        import uuid
        new_id = f"file_{uuid.uuid4().hex[:12]}"
        row = await db.fetchrow(
            """INSERT INTO files
               (file_id, user_id, file_type, file_name, file_path, file_url,
                file_size_bytes, mime_type, entity_type, entity_id, file_role,
                episode_id, source, is_selected, metadata)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,FALSE,$14)
               RETURNING *""",
            new_id,
            source["user_id"],
            source["file_type"],
            source["file_name"],
            source["file_path"],
            source["file_url"],
            source["file_size_bytes"],
            source["mime_type"],
            target_entity_type,
            target_entity_id,
            file_role,
            source.get("episode_id"),
            source.get("source", "copy"),
            source.get("metadata"),
        )
        return dict(row) if row else None

    @staticmethod
    async def get_episode_enhance_files(episode_id: str) -> list:
        """Read current video and actor audio in one episode-scoped query."""
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(
            """
            WITH ranked AS (
                SELECT f.file_id, f.file_url, f.file_type, f.file_role,
                       f.is_selected, f.created_at, f.entity_id,
                       ROW_NUMBER() OVER (
                           PARTITION BY f.entity_id, f.file_role
                           ORDER BY CASE WHEN f.file_role = 'video' AND f.is_selected
                                         THEN 0 ELSE 1 END,
                                    f.created_at DESC, f.file_id DESC
                       ) AS position
                FROM files f
                JOIN video_segments s ON s.segment_id = f.entity_id
                WHERE s.episode_id = $1 AND f.entity_type = 'video_segment'
                  AND f.is_deleted = FALSE
                  AND f.file_role IN ('video', 'actor_dubbing')
                  AND COALESCE(f.file_url, '') <> ''
            )
            SELECT file_id, file_url, file_type, file_role, is_selected,
                   created_at, entity_id
            FROM ranked
            WHERE position <= CASE WHEN file_role = 'video' THEN 1 ELSE 50 END
            ORDER BY entity_id, file_role, position
            """,
            episode_id,
        )
        return [dict(row) for row in rows]

    @staticmethod
    async def get_files_for_entities(
        entity_type: str,
        entity_ids: list,
        file_role: str = None,
    ) -> dict:

        if not entity_ids:
            return {}
        db = get_db_manager()
        if not db:
            return {}

        conditions = [
            "entity_type = $1",
            "entity_id = ANY($2)",
            "is_deleted = FALSE",
        ]
        params: list = [entity_type, entity_ids]
        if file_role:
            conditions.append(f"file_role = ${len(params) + 1}")
            params.append(file_role)

        rows = await db.fetch(
            f"SELECT * FROM files WHERE {' AND '.join(conditions)} ORDER BY created_at",
            *params,
        )
        result: dict = {}
        for row in rows:
            eid = row["entity_id"]
            if eid not in result:
                result[eid] = []
            result[eid].append(dict(row))
        return result
