





from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager

logger = logging.getLogger(__name__)


def _coerce_jsonb(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


class AdminAuditLogDAO:

    @staticmethod
    async def create(
        admin_user_id: str,
        action: str,
        *,
        target_type: Optional[str] = None,
        target_id: Optional[str] = None,
        before_data: Optional[Dict[str, Any]] = None,
        after_data: Optional[Dict[str, Any]] = None,
        ip: Optional[str] = None,
        user_agent: Optional[str] = None,
        notes: str = '',
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        aid = f"audit_{uuid.uuid4().hex[:16]}"
        try:
            row = await db.fetchrow(
                """
                INSERT INTO admin_audit_logs (
                    audit_id, admin_user_id, action, target_type, target_id,
                    before_data, after_data, ip, user_agent, notes
                ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)
                RETURNING *
                """,
                aid, admin_user_id, action, target_type, target_id,
                json.dumps(before_data or {}), json.dumps(after_data or {}),
                (ip or '')[:64], (user_agent or '')[:512], notes,
            )
            return dict(row) if row else None
        except Exception as e:
            logger.warning(f"admin_audit_logs 写入失败 (action={action}): {e}")
            return None

    @staticmethod
    async def list(
        *,
        admin_user_id: Optional[str] = None,
        action: Optional[str] = None,
        target_type: Optional[str] = None,
        target_id: Optional[str] = None,
        from_dt: Optional[str] = None,
        to_dt: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        db = get_db_manager()
        where = ["TRUE"]
        params: List[Any] = []
        idx = 1
        if admin_user_id:
            where.append(f"admin_user_id = ${idx}"); params.append(admin_user_id); idx += 1
        if action:
            where.append(f"action = ${idx}"); params.append(action); idx += 1
        if target_type:
            where.append(f"target_type = ${idx}"); params.append(target_type); idx += 1
        if target_id:
            where.append(f"target_id = ${idx}"); params.append(target_id); idx += 1
        if from_dt:
            where.append(f"created_at >= ${idx}"); params.append(from_dt); idx += 1
        if to_dt:
            where.append(f"created_at <= ${idx}"); params.append(to_dt); idx += 1
        params.extend([limit, offset])
        try:
            rows = await db.fetch(
                f"""
                SELECT * FROM admin_audit_logs
                WHERE {' AND '.join(where)}
                ORDER BY created_at DESC
                LIMIT ${idx} OFFSET ${idx + 1}
                """,
                *params,
            )
            out: List[Dict[str, Any]] = []
            for r in rows:
                d = dict(r)
                d['before_data'] = _coerce_jsonb(d.get('before_data'))
                d['after_data'] = _coerce_jsonb(d.get('after_data'))
                out.append(d)
            return out
        except Exception as e:
            logger.warning(f"admin_audit_logs 查询失败: {e}")
            return []
