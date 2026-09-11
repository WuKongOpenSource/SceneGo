


import uuid
import json
from typing import List, Dict, Any, Optional

from db_manager import get_db_manager


class AudioTrackDAO:

    @staticmethod
    async def create(
        episode_id: str,
        track_type: str,
        name: str = '',
        audio_url: Optional[str] = None,
        duration_ms: Optional[int] = None,
        start_item_id: Optional[str] = None,
        end_item_id: Optional[str] = None,
        generation_params: Optional[dict] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        track_id = f"atrk_{uuid.uuid4().hex[:12]}"
        query = """
            INSERT INTO audio_tracks
                (track_id, episode_id, track_type, name, audio_url, duration_ms,
                 start_item_id, end_item_id, generation_params)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
            RETURNING *
        """
        return await db.fetchrow(
            query, track_id, episode_id, track_type, name,
            audio_url, duration_ms, start_item_id, end_item_id,
            json.dumps(generation_params or {}, ensure_ascii=False)
        )

    @staticmethod
    async def get_by_episode(episode_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            "SELECT * FROM audio_tracks WHERE episode_id = $1 ORDER BY created_at ASC",
            episode_id
        )

    @staticmethod
    async def get_by_id(track_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM audio_tracks WHERE track_id = $1", track_id
        )

    @staticmethod
    async def update(track_id: str, **kwargs) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        allowed = {'name', 'audio_url', 'duration_ms', 'start_item_id', 'end_item_id'}
        json_fields = {'generation_params'}
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
            return await AudioTrackDAO.get_by_id(track_id)
        vals.append(track_id)
        query = f"UPDATE audio_tracks SET {', '.join(sets)} WHERE track_id = ${idx} RETURNING *"
        return await db.fetchrow(query, *vals)

    @staticmethod
    async def delete(track_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM audio_tracks WHERE track_id = $1", track_id
        )
        return result == "DELETE 1"
