"""Current-user session and organization self-service routes."""
from __future__ import annotations

import logging
from collections.abc import MutableMapping
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from services import user_profile_service
from services.user_session_service import (
    OrganizationMemberRequired,
    OrganizationNotFound,
    OrganizationOwnerLeaveForbidden,
    get_user_info as get_user_info_service,
    leave_organization as leave_organization_service,
    list_user_organizations,
    logout_user,
)
from core.session_cookie import clear_session_cookies, session_response_payload, set_session_cookie


class ProfileUpdateRequest(BaseModel):
    username: Optional[str] = None
    phone_number: Optional[str] = None
    verification_code: Optional[str] = None


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)


def create_user_session_router(
    *,
    require_auth_dependency: Any,
    online_users: MutableMapping[str, Any],
    organization_dao: Any,
    organization_member_dao: Any,
    user_dao: Any,
    project_dao: Any,
    project_member_dao: Any,
    credit_account_dao: Any,
    logger: logging.Logger,
    create_session_token: Any = None,
    mark_user_offline: Any = None,
) -> APIRouter:
    router = APIRouter()

    @router.post("/api/logout")
    async def logout(response: Response, username: str = Depends(require_auth_dependency)):
        result = logout_user(username, online_users=online_users)
        clear_session_cookies(response)
        if mark_user_offline:
            await mark_user_offline(username)
        return result

    @router.get("/api/user/info")
    async def get_user_info(username: str = Depends(require_auth_dependency)):
        return get_user_info_service(username)

    @router.get("/api/me/profile")
    async def get_my_profile(user_id: str = Depends(require_auth_dependency)):
        try:
            return await user_profile_service.get_profile_summary(
                user_id,
                user_dao=user_dao,
                project_dao=project_dao,
                project_member_dao=project_member_dao,
                credit_account_dao=credit_account_dao,
                logger=logger,
            )
        except user_profile_service.UserProfileNotFound as exc:
            raise HTTPException(status_code=404, detail="用户不存在") from exc
        except Exception as exc:
            logger.error("get_my_profile failed user_id=%s err=%s", user_id, exc, exc_info=True)
            raise HTTPException(status_code=500, detail="获取个人中心失败") from exc

    @router.put("/api/me/profile")
    async def update_my_profile(
        body: ProfileUpdateRequest,
        response: Response,
        request: Request,
        user_id: str = Depends(require_auth_dependency),
    ):
        try:
            result = await user_profile_service.update_profile(
                user_id,
                username=body.username,
                phone_number=body.phone_number,
                verification_code=body.verification_code,
                user_dao=user_dao,
            )
            if result.get("username_changed") and create_session_token:
                # JWT subject keeps the stable user_id; display-name changes do not alter ownership.
                token = create_session_token(user_id)
                set_session_cookie(response, token)
                result = session_response_payload(request, token, result)
            return result
        except user_profile_service.UserProfileNotFound as exc:
            raise HTTPException(status_code=404, detail="用户不存在") from exc
        except user_profile_service.UsernameAlreadyExists as exc:
            raise HTTPException(status_code=400, detail="用户名已存在") from exc
        except user_profile_service.InvalidUsername as exc:
            raise HTTPException(status_code=400, detail="用户名需为 2-40 位中文、字母、数字、下划线或连字符") from exc
        except user_profile_service.InvalidPhoneNumber as exc:
            raise HTTPException(status_code=400, detail="手机号格式不正确") from exc
        except user_profile_service.InvalidVerificationCode as exc:
            raise HTTPException(status_code=400, detail="验证码不正确") from exc
        except user_profile_service.PhoneIdentityImmutable as exc:
            raise HTTPException(status_code=400, detail="手机号是登录身份，不能在个人资料中直接修改") from exc
        except Exception as exc:
            logger.error("update_my_profile failed user_id=%s err=%s", user_id, exc, exc_info=True)
            raise HTTPException(status_code=500, detail="更新个人资料失败") from exc

    @router.post("/api/me/password")
    async def change_my_password(
        body: PasswordChangeRequest,
        user_id: str = Depends(require_auth_dependency),
    ):
        try:
            return await user_profile_service.change_password(
                user_id,
                current_password=body.current_password,
                new_password=body.new_password,
                user_dao=user_dao,
            )
        except user_profile_service.UserProfileNotFound as exc:
            raise HTTPException(status_code=404, detail="用户不存在") from exc
        except user_profile_service.InvalidPassword as exc:
            raise HTTPException(status_code=400, detail="当前密码错误或新密码不符合要求") from exc
        except Exception as exc:
            logger.error("change_my_password failed user_id=%s err=%s", user_id, exc, exc_info=True)
            raise HTTPException(status_code=500, detail="修改密码失败") from exc

    @router.get("/api/me/organizations")
    async def list_my_organizations(username: str = Depends(require_auth_dependency)):
        return await list_user_organizations(
            username,
            organization_member_dao=organization_member_dao,
            logger=logger,
        )

    @router.post("/api/me/organizations/{org_id}/leave")
    async def leave_organization(org_id: str, username: str = Depends(require_auth_dependency)):
        try:
            return await leave_organization_service(
                org_id,
                username,
                organization_dao=organization_dao,
                organization_member_dao=organization_member_dao,
            )
        except OrganizationNotFound as exc:
            raise HTTPException(status_code=404, detail="组织不存在") from exc
        except OrganizationOwnerLeaveForbidden as exc:
            raise HTTPException(status_code=400, detail="owner 不能主动退出，请先转让 owner 角色") from exc
        except OrganizationMemberRequired as exc:
            raise HTTPException(status_code=400, detail="你不是该组织成员") from exc

    return router
