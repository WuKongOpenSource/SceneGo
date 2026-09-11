"""DAO helpers for admin recycle-bin operations."""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager


logger = logging.getLogger(__name__)


class AdminRecycleBinDAO:
    @staticmethod
    async def file_reference_counts(file_url: str) -> Dict[str, int]:
        if not file_url:
            return {}
        db = get_db_manager()
        if not db:
            return {}

        counts: Dict[str, int] = {}
        for key, table, column in (
            ("storyboard_image", "storyboard_items", "generated_image_url"),
            ("storyboard_dialogue_audio", "storyboard_items", "dialogue_audio_url"),
            ("storyboard_narration_audio", "storyboard_items", "narration_audio_url"),
            ("storyboard_sfx_audio", "storyboard_items", "sfx_audio_url"),
            ("storyboard_mixed_audio", "storyboard_items", "mixed_audio_url"),
            ("video_segment_video", "video_segments", "video_url"),
            ("video_segment_thumbnail", "video_segments", "thumbnail_url"),
            ("asset_thumbnail", "assets", "thumbnail_url"),
        ):
            try:
                value = await db.fetchval(
                    f"SELECT COUNT(*) FROM {table} WHERE {column} = $1",
                    file_url,
                )
                counts[key] = int(value or 0)
            except Exception as exc:
                logger.warning("Failed to count recycle-bin reference %s.%s: %s", table, column, exc)

        try:
            value = await db.fetchval(
                """
                SELECT COUNT(*)
                FROM assets a
                WHERE reference_images IS NOT NULL
                  AND jsonb_typeof(reference_images) = 'array'
                  AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements_text(a.reference_images) AS value
                    WHERE value = $1
                  )
                """,
                file_url,
            )
            counts["asset_reference_image"] = int(value or 0)
        except Exception as exc:
            logger.warning("Failed to count recycle-bin assets.reference_images references: %s", exc)

        return counts

    @staticmethod
    async def list_deleted_files(
        *,
        user_id: Optional[str] = None,
        project_id: Optional[str] = None,
        file_type: Optional[str] = None,
        keyword: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        if not db:
            return {"items": [], "total": 0}

        where = ["COALESCE(f.is_deleted, FALSE) = TRUE"]
        params: List[Any] = []
        idx = 1
        if user_id:
            where.append(f"f.user_id = ${idx}")
            params.append(user_id)
            idx += 1
        if project_id:
            where.append(f"f.project_id = ${idx}")
            params.append(project_id)
            idx += 1
        if file_type:
            where.append(f"f.file_type = ${idx}")
            params.append(file_type)
            idx += 1
        if keyword:
            where.append(
                f"(f.file_id ILIKE ${idx} OR f.file_name ILIKE ${idx} OR f.file_url ILIKE ${idx})"
            )
            params.append(f"%{keyword}%")
            idx += 1

        where_sql = " AND ".join(where)
        total = await db.fetchval(f"SELECT COUNT(*) FROM files f WHERE {where_sql}", *params)
        rows = await db.fetch(
            f"""
            SELECT f.*,
                   COUNT(ml.library_item_id) AS media_library_count
            FROM files f
            LEFT JOIN media_library_items ml ON ml.file_id = f.file_id
            WHERE {where_sql}
            GROUP BY f.id
            ORDER BY f.deleted_at DESC NULLS LAST, f.updated_at DESC NULLS LAST, f.id DESC
            LIMIT ${idx} OFFSET ${idx + 1}
            """,
            *params,
            limit,
            offset,
        )
        return {"items": [dict(row) for row in rows], "total": int(total or 0)}

    @staticmethod
    async def get_file_any(file_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow("SELECT * FROM files WHERE file_id = $1", file_id)
        return dict(row) if row else None

    @staticmethod
    async def restore_file(file_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """
            UPDATE files
            SET is_deleted = FALSE, deleted_at = NULL
            WHERE file_id = $1 AND COALESCE(is_deleted, FALSE) = TRUE
            RETURNING *
            """,
            file_id,
        )
        if not row:
            return None
        await db.execute(
            """
            UPDATE media_library_items
            SET is_deleted = FALSE, deleted_at = NULL
            WHERE file_id = $1
            """,
            file_id,
        )
        data = dict(row)
        value = await db.fetchval(
            "SELECT COUNT(*) FROM media_library_items WHERE file_id = $1",
            file_id,
        )
        data["media_library_count"] = int(value or 0)
        return data

    @staticmethod
    async def clear_legacy_references(file_url: str) -> None:
        if not file_url:
            return None
        db = get_db_manager()
        if not db:
            return
        for table, columns in {
            "storyboard_items": [
                "generated_image_url",
                "dialogue_audio_url",
                "narration_audio_url",
                "sfx_audio_url",
                "mixed_audio_url",
            ],
            "video_segments": ["video_url", "thumbnail_url"],
            "assets": ["thumbnail_url"],
        }.items():
            for column in columns:
                try:
                    await db.execute(
                        f"UPDATE {table} SET {column} = NULL WHERE {column} = $1",
                        file_url,
                    )
                except Exception as exc:
                    logger.warning(
                        "Failed to clear legacy file reference %s.%s: %s",
                        table,
                        column,
                        exc,
                    )

        try:
            await db.execute(
                """
                UPDATE assets a
                SET reference_images = COALESCE((
                    SELECT jsonb_agg(value)
                    FROM jsonb_array_elements_text(a.reference_images) AS value
                    WHERE value <> $1
                ), '[]'::jsonb)
                WHERE reference_images IS NOT NULL
                  AND jsonb_typeof(reference_images) = 'array'
                  AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements_text(a.reference_images) AS value
                    WHERE value = $1
                  )
                """,
                file_url,
            )
        except Exception as exc:
            logger.warning("Failed to clear assets.reference_images file reference: %s", exc)

    @staticmethod
    async def delete_file_record(file_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute("DELETE FROM files WHERE file_id = $1", file_id)
        return result == "DELETE 1"

    @staticmethod
    async def mark_file_purge_failed(file_id: str, error: str) -> None:
        db = get_db_manager()
        if not db:
            return
        await db.execute(
            """
            UPDATE files
            SET metadata = COALESCE(metadata, '{}'::jsonb)
                         || $2::jsonb
            WHERE file_id = $1
            """,
            file_id,
            json.dumps({"purge_failed": True, "purge_error": error}, ensure_ascii=False),
        )
