"""Reusable request authentication dependencies for application routers."""
from __future__ import annotations

from fastapi import HTTPException, Request

from core.session_cookie import request_session_token
from dao_user import UserDAO
from services.session_auth_service import validate_session_token
from services.user_presence_service import touch_user_presence


async def get_current_user(request: Request) -> str:
    """Return the stable user id for an active same-origin session."""
    token = request_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="未授权")
    identity = await validate_session_token(token, user_dao=UserDAO)
    if not identity:
        raise HTTPException(status_code=401, detail="Token已失效或不存在，请重新登录")
    user_id = str(identity["user_id"])
    await touch_user_presence(user_id)
    return user_id


async def get_current_media_user(request: Request) -> str:
    """Authenticate media requests without accepting credentials in the URL."""
    return await get_current_user(request)
