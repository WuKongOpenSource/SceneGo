





from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager

logger = logging.getLogger(__name__)


_RESOURCE_TYPES = {"project", "media", "group"}
_TARGET_TYPES = {"org", "project"}


class ResourceShareDAO:

    @staticmethod
    async def create(
        *,
        resource_type: str,
        resource_id: str,
        share_target_type: str,
        share_target_id: str,
        granted_by_user_id: str,
        share_id: Optional[str] = None,
    ) -> Dict[str, Any]:

        if resource_type not in _RESOURCE_TYPES:
            raise ValueError(f"invalid resource_type: {resource_type}; allowed={_RESOURCE_TYPES}")
        if share_target_type not in _TARGET_TYPES:
            raise ValueError(f"invalid share_target_type: {share_target_type}; allowed={_TARGET_TYPES}")

        sid = share_id or f"shr_{uuid.uuid4().hex[:14]}"
        db = get_db_manager()
        row = await db.fetchrow(
            """
            INSERT INTO resource_shares (
                share_id, resource_type, resource_id,
                share_target_type, share_target_id, granted_by_user_id
            ) VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (resource_type, resource_id, share_target_type, share_target_id) DO UPDATE
                SET granted_by_user_id = EXCLUDED.granted_by_user_id
            RETURNING *
            """,
            sid, resource_type, resource_id,
            share_target_type, share_target_id, granted_by_user_id,
        )
        return dict(row) if row else None

    @staticmethod
    async def delete(share_id: str) -> None:
        db = get_db_manager()
        await db.execute("DELETE FROM resource_shares WHERE share_id = $1", share_id)

    @staticmethod
    async def delete_for_resource(
        resource_type: str,
        resource_id: str,
        *,
        share_target_type: Optional[str] = None,
        share_target_id: Optional[str] = None,
    ) -> int:

        db = get_db_manager()
        if share_target_type and share_target_id:
            result = await db.execute(
                """DELETE FROM resource_shares
                   WHERE resource_type = $1 AND resource_id = $2
                     AND share_target_type = $3 AND share_target_id = $4""",
                resource_type,
                resource_id,
                share_target_type,
                share_target_id,
            )
        elif share_target_type:
            result = await db.execute(
                """DELETE FROM resource_shares
                   WHERE resource_type = $1 AND resource_id = $2 AND share_target_type = $3""",
                resource_type,
                resource_id,
                share_target_type,
            )
        elif share_target_id:
            result = await db.execute(
                """DELETE FROM resource_shares
                   WHERE resource_type = $1 AND resource_id = $2 AND share_target_id = $3""",
                resource_type,
                resource_id,
                share_target_id,
            )
        else:
            result = await db.execute(
                "DELETE FROM resource_shares WHERE resource_type = $1 AND resource_id = $2",
                resource_type,
                resource_id,
            )
        try:
            return int(str(result).rsplit(" ", 1)[-1])
        except Exception:
            return 0

    @staticmethod
    async def get(share_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow("SELECT * FROM resource_shares WHERE share_id = $1", share_id)
        return dict(row) if row else None

    @staticmethod
    async def list_for_resource(
        resource_type: str,
        resource_id: str,
    ) -> List[Dict[str, Any]]:

        db = get_db_manager()
        rows = await db.fetch(
            """
            SELECT s.*,
                   CASE WHEN s.share_target_type = 'org'
                        THEN (SELECT name FROM organizations o WHERE o.org_id = s.share_target_id)
                        ELSE (SELECT project_name FROM projects p WHERE p.project_id = s.share_target_id)
                   END AS share_target_name
            FROM resource_shares s
            WHERE s.resource_type = $1 AND s.resource_id = $2
            ORDER BY s.granted_at DESC
            """,
            resource_type, resource_id,
        )
        return [dict(r) for r in rows]

    @staticmethod
    async def list_for_target(
        share_target_type: str,
        share_target_id: str,
        *,
        resource_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:

        db = get_db_manager()
        where = ["share_target_type = $1", "share_target_id = $2"]
        params: List[Any] = [share_target_type, share_target_id]
        idx = 3
        if resource_type:
            where.append(f"resource_type = ${idx}")
            params.append(resource_type)
        rows = await db.fetch(
            f"SELECT * FROM resource_shares WHERE {' AND '.join(where)} ORDER BY granted_at DESC",
            *params,
        )
        return [dict(r) for r in rows]

    @staticmethod
    async def is_resource_shared_with_org(
        resource_type: str,
        resource_id: str,
        org_id: str,
    ) -> bool:

        db = get_db_manager()
        row = await db.fetchrow(
            """
            SELECT 1 FROM resource_shares
            WHERE resource_type = $1 AND resource_id = $2
              AND share_target_type = 'org' AND share_target_id = $3
            """,
            resource_type, resource_id, org_id,
        )
        return row is not None
