


import uuid
import json
from typing import List, Dict, Any, Optional

from db_manager import get_db_manager


class VideoSegmentDAO:

    @staticmethod
    async def create(
        episode_id: str,
        sort_order: int = 0,
        storyboard_item_id: Optional[str] = None,
        generation_mode: str = 'i2v',
        model: str = '',
        input_params: Optional[dict] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        seg_id = f"seg_{uuid.uuid4().hex[:12]}"
        query = """
            INSERT INTO video_segments
                (segment_id, episode_id, storyboard_item_id, sort_order,
                 generation_mode, model, input_params)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
            RETURNING *
        """
        return await db.fetchrow(
            query, seg_id, episode_id, storyboard_item_id, sort_order,
            generation_mode, model,
            json.dumps(input_params or {}, ensure_ascii=False)
        )

    @staticmethod
    async def get_by_episode(episode_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            "SELECT * FROM video_segments WHERE episode_id = $1 ORDER BY sort_order ASC",
            episode_id
        )

    @staticmethod
    async def get_by_id(segment_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM video_segments WHERE segment_id = $1", segment_id
        )

    @staticmethod
    async def update(segment_id: str, **kwargs) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        allowed = {'sort_order', 'generation_mode', 'model', 'video_url',
                    'thumbnail_url', 'duration_ms', 'task_id', 'status'}
        json_fields = {'input_params'}
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
            return await VideoSegmentDAO.get_by_id(segment_id)
        vals.append(segment_id)
        query = f"UPDATE video_segments SET {', '.join(sets)} WHERE segment_id = ${idx} RETURNING *"
        return await db.fetchrow(query, *vals)

    @staticmethod
    async def delete(segment_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM video_segments WHERE segment_id = $1", segment_id
        )
        return result == "DELETE 1"
