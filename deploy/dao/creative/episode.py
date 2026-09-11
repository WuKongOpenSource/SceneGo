


import uuid
import json
from typing import List, Dict, Any, Optional

from db_manager import get_db_manager


class EpisodeDAO:

    @staticmethod
    async def create_episode(
        project_id: str,
        episode_number: int,
        episode_name: str = '',
        description: str = '',
        settings: dict = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        eid = f"ep_{uuid.uuid4().hex[:12]}"
        query = """
            INSERT INTO episodes
                (episode_id, project_id, episode_number, episode_name,
                 description, sort_order, settings)
            VALUES ($1, $2, $3, $4, $5, $3, $6)
            RETURNING *
        """
        return await db.fetchrow(
            query, eid, project_id, episode_number,
            episode_name or f'第{episode_number}集',
            description or '',
            json.dumps(settings) if settings else '{}'
        )

    @staticmethod
    async def get_episodes(project_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            """SELECT * FROM episodes
               WHERE project_id=$1
               ORDER BY sort_order ASC, episode_number ASC""",
            project_id
        )

    @staticmethod
    async def get_episode(episode_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM episodes WHERE episode_id=$1",
            episode_id
        )

    @staticmethod
    async def get_project_id(episode_id: str) -> Optional[str]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchval(
            "SELECT project_id FROM episodes WHERE episode_id=$1",
            episode_id
        )

    @staticmethod
    async def update_episode(
        episode_id: str,
        episode_name: str = None,
        description: str = None,
        status: str = None,
        settings: dict = None,
        sort_order: int = None,
    ) -> bool:
        db = get_db_manager()
        if not db:
            return False
        if all(value is None for value in (episode_name, description, status, settings, sort_order)):
            return True
        await db.execute(
            """
            UPDATE episodes
            SET episode_name = CASE WHEN $1::boolean THEN $2::text ELSE episode_name END,
                description = CASE WHEN $3::boolean THEN $4::text ELSE description END,
                status = CASE WHEN $5::boolean THEN $6::text ELSE status END,
                settings = CASE WHEN $7::boolean THEN $8::jsonb ELSE settings END,
                sort_order = CASE WHEN $9::boolean THEN $10::integer ELSE sort_order END
            WHERE episode_id = $11
            """,
            episode_name is not None,
            episode_name,
            description is not None,
            description,
            status is not None,
            status,
            settings is not None,
            json.dumps(settings) if settings is not None else None,
            sort_order is not None,
            sort_order,
            episode_id,
        )
        return True

    @staticmethod
    async def set_workflow_script(episode_id: str, script_id: str) -> Optional[Dict[str, Any]]:
        """Persist the single script that drives the episode workflow."""
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            """
            UPDATE episodes
            SET settings = COALESCE(settings, '{}'::jsonb)
                || jsonb_build_object('workflow_script_id', $2::text)
            WHERE episode_id = $1
            RETURNING *
            """,
            episode_id,
            script_id,
        )

    @staticmethod
    async def delete_episode(episode_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        await db.execute(
            "DELETE FROM assets WHERE episode_id=$1",
            episode_id
        )
        await db.execute(
            "DELETE FROM episodes WHERE episode_id=$1",
            episode_id
        )
        return True

    @staticmethod
    async def get_next_episode_number(project_id: str) -> int:
        db = get_db_manager()
        if not db:
            return 1
        val = await db.fetchval(
            "SELECT COALESCE(MAX(episode_number), 0) + 1 FROM episodes WHERE project_id=$1",
            project_id
        )
        return val or 1

    @staticmethod
    async def reorder_episodes(project_id: str, episode_ids: List[str]) -> bool:
        db = get_db_manager()
        if not db:
            return False
        for i, eid in enumerate(episode_ids):
            await db.execute(
                "UPDATE episodes SET sort_order=$1 WHERE episode_id=$2 AND project_id=$3",
                i, eid, project_id
            )
        return True
