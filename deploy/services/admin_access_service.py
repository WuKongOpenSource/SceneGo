"""Database-role authorization shared by private and source-edition admin APIs."""
from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable, Dict, Optional

from fastapi import HTTPException, Request

from core.session_cookie import request_session_token
from dao_user import UserDAO
from services.sensitive_data_redaction import redact_sensitive_text
from services.session_auth_service import validate_session_token

logger = logging.getLogger(__name__)
IdentityLoader = Callable[[str], Awaitable[Optional[Dict[str, Any]]]]


async def load_admin_identity(subject: str) -> Optional[Dict[str, Any]]:
    """Resolve a login name or stable user id without fixed-name privileges."""
    user = await UserDAO.get_user_by_username(subject)
    if user:
        return dict(user)
    user = await UserDAO.admin_get_user_detail(subject)
    return dict(user) if user else None


async def require_admin_access(
    request: Request,
    *,
    identity_loader: IdentityLoader = load_admin_identity,
    session_validator: Any = validate_session_token,
) -> str:
    token = request_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="未授权")
    try:
        user = await session_validator(
            token,
            user_dao=UserDAO,
            identity_loader=identity_loader,
        )
    except Exception as exc:
        logger.error("Admin session lookup failed: %s", redact_sensitive_text(exc), exc_info=True)
        raise HTTPException(status_code=500, detail="鉴权查询失败") from exc
    if not user:
        raise HTTPException(status_code=401, detail="Token 已失效或账号不可用")
    role = str(user.get("role") or "user")
    if role not in {"admin", "super_admin"}:
        raise HTTPException(status_code=403, detail=f"需要管理员权限（当前角色：{role}）")
    return str(user.get("username") or user.get("user_id"))


async def require_super_admin_access(
    request: Request,
    *,
    identity_loader: IdentityLoader = load_admin_identity,
    session_validator: Any = validate_session_token,
) -> str:
    username = await require_admin_access(
        request,
        identity_loader=identity_loader,
        session_validator=session_validator,
    )
    user = await identity_loader(username)
    role = str((user or {}).get("role") or "user")
    if role != "super_admin":
        raise HTTPException(status_code=403, detail=f"需要超级管理员权限（当前角色：{role}）")
    return username


async def require_admin_session(request: Request) -> str:
    """HTTP dependency: service injection hooks must never become request fields."""
    return await require_admin_access(request)


async def require_super_admin_session(request: Request) -> str:
    """Keep role lookup server-owned while preserving the stricter owner policy."""
    return await require_super_admin_access(request)
