





from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager

logger = logging.getLogger(__name__)


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


def _normalize(row: Optional[Dict[str, Any]],
               json_fields: tuple = ('structured_prompt', 'frame_file_ids', 'metadata')) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    out = dict(row)
    for k in json_fields:
        if k in out:
            out[k] = _coerce_jsonb(out[k])
    return out


class VideoReverseTaskDAO:

    @staticmethod
    async def create(
        user_id: str,
        video_file_id: str,
        *,
        task_id: Optional[str] = None,
        project_id: Optional[str] = None,
        episode_id: Optional[str] = None,
        duration_seconds: Optional[float] = None,
        frame_strategy: str = 'uniform',
        language: str = 'zh',
        credit_cost: int = 0,
        metadata: Optional[Dict[str, Any]] = None,
        reverse_task_id: Optional[str] = None,
        video_library_item_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        rid = reverse_task_id or f"vrev_{uuid.uuid4().hex[:16]}"
        row = await db.fetchrow(
            """
            INSERT INTO video_reverse_tasks (
                reverse_task_id, task_id, user_id, project_id, episode_id,
                video_file_id, video_library_item_id,
                duration_seconds, frame_strategy, language,
                status, credit_cost, metadata
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12::jsonb)
            RETURNING *
            """,
            rid, task_id, user_id, project_id, episode_id,
            video_file_id, video_library_item_id,
            duration_seconds, frame_strategy, language,
            credit_cost, json.dumps(metadata or {}),
        )
        return _normalize(row)

    @staticmethod
    async def get(reverse_task_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow(
            """
            SELECT vrt.*, f.file_url AS video_file_url, f.file_name AS video_file_name,
                   f.thumbnail_url AS video_thumbnail_url
            FROM video_reverse_tasks vrt
            JOIN files f ON f.file_id = vrt.video_file_id
            WHERE vrt.reverse_task_id = $1
            """,
            reverse_task_id,
        )
        return _normalize(row)

    @staticmethod
    async def get_by_task_id(task_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow(
            "SELECT * FROM video_reverse_tasks WHERE task_id = $1",
            task_id,
        )
        return _normalize(row)

    @staticmethod
    async def list_for_user(
        user_id: str,
        *,
        project_id: Optional[str] = None,
        episode_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        where = ["vrt.user_id = $1"]
        params: List[Any] = [user_id]
        idx = 2
        if project_id:
            where.append(f"vrt.project_id = ${idx}"); params.append(project_id); idx += 1
        if episode_id:
            where.append(f"vrt.episode_id = ${idx}"); params.append(episode_id); idx += 1
        if status:
            where.append(f"vrt.status = ${idx}"); params.append(status); idx += 1
        params.extend([limit, offset])
        db = get_db_manager()
        rows = await db.fetch(
            f"""
            SELECT vrt.*, f.file_url AS video_file_url, f.file_name AS video_file_name,
                   f.thumbnail_url AS video_thumbnail_url
            FROM video_reverse_tasks vrt
            JOIN files f ON f.file_id = vrt.video_file_id
            WHERE {' AND '.join(where)}
            ORDER BY vrt.created_at DESC
            LIMIT ${idx} OFFSET ${idx + 1}
            """,
            *params,
        )
        return [_normalize(r) for r in rows]

    @staticmethod
    async def update_status(
        reverse_task_id: str,
        status: str,
        *,
        progress: Optional[float] = None,
        error_message: Optional[str] = None,
        completed: bool = False,
        expected_task_id: Optional[str] = None,
    ) -> bool:
        db = get_db_manager()
        protect_cancelled = status != 'cancelled'
        if completed:
            result = await db.execute(
                """
                UPDATE video_reverse_tasks
                SET status = $2, progress = COALESCE($3, progress),
                    error_message = $4, completed_at = CURRENT_TIMESTAMP
                WHERE reverse_task_id = $1
                  AND (NOT $5 OR status <> 'cancelled')
                  AND ($6::text IS NULL OR task_id = $6)
                """,
                reverse_task_id, status, progress, error_message, protect_cancelled, expected_task_id,
            )
        else:
            result = await db.execute(
                """
                UPDATE video_reverse_tasks
                SET status = $2, progress = COALESCE($3, progress),
                    error_message = $4
                WHERE reverse_task_id = $1
                  AND (NOT $5 OR status <> 'cancelled')
                  AND ($6::text IS NULL OR task_id = $6)
                """,
                reverse_task_id, status, progress, error_message, protect_cancelled, expected_task_id,
            )
        return str(result).endswith(' 1')

    @staticmethod
    async def update_results(
        reverse_task_id: str,
        *,
        overall_prompt_zh: str = '',
        overall_prompt_en: str = '',
        overall_negative_prompt: str = '',
        structured_prompt: Optional[Dict[str, Any]] = None,
        frame_file_ids: Optional[List[str]] = None,
        video_library_item_id: Optional[str] = None,
        connection: Any = None,
    ) -> None:
        db = connection if connection is not None else get_db_manager()
        await db.execute(
            """
            UPDATE video_reverse_tasks
            SET overall_prompt_zh = $2,
                overall_prompt_en = $3,
                overall_negative_prompt = $4,
                structured_prompt = $5::jsonb,
                frame_file_ids = $6::jsonb,
                video_library_item_id = COALESCE($7, video_library_item_id)
            WHERE reverse_task_id = $1
            """,
            reverse_task_id,
            overall_prompt_zh, overall_prompt_en, overall_negative_prompt,
            json.dumps(structured_prompt or {}),
            json.dumps(frame_file_ids or []),
            video_library_item_id,
        )

    @staticmethod
    async def complete_analysis(
        reverse_task_id: str, task_id: str, *, prompts: Dict[str, Any],
        frame_file_ids: List[str], segments: List[Dict[str, Any]],
    ) -> bool:
        """Publish one attempt atomically; cancellation or a retry owns newer state."""
        db = get_db_manager()
        async with db.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    'SELECT task_id, status FROM video_reverse_tasks WHERE reverse_task_id=$1 FOR UPDATE',
                    reverse_task_id,
                )
                if not row or row['task_id'] != task_id or row['status'] in ('failed', 'cancelled', 'completed'):
                    return False
                await VideoReverseTaskDAO.update_results(
                    reverse_task_id, **prompts, frame_file_ids=frame_file_ids, connection=conn,
                )
                await VideoReverseSegmentDAO.delete_all_for_task(reverse_task_id, connection=conn)
                await VideoReverseSegmentDAO.create_many(reverse_task_id, segments, connection=conn)
                await conn.execute(
                    "UPDATE video_reverse_tasks SET status='completed', progress=100, error_message=NULL, "
                    "completed_at=CURRENT_TIMESTAMP WHERE reverse_task_id=$1", reverse_task_id,
                )
                return True


class VideoReverseSegmentDAO:

    @staticmethod
    async def create_many(reverse_task_id: str, segments: List[Dict[str, Any]], *, connection: Any = None) -> List[Dict[str, Any]]:
        if not segments:
            return []
        db = connection if connection is not None else get_db_manager()
        out = []
        for idx, seg in enumerate(segments):
            sid = f"vseg_{uuid.uuid4().hex[:16]}"
            row = await db.fetchrow(
                """
                INSERT INTO video_reverse_segments (
                    segment_id, reverse_task_id, sort_order,
                    start_seconds, end_seconds, frame_file_ids,
                    description, prompt_zh, prompt_en,
                    camera_description, motion_description, metadata
                ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb)
                RETURNING *
                """,
                sid, reverse_task_id, seg.get('sort_order', idx),
                float(seg.get('start_seconds', 0)),
                float(seg.get('end_seconds', 0)),
                json.dumps(seg.get('frame_file_ids') or []),
                seg.get('description', ''),
                seg.get('prompt_zh', ''),
                seg.get('prompt_en', ''),
                seg.get('camera_description', ''),
                seg.get('motion_description', ''),
                json.dumps(seg.get('metadata') or {}),
            )
            out.append(_normalize(dict(row), json_fields=('frame_file_ids', 'metadata')))
        return out

    @staticmethod
    async def list_for_task(reverse_task_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        rows = await db.fetch(
            """
            SELECT * FROM video_reverse_segments
            WHERE reverse_task_id = $1
            ORDER BY sort_order
            """,
            reverse_task_id,
        )
        return [_normalize(r, json_fields=('frame_file_ids', 'metadata')) for r in rows]

    @staticmethod
    async def delete_all_for_task(reverse_task_id: str, *, connection: Any = None) -> None:
        db = connection if connection is not None else get_db_manager()
        await db.execute(
            "DELETE FROM video_reverse_segments WHERE reverse_task_id = $1",
            reverse_task_id,
        )
