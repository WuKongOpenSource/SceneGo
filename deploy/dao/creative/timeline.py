


import uuid
import json
from typing import List, Dict, Any, Optional

from db_manager import get_db_manager


def _decode_items(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not row:
        return row
    normalized = dict(row)
    items = normalized.get("items")
    if isinstance(items, str):
        try:
            normalized["items"] = json.loads(items)
        except (TypeError, ValueError):
            pass
    return normalized


def _decode_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [_decode_items(row) for row in rows]


class TimelineDAO:

    @staticmethod
    async def create(
        episode_id: str,
        track_type: str,
        track_name: str = '',
        sort_order: int = 0,
        items: Optional[list] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        track_id = f"track_{uuid.uuid4().hex[:12]}"
        query = """
            INSERT INTO timeline_tracks
                (track_id, episode_id, track_type, track_name, sort_order, items)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            RETURNING *
        """
        return _decode_items(
            await db.fetchrow(
                query, track_id, episode_id, track_type, track_name, sort_order,
                json.dumps(items or [], ensure_ascii=False)
            )
        )

    @staticmethod
    async def get_by_episode(episode_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return _decode_rows(
            await db.fetch(
                "SELECT * FROM timeline_tracks "
                "WHERE episode_id = $1 ORDER BY sort_order ASC",
                episode_id
            )
        )

    @staticmethod
    async def get_by_id(track_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return _decode_items(
            await db.fetchrow(
                "SELECT * FROM timeline_tracks WHERE track_id = $1", track_id
            )
        )

    @staticmethod
    async def update(track_id: str, **kwargs) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        allowed = {'track_name', 'sort_order'}
        json_fields = {'items'}
        sets, vals, idx = [], [], 1
        for key, val in kwargs.items():
            if key in allowed and val is not None:
                sets.append(f"{key} = ${idx}")
                vals.append(val)
                idx += 1
            elif key in json_fields and val is not None:
                sets.append(f"{key} = ${idx}::jsonb")
                vals.append(json.dumps(val, ensure_ascii=False))
                idx += 1
        if not sets:
            return await TimelineDAO.get_by_id(track_id)
        vals.append(track_id)
        query = f"UPDATE timeline_tracks SET {', '.join(sets)} WHERE track_id = ${idx} RETURNING *"
        return _decode_items(await db.fetchrow(query, *vals))

    @staticmethod
    async def delete(track_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM timeline_tracks WHERE track_id = $1", track_id
        )
        return result == "DELETE 1"
