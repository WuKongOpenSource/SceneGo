


import uuid
import json
from typing import List, Dict, Any, Optional

from db_manager import get_db_manager


class CharacterVoiceDAO:

    @staticmethod
    async def create(
        project_id: str,
        character_name: str,
        asset_id: Optional[str] = None,
        voice_provider: Optional[str] = None,
        voice_model_id: Optional[str] = None,
        voice_name: Optional[str] = None,
        voice_params: Optional[dict] = None,
        sample_audio_url: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        vid = str(uuid.uuid4())
        query = """
            INSERT INTO character_voices
                (voice_id, project_id, asset_id, character_name,
                 voice_provider, voice_model_id, voice_name,
                 voice_params, sample_audio_url)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
            RETURNING *
        """
        return await db.fetchrow(
            query, vid, project_id, asset_id, character_name,
            voice_provider, voice_model_id, voice_name,
            json.dumps(voice_params or {}, ensure_ascii=False),
            sample_audio_url
        )

    @staticmethod
    async def get_by_project(project_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            "SELECT * FROM character_voices WHERE project_id = $1 ORDER BY created_at DESC",
            project_id
        )

    @staticmethod
    async def get_by_id(voice_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM character_voices WHERE voice_id = $1::uuid", voice_id
        )

    @staticmethod
    async def update(voice_id: str, **kwargs) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        allowed = {
            'character_name', 'asset_id', 'voice_provider',
            'voice_model_id', 'voice_name', 'sample_audio_url'
        }
        json_fields = {'voice_params'}
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
            return await CharacterVoiceDAO.get_by_id(voice_id)
        sets.append("updated_at = NOW()")
        vals.append(voice_id)
        query = f"UPDATE character_voices SET {', '.join(sets)} WHERE voice_id = ${idx}::uuid RETURNING *"
        return await db.fetchrow(query, *vals)

    @staticmethod
    async def update_sample_audio_url(voice_id: str, sample_audio_url: str) -> None:











        db = get_db_manager()
        if not db:
            return None
        await db.execute(
            "UPDATE character_voices SET sample_audio_url = $1, updated_at = NOW() "
            "WHERE voice_id = $2::uuid",
            sample_audio_url,
            voice_id,
        )
        return None

    @staticmethod
    async def delete(voice_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM character_voices WHERE voice_id = $1::uuid", voice_id
        )
        return result == "DELETE 1"
