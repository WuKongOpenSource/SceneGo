





from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager

logger = logging.getLogger(__name__)


class ProjectGroupDAO:

    @staticmethod
    async def create(
        user_id: str,
        group_name: str,
        *,
        description: str = '',
        color: Optional[str] = None,
        sort_order: int = 0,
        team_id: Optional[str] = None,
        group_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        gid = group_id or f"grp_{uuid.uuid4().hex[:14]}"
        row = await db.fetchrow(
            """
            INSERT INTO project_groups (
                group_id, user_id, team_id, group_name, description, color, sort_order
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING *
            """,
            gid, user_id, team_id, group_name, description, color, sort_order,
        )
        return dict(row) if row else None

    @staticmethod
    async def get(group_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow("SELECT * FROM project_groups WHERE group_id = $1", group_id)
        return dict(row) if row else None

    @staticmethod
    async def list_for_user(user_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        rows = await db.fetch(
            """
            SELECT pg.*,
                   (SELECT COUNT(*) FROM projects p WHERE p.group_id = pg.group_id AND p.is_deleted IS NOT TRUE) AS project_count
            FROM project_groups pg
            WHERE pg.user_id = $1
            ORDER BY pg.sort_order, pg.group_name
            """,
            user_id,
        )
        return [dict(r) for r in rows]

    @staticmethod
    async def list_all() -> List[Dict[str, Any]]:

        db = get_db_manager()
        rows = await db.fetch(
            """
            SELECT pg.*, u.username AS owner_name,
                   (SELECT COUNT(*) FROM projects p WHERE p.group_id = pg.group_id AND p.is_deleted IS NOT TRUE) AS project_count
            FROM project_groups pg
            LEFT JOIN users u ON u.user_id = pg.user_id
            ORDER BY pg.created_at DESC
            """,
        )
        return [dict(r) for r in rows]

    @staticmethod
    async def update(group_id: str, fields: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not fields:
            return await ProjectGroupDAO.get(group_id)
        allowed = {'group_name', 'description', 'color', 'sort_order', 'team_id'}
        sets, params = [], []
        idx = 1
        for k, v in fields.items():
            if k not in allowed:
                continue
            sets.append(f"{k} = ${idx}")
            params.append(v)
            idx += 1
        if not sets:
            return await ProjectGroupDAO.get(group_id)
        params.append(group_id)
        db = get_db_manager()
        row = await db.fetchrow(
            f"UPDATE project_groups SET {', '.join(sets)} WHERE group_id = ${idx} RETURNING *",
            *params,
        )
        return dict(row) if row else None

    @staticmethod
    async def delete(group_id: str) -> None:
        db = get_db_manager()
        await db.execute("DELETE FROM project_groups WHERE group_id = $1", group_id)

    @staticmethod
    async def move_project(project_id: str, group_id: Optional[str]) -> None:

        db = get_db_manager()
        await db.execute(
            "UPDATE projects SET group_id = $2 WHERE project_id = $1",
            project_id, group_id,
        )

    @staticmethod
    async def list_projects(group_id: Optional[str]) -> List[Dict[str, Any]]:
        db = get_db_manager()
        rows = await db.fetch(
            """
            SELECT p.project_id, p.project_name, p.user_id, p.group_id, p.is_archived,
                   u.username AS owner_name
            FROM projects p LEFT JOIN users u ON u.user_id = p.user_id
            WHERE p.is_deleted IS NOT TRUE AND p.group_id IS NOT DISTINCT FROM $1::varchar
            ORDER BY p.project_name, p.project_id
            """, group_id,
        )
        return [dict(row) for row in rows]
