"""Legacy authentication and profile routes."""

from __future__ import annotations

import os
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from services.binding_token_service import create_binding_token
from core.session_cookie import session_response_payload, set_session_cookie
from services.captcha_service import CAPTCHA_COOKIE, CaptchaError, CaptchaInvalid, verify_captcha
from services.auth_rate_limit_service import (
    AuthRateLimitConfigurationError,
    AuthRateLimited,
    AuthRateLimitUnavailable,
    clear_login_identity,
    consume_login_attempt,
)
from services.session_auth_service import issue_session_token


class UserRegister(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=1024)
    email: Optional[str] = Field(default=None, max_length=320)
    captcha_verification: Optional[str] = Field(default=None, max_length=8192)


class UserLogin(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=1024)
    captcha_verification: Optional[str] = Field(default=None, max_length=8192)


def create_auth_legacy_router(
    *,
    get_current_user_dependency: Any,
    user_dao: Any,
    activity_log_dao: Any,
    create_session_token: Any,
    get_redis_client: Any = None,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    UserDAO = user_dao
    ActivityLogDAO = activity_log_dao

    @router.post("/api/auth/register")
    async def register_user(user_data: UserRegister, request: Request):
        """Register a user through the legacy auth path."""
        if os.getenv("ALLOW_PUBLIC_REGISTRATION", "false").lower() not in ("1", "true", "yes", "on"):
            raise HTTPException(status_code=403, detail="公开注册已关闭，请联系管理员开通账号")
        redis_client = (
            get_redis_client()
            if callable(get_redis_client)
            else getattr(request.app.state, "redis_client", None)
        )
        try:
            if any(ord(character) < 32 for character in user_data.username) or any(
                character in user_data.username for character in ("/", "\\")
            ):
                raise HTTPException(status_code=400, detail="用户名包含不支持的字符")
            await consume_login_attempt(
                redis_client,
                identity=f"register:{user_data.username}",
                remote_ip=request.client.host if request.client else None,
            )
            await verify_captcha(
                user_data.captcha_verification,
                remote_ip=request.client.host if request.client else None,
                expected_action="register",
                redis_client=redis_client,
                session_id=request.cookies.get(CAPTCHA_COOKIE, ""),
            )
            if len(user_data.password) < 8:
                raise HTTPException(status_code=400, detail="密码至少 8 位")

            lookup_any = getattr(UserDAO, "get_user_by_username_any", None)
            existing_user = (
                await lookup_any(user_data.username)
                if callable(lookup_any)
                else await UserDAO.get_user_by_username(user_data.username)
            )
            if existing_user:
                raise HTTPException(status_code=400, detail="用户名已存在")

            user = await UserDAO.create_user(
                username=user_data.username,
                password=user_data.password,
                email=user_data.email,
            )

            await clear_login_identity(redis_client, identity=f"register:{user_data.username}")

            return {
                "success": True,
                "user_id": user['user_id'],
                "username": user['username']
            }

        except CaptchaInvalid as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except CaptchaError as exc:
            raise HTTPException(status_code=503, detail="人机验证服务暂不可用，请稍后重试") from exc
        except AuthRateLimited as exc:
            raise HTTPException(
                status_code=429,
                detail=str(exc),
                headers={"Retry-After": str(exc.retry_after)},
            ) from exc
        except (AuthRateLimitConfigurationError, AuthRateLimitUnavailable) as exc:
            raise HTTPException(status_code=503, detail="注册保护服务暂不可用，请稍后重试") from exc
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail="注册失败，请稍后重试") from exc

    @router.post("/api/auth/login")
    async def login_user(login_data: UserLogin, response: Response, request: Request):
        """Log in through the legacy auth path."""
        redis_client = (
            get_redis_client()
            if callable(get_redis_client)
            else getattr(request.app.state, "redis_client", None)
        )
        try:
            await consume_login_attempt(
                redis_client,
                identity=login_data.username,
                remote_ip=request.client.host if request.client else None,
            )
            await verify_captcha(
                login_data.captcha_verification,
                remote_ip=request.client.host if request.client else None,
                expected_action="login",
                redis_client=redis_client,
                session_id=request.cookies.get(CAPTCHA_COOKIE, ""),
            )
            user = await UserDAO.verify_password(
                login_data.username,
                login_data.password
            )

            if not user:
                raise HTTPException(status_code=401, detail="用户名或密码错误")

            user_status = user.get('status') if isinstance(user, dict) else None
            if user_status and user_status != 'active':
                reason = (user.get('disabled_reason') if isinstance(user, dict) else None) or '账户已被管理员禁用'
                raise HTTPException(status_code=403, detail=f"账户已被禁用：{reason}")

            if isinstance(user, dict):
                if not bool(user.get('legacy_login_enabled')):
                    raise HTTPException(status_code=401, detail="该账号已切换为手机号登录")
                if not bool(user.get('phone_verified')):
                    await clear_login_identity(redis_client, identity=login_data.username)
                    return {
                        "success": True,
                        "requires_phone_binding": True,
                        "binding_token": create_binding_token(str(user['user_id'])),
                        "username": user['username'],
                        "user_id": user['user_id'],
                    }

            await ActivityLogDAO.log_activity(
                user_id=user['user_id'],
                action='login'
            )

            await clear_login_identity(redis_client, identity=login_data.username)
            token = await issue_session_token(
                str(user['user_id']),
                user_dao=UserDAO,
                token_creator=create_session_token,
            )
            set_session_cookie(response, token)

            return session_response_payload(request, token, {
                "success": True,
                "user_id": user['user_id'],
                "username": user['username'],
            })

        except CaptchaInvalid as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except CaptchaError as exc:
            raise HTTPException(status_code=503, detail="人机验证服务暂不可用，请稍后重试") from exc
        except AuthRateLimited as exc:
            raise HTTPException(
                status_code=429,
                detail=str(exc),
                headers={"Retry-After": str(exc.retry_after)},
            ) from exc
        except (AuthRateLimitConfigurationError, AuthRateLimitUnavailable) as exc:
            raise HTTPException(status_code=503, detail="登录保护服务暂不可用，请稍后重试") from exc
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail="登录失败，请稍后重试") from exc

    @router.get("/api/user/profile")
    async def get_user_profile(user_id: str = Depends(get_current_user)):
        """Return the current user's profile and storage statistics."""
        try:
            user = await UserDAO.get_user_by_id(user_id)
            if not user:
                raise HTTPException(status_code=404, detail="用户不存在")

            storage_stats = await UserDAO.get_storage_stats(user_id)

            return {
                "success": True,
                "user": user,
                "storage_stats": storage_stats
            }

        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail="读取用户资料失败") from exc

    return router
