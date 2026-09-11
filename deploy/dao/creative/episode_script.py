



import uuid
import json
from typing import Dict, Any, Optional, List

from db_manager import get_db_manager


class EpisodeScriptDAO:

    @staticmethod
    async def list_by_episode(episode_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(
            "SELECT * FROM episode_scripts WHERE episode_id = $1 ORDER BY sort_order, created_at",
            episode_id
        )
        return [dict(r) for r in rows] if rows else []

    @staticmethod
    async def get_by_id(script_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM episode_scripts WHERE script_id = $1", script_id
        )

    @staticmethod
    async def get_by_episode(episode_id: str) -> Optional[Dict[str, Any]]:

        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM episode_scripts WHERE episode_id = $1 ORDER BY sort_order, created_at LIMIT 1",
            episode_id
        )

    @staticmethod
    async def create(
        episode_id: str,
        file_name: str = '未命名文件',
        original_content: str = '',
        adapted_script: str = '',
        sort_order: int = 0,
        metadata: Optional[dict] = None,
        source_type: Optional[str] = None,
        source_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        script_id = f"script_{uuid.uuid4().hex[:12]}"
        query = """
            INSERT INTO episode_scripts
                (script_id, episode_id, file_name, original_content, adapted_script,
                 sort_order, metadata, source_type, source_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
            RETURNING *
        """
        return await db.fetchrow(
            query, script_id, episode_id, file_name,
            original_content, adapted_script, sort_order,
            json.dumps(metadata or {}, ensure_ascii=False), source_type, source_id
        )

    @staticmethod
    async def get_or_create_by_source(
        episode_id: str,
        *,
        source_type: str,
        source_id: str,
        file_name: str,
        original_content: str,
        adapted_script: str,
        sort_order: int,
        metadata: Optional[dict] = None,
    ) -> tuple[Optional[Dict[str, Any]], bool]:
        """Atomically return the canonical script for an external source."""
        db = get_db_manager()
        if not db:
            return None, False

        lock_key = f"episode-script-source:{episode_id}:{source_type}:{source_id}"
        async with db.acquire() as conn:
            async with conn.transaction():
                await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", lock_key)
                existing = await conn.fetchrow(
                    """
                    SELECT * FROM episode_scripts
                    WHERE episode_id = $1 AND source_type = $2 AND source_id = $3
                    LIMIT 1
                    """,
                    episode_id,
                    source_type,
                    source_id,
                )
                if existing:
                    return dict(existing), False

                script_id = f"script_{uuid.uuid4().hex[:12]}"
                created = await conn.fetchrow(
                    """
                    INSERT INTO episode_scripts
                        (script_id, episode_id, file_name, original_content, adapted_script,
                         sort_order, metadata, source_type, source_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
                    ON CONFLICT DO NOTHING
                    RETURNING *
                    """,
                    script_id,
                    episode_id,
                    file_name,
                    original_content,
                    adapted_script,
                    sort_order,
                    json.dumps(metadata or {}, ensure_ascii=False),
                    source_type,
                    source_id,
                )
                if created:
                    return dict(created), True

                existing = await conn.fetchrow(
                    """
                    SELECT * FROM episode_scripts
                    WHERE episode_id = $1 AND source_type = $2 AND source_id = $3
                    LIMIT 1
                    """,
                    episode_id,
                    source_type,
                    source_id,
                )
                return (dict(existing), False) if existing else (None, False)

    @staticmethod
    async def update(
        script_id: str,
        file_name: Optional[str] = None,
        original_content: Optional[str] = None,
        adapted_script: Optional[str] = None,
        sort_order: Optional[int] = None,
        metadata: Optional[dict] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        sets = []
        args = []
        idx = 1
        if file_name is not None:
            sets.append(f"file_name = ${idx}")
            args.append(file_name)
            idx += 1
        if original_content is not None:
            sets.append(f"original_content = ${idx}")
            args.append(original_content)
            idx += 1
        if adapted_script is not None:
            sets.append(f"adapted_script = ${idx}")
            args.append(adapted_script)
            idx += 1
        if sort_order is not None:
            sets.append(f"sort_order = ${idx}")
            args.append(sort_order)
            idx += 1
        if metadata is not None:
            sets.append(f"metadata = ${idx}::jsonb")
            args.append(json.dumps(metadata, ensure_ascii=False))
            idx += 1
        if not sets:
            return await EpisodeScriptDAO.get_by_id(script_id)
        sets.append("updated_at = CURRENT_TIMESTAMP")
        args.append(script_id)
        query = f"UPDATE episode_scripts SET {', '.join(sets)} WHERE script_id = ${idx} RETURNING *"
        return await db.fetchrow(query, *args)

    @staticmethod
    async def save_or_update(
        episode_id: str,
        original_content: str = '',
        adapted_script: str = '',
        metadata: Optional[dict] = None,
        script_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:

        if script_id:
            return await EpisodeScriptDAO.update(
                script_id=script_id,
                original_content=original_content,
                adapted_script=adapted_script,
                metadata=metadata,
            )
        existing = await EpisodeScriptDAO.get_by_episode(episode_id)
        if existing:
            return await EpisodeScriptDAO.update(
                script_id=existing['script_id'],
                original_content=original_content,
                adapted_script=adapted_script,
                metadata=metadata,
            )
        return await EpisodeScriptDAO.create(
            episode_id=episode_id,
            file_name='分集剧本',
            original_content=original_content,
            adapted_script=adapted_script,
            metadata=metadata,
        )

    @staticmethod
    async def upsert_transactional(
        conn,
        episode_id: str,
        original_content: str = '',
        adapted_script: str = '',
        metadata: Optional[dict] = None,
        script_id: Optional[str] = None,
    ) -> None:

        if script_id:
            existing = await conn.fetchrow(
                "SELECT script_id FROM episode_scripts WHERE episode_id = $1 AND script_id = $2",
                episode_id,
                script_id,
            )
        else:
            existing = await conn.fetchrow(
                "SELECT script_id FROM episode_scripts WHERE episode_id = $1 ORDER BY sort_order, created_at LIMIT 1",
                episode_id,
            )
        if existing:
            await conn.execute("""
                UPDATE episode_scripts SET
                    original_content = $1, adapted_script = $2,
                    metadata = $3::jsonb, updated_at = CURRENT_TIMESTAMP
                WHERE script_id = $4
            """, original_content, adapted_script,
                json.dumps(metadata or {}, ensure_ascii=False),
                existing['script_id'],
            )
        else:
            target_script_id = script_id or f"script_{uuid.uuid4().hex[:12]}"
            await conn.execute("""
                INSERT INTO episode_scripts
                    (script_id, episode_id, file_name, original_content, adapted_script, metadata)
                VALUES ($1, $2, '分集剧本', $3, $4, $5::jsonb)
            """, target_script_id, episode_id,
                original_content, adapted_script,
                json.dumps(metadata or {}, ensure_ascii=False),
            )

    @staticmethod
    async def delete(episode_id: str) -> bool:

        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM episode_scripts WHERE episode_id = $1", episode_id
        )
        return 'DELETE' in (result or '')

    @staticmethod
    async def delete_by_id(script_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM episode_scripts WHERE script_id = $1", script_id
        )
        return result == "DELETE 1"

    @staticmethod
    async def get_next_sort_order(episode_id: str) -> int:
        db = get_db_manager()
        if not db:
            return 0
        val = await db.fetchval(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM episode_scripts WHERE episode_id = $1",
            episode_id
        )
        return val or 0
