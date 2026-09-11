



import uuid
import json
from typing import List, Dict, Any, Optional

from db_manager import get_db_manager


def _seg_id() -> str:
    return f"seg_{uuid.uuid4().hex[:12]}"


class EpisodeScriptSegmentDAO:

    @staticmethod
    async def list_by_script(episode_id: str, script_id: Optional[str], conn=None) -> List[Dict[str, Any]]:
        sql = (
            "SELECT * FROM episode_script_segments "
            "WHERE episode_id = $1 AND script_id IS NOT DISTINCT FROM $2 "
            "ORDER BY segment_order ASC"
        )
        if conn is not None:
            rows = await conn.fetch(sql, episode_id, script_id)
            return [dict(r) for r in rows]
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(sql, episode_id, script_id)
        return [dict(r) for r in rows] if rows else []

    @staticmethod
    async def list_by_episode(episode_id: str, conn=None) -> List[Dict[str, Any]]:
        sql = (
            "SELECT * FROM episode_script_segments "
            "WHERE episode_id = $1 ORDER BY script_id, segment_order ASC"
        )
        if conn is not None:
            rows = await conn.fetch(sql, episode_id)
            return [dict(r) for r in rows]
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(sql, episode_id)
        return [dict(r) for r in rows] if rows else []

    @staticmethod
    async def _insert_one(executor, episode_id: str, script_id: Optional[str], seg: dict) -> Dict[str, Any]:
        seg_id = seg.get("segment_id") or _seg_id()
        row = await executor.fetchrow(
            """
            INSERT INTO episode_script_segments
                (segment_id, episode_id, script_id, segment_order, source_text,
                 estimated_duration_sec, video_script, status, error_message, metadata)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
            RETURNING *
            """,
            seg_id, episode_id, script_id,
            int(seg.get("segment_order", 0)),
            seg.get("source_text", "") or "",
            seg.get("estimated_duration_sec"),
            seg.get("video_script", "") or "",
            seg.get("status", "pending") or "pending",
            seg.get("error_message", "") or "",
            json.dumps(seg.get("metadata") or {}, ensure_ascii=False),
        )
        return dict(row)

    @staticmethod
    async def batch_replace(
        episode_id: str, script_id: Optional[str], segments: list, conn=None
    ) -> List[Dict[str, Any]]:

        async def _run(executor):
            await executor.execute(
                "DELETE FROM episode_script_segments "
                "WHERE episode_id = $1 AND script_id IS NOT DISTINCT FROM $2",
                episode_id, script_id,
            )
            out = []
            for seg in segments:
                out.append(await EpisodeScriptSegmentDAO._insert_one(executor, episode_id, script_id, seg))
            return out

        if conn is not None:
            return await _run(conn)
        db = get_db_manager()
        if not db:
            return []
        async with db.acquire() as c:
            async with c.transaction():
                return await _run(c)

    @staticmethod
    async def delete_by_script(episode_id: str, script_id: Optional[str], conn=None) -> int:
        sql = (
            "DELETE FROM episode_script_segments "
            "WHERE episode_id = $1 AND script_id IS NOT DISTINCT FROM $2"
        )
        executor = conn if conn is not None else get_db_manager()
        if executor is None:
            return 0
        result = await executor.execute(sql, episode_id, script_id)
        try:
            return int(result.split()[-1])
        except Exception:
            return 0
