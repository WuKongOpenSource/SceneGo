"""Project-level character voice references extracted from generated videos."""
import json
import uuid
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager


class VideoVoiceReferenceDAO:

    @staticmethod
    async def get_by_project(project_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            """
            SELECT * FROM video_voice_references
            WHERE project_id = $1
            ORDER BY character_name ASC, updated_at DESC
            """,
            project_id,
        )

    @staticmethod
    async def get_by_id(reference_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM video_voice_references WHERE reference_id = $1",
            reference_id,
        )

    @staticmethod
    async def upsert(
        *,
        project_id: str,
        character_name: str,
        source_video_url: str,
        reference_audio_url: str,
        episode_id: Optional[str] = None,
        storyboard_item_id: Optional[str] = None,
        video_segment_id: Optional[str] = None,
        video_model: Optional[str] = None,
        created_by: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        reference_id = f"vvr_{uuid.uuid4().hex[:16]}"
        return await db.fetchrow(
            """
            INSERT INTO video_voice_references
                (reference_id, project_id, episode_id, storyboard_item_id,
                 video_segment_id, character_name, source_video_url,
                 reference_audio_url, video_model, created_by, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
            ON CONFLICT (project_id, character_name) DO UPDATE SET
                episode_id = EXCLUDED.episode_id,
                storyboard_item_id = EXCLUDED.storyboard_item_id,
                video_segment_id = EXCLUDED.video_segment_id,
                source_video_url = EXCLUDED.source_video_url,
                reference_audio_url = EXCLUDED.reference_audio_url,
                video_model = EXCLUDED.video_model,
                created_by = EXCLUDED.created_by,
                metadata = EXCLUDED.metadata,
                updated_at = NOW()
            RETURNING *
            """,
            reference_id,
            project_id,
            episode_id,
            storyboard_item_id,
            video_segment_id,
            character_name.strip(),
            source_video_url,
            reference_audio_url,
            video_model,
            created_by,
            json.dumps(metadata or {}, ensure_ascii=False),
        )

    @staticmethod
    async def delete(reference_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM video_voice_references WHERE reference_id = $1",
            reference_id,
        )
        return result == "DELETE 1"
