





from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager

logger = logging.getLogger(__name__)


_ALLOWED_ROLES = {"owner", "admin", "member"}
_ALLOWED_STATUS = {"active", "archived"}


class OrganizationDAO:

    @staticmethod
    async def create(
        name: str,
        owner_user_id: str,
        *,
        description: str = "",
        color: Optional[str] = None,
        created_by: Optional[str] = None,
        org_id: Optional[str] = None,
    ) -> Dict[str, Any]:

        db = get_db_manager()
        oid = org_id or f"org_{uuid.uuid4().hex[:14]}"
        row = await db.fetchrow(
            """
            INSERT INTO organizations (
                org_id, name, description, owner_user_id, color, created_by
            ) VALUES ($1,$2,$3,$4,$5,$6)
            RETURNING *
            """,
            oid, name, description, owner_user_id, color, created_by,
        )
        if row:
            await db.execute(
                """
                INSERT INTO organization_members (org_id, user_id, role, added_by)
                VALUES ($1, $2, 'owner', $3)
                ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'owner'
                """,
                oid, owner_user_id, created_by or owner_user_id,
            )
        return dict(row) if row else None

    @staticmethod
    async def get(org_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow("SELECT * FROM organizations WHERE org_id = $1", org_id)
        return dict(row) if row else None

    @staticmethod
    async def list_all(
        *,
        status: Optional[str] = None,
        keyword: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:

        db = get_db_manager()
        where = []
        params: List[Any] = []
        idx = 1
        if status:
            where.append(f"o.status = ${idx}")
            params.append(status)
            idx += 1
        if keyword:
            where.append(f"(o.name ILIKE ${idx} OR o.description ILIKE ${idx})")
            params.append(f"%{keyword}%")
            idx += 1
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        params.extend([limit, offset])
        sql = f"""
            SELECT o.*,
                   u.username AS owner_name,
                   (SELECT COUNT(*) FROM organization_members m WHERE m.org_id = o.org_id) AS member_count
            FROM organizations o
            LEFT JOIN users u ON u.user_id = o.owner_user_id
            {where_sql}
            ORDER BY o.created_at DESC
            LIMIT ${idx} OFFSET ${idx + 1}
        """
        rows = await db.fetch(sql, *params)
        return [dict(r) for r in rows]

    @staticmethod
    async def count_all(
        *,
        status: Optional[str] = None,
        keyword: Optional[str] = None,
    ) -> int:
        db = get_db_manager()
        where = []
        params: List[Any] = []
        idx = 1
        if status:
            where.append(f"status = ${idx}")
            params.append(status)
            idx += 1
        if keyword:
            where.append(f"(name ILIKE ${idx} OR description ILIKE ${idx})")
            params.append(f"%{keyword}%")
            idx += 1
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        row = await db.fetchrow(f"SELECT COUNT(*) AS c FROM organizations {where_sql}", *params)
        return int(row["c"]) if row else 0

    @staticmethod
    async def update(org_id: str, fields: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not fields:
            return await OrganizationDAO.get(org_id)
        allowed = {"name", "description", "status", "color", "owner_user_id"}
        sets, params = [], []
        idx = 1
        for k, v in fields.items():
            if k not in allowed:
                continue
            if k == "status" and v not in _ALLOWED_STATUS:
                raise ValueError(f"invalid status: {v}; allowed={_ALLOWED_STATUS}")
            sets.append(f"{k} = ${idx}")
            params.append(v)
            idx += 1
        if not sets:
            return await OrganizationDAO.get(org_id)
        params.append(org_id)
        db = get_db_manager()
        row = await db.fetchrow(
            f"UPDATE organizations SET {', '.join(sets)} WHERE org_id = ${idx} RETURNING *",
            *params,
        )
        return dict(row) if row else None

    @staticmethod
    async def delete(org_id: str) -> None:

        db = get_db_manager()
        await db.execute(
            "DELETE FROM resource_shares WHERE share_target_type='org' AND share_target_id=$1",
            org_id,
        )
        await db.execute("DELETE FROM organizations WHERE org_id = $1", org_id)


class OrganizationMemberDAO:

    @staticmethod
    async def add_member(
        org_id: str,
        user_id: str,
        *,
        role: str = "member",
        added_by: Optional[str] = None,
    ) -> Dict[str, Any]:
        if role not in _ALLOWED_ROLES:
            raise ValueError(f"invalid role: {role}; allowed={_ALLOWED_ROLES}")
        db = get_db_manager()
        row = await db.fetchrow(
            """
            INSERT INTO organization_members (org_id, user_id, role, added_by)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role
            RETURNING *
            """,
            org_id, user_id, role, added_by,
        )
        return dict(row) if row else None

    @staticmethod
    async def remove_member(org_id: str, user_id: str) -> None:
        db = get_db_manager()
        await db.execute(
            "DELETE FROM organization_members WHERE org_id = $1 AND user_id = $2",
            org_id, user_id,
        )

    @staticmethod
    async def set_role(org_id: str, user_id: str, role: str) -> Optional[Dict[str, Any]]:
        if role not in _ALLOWED_ROLES:
            raise ValueError(f"invalid role: {role}; allowed={_ALLOWED_ROLES}")
        db = get_db_manager()
        row = await db.fetchrow(
            """
            UPDATE organization_members SET role = $3
            WHERE org_id = $1 AND user_id = $2
            RETURNING *
            """,
            org_id, user_id, role,
        )
        return dict(row) if row else None

    @staticmethod
    async def list_members(org_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        rows = await db.fetch(
            """
            SELECT m.org_id, m.user_id, m.role, m.joined_at, m.added_by,
                   u.username, u.email
            FROM organization_members m
            LEFT JOIN users u ON u.user_id = m.user_id
            WHERE m.org_id = $1
            ORDER BY
                CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                m.joined_at ASC
            """,
            org_id,
        )
        return [dict(r) for r in rows]

    @staticmethod
    async def list_orgs_for_user(user_id: str) -> List[Dict[str, Any]]:

        db = get_db_manager()
        rows = await db.fetch(
            """
            SELECT o.*, m.role AS my_role, m.joined_at AS my_joined_at
            FROM organizations o
            INNER JOIN organization_members m ON m.org_id = o.org_id
            WHERE m.user_id = $1 AND o.status = 'active'
            ORDER BY m.joined_at ASC
            """,
            user_id,
        )
        return [dict(r) for r in rows]

    @staticmethod
    async def is_member(org_id: str, user_id: str) -> bool:
        db = get_db_manager()
        row = await db.fetchrow(
            "SELECT 1 FROM organization_members WHERE org_id = $1 AND user_id = $2",
            org_id, user_id,
        )
        return row is not None

    @staticmethod
    async def get_role(org_id: str, user_id: str) -> Optional[str]:
        db = get_db_manager()
        row = await db.fetchrow(
            "SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2",
            org_id, user_id,
        )
        return row["role"] if row else None
