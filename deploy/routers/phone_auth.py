"""Public phone authentication, legacy phone binding, and verified email routes."""
from __future__ import annotations

import logging
import os
import secrets
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from services.binding_token_service import verify_binding_token
from services.creation_point_service import grant_daily_login_points
from services.email_delivery_service import enqueue_verification_email, smtp_enabled
from services.phone_auth_service import (
    AccountDisabled,
    AccountExists,
    AccountNotFound,
    InvalidCredentials,
    InvalidEmail,
    InvalidPhone,
    PhoneAuthError,
    begin_email_binding,
    bind_legacy_phone,
    login_phone_code,
    login_phone_password,
    merge_email_preferences,
    normalize_phone,
    register_phone_account,
    reset_phone_password,
    verify_email_binding,
)
from services.sms_provider_service import SmsProviderError, build_sms_provider
from services.verification_code_service import (
    VerificationCodeInvalid,
    VerificationCodeManager,
    VerificationConfigurationError,
    VerificationRateLimited,
)
from core.session_cookie import session_response_payload, set_session_cookie
from services.captcha_service import (
    CAPTCHA_COOKIE,
    TOKEN_PATTERN,
    CaptchaConfigurationError,
    CaptchaInvalid,
    CaptchaRateLimited,
    CaptchaUnavailable,
    create_challenge,
    check_challenge,
    public_captcha_config,
    verify_captcha,
)
from services.auth_rate_limit_service import (
    AuthRateLimitConfigurationError,
    AuthRateLimited,
    AuthRateLimitUnavailable,
    clear_login_identity,
    consume_login_attempt,
)
from services.session_auth_service import issue_session_token


class CaptchaChallengeRequest(BaseModel):
    action: Literal["login", "register", "sms_register", "sms_login", "sms_bind_phone", "sms_password_reset"]


class CaptchaCheckRequest(CaptchaChallengeRequest):
    challenge_id: str = Field(..., pattern=r"^[A-Za-z0-9_-]{43}$")
    x: float = Field(..., ge=0, le=320, allow_inf_nan=False)


class SmsCodeRequest(BaseModel):
    phone: str = Field(..., min_length=1, max_length=32)
    purpose: Literal["register", "login", "bind_phone", "password_reset"]
    binding_token: Optional[str] = Field(default=None, max_length=8192)
    captcha_verification: Optional[str] = Field(default=None, max_length=8192)


class PhoneRegisterRequest(BaseModel):
    phone: str = Field(..., min_length=1, max_length=32)
    code: str = Field(..., min_length=6, max_length=6)
    password: str = Field(..., min_length=8, max_length=128)
    email: Optional[str] = Field(default=None, max_length=255)


class PhoneLoginRequest(BaseModel):
    phone: str = Field(..., min_length=1, max_length=32)
    method: Literal["password", "sms_code"] = "password"
    password: Optional[str] = Field(default=None, max_length=128)
    code: Optional[str] = Field(default=None, max_length=6)
    captcha_verification: Optional[str] = Field(default=None, max_length=8192)


class LegacyPhoneBindRequest(BaseModel):
    binding_token: str = Field(..., min_length=1, max_length=8192)
    phone: str = Field(..., min_length=1, max_length=32)
    code: str = Field(..., min_length=6, max_length=6)


class PasswordResetRequest(BaseModel):
    phone: str = Field(..., min_length=1, max_length=32)
    code: str = Field(..., min_length=6, max_length=6)
    new_password: str = Field(..., min_length=8, max_length=128)


class EmailBindingRequest(BaseModel):
    email: str = Field(..., min_length=1, max_length=255)


class EmailVerifyRequest(BaseModel):
    email: str = Field(..., min_length=1, max_length=255)
    code: str = Field(..., min_length=6, max_length=6)


class EmailPreferencesRequest(BaseModel):
    task_success: Optional[bool] = None
    task_failure: Optional[bool] = None
    credit_alert: Optional[bool] = None
    sharing: Optional[bool] = None


def create_phone_auth_router(
    *,
    get_redis_client: Any,
    create_session_token: Any,
    require_auth_dependency: Any,
    user_dao: Any,
    logger: logging.Logger,
    mark_user_online: Any = None,
) -> APIRouter:
    router = APIRouter()

    def manager() -> VerificationCodeManager:
        redis_client = get_redis_client()
        if redis_client is None:
            raise HTTPException(status_code=503, detail="验证码服务暂不可用")
        try:
            return VerificationCodeManager(redis_client)
        except VerificationConfigurationError as exc:
            logger.error("Verification configuration is invalid: %s", exc)
            raise HTTPException(status_code=503, detail="验证码服务配置不完整") from exc

    async def token_response(
        user: dict[str, Any],
        http_response: Response,
        request: Request,
    ) -> dict[str, Any]:
        user_id = str(user["user_id"])
        token = await issue_session_token(
            user_id,
            user_dao=user_dao,
            token_creator=create_session_token,
        )
        set_session_cookie(http_response, token)
        return session_response_payload(request, token, {
            "success": True,
            "user_id": user_id,
            "username": user.get("username") or user_id,
            "phone": user.get("phone_number"),
            "email": user.get("email"),
            "email_verified": bool(user.get("email_verified")),
        })

    async def authenticated_response(
        user: dict[str, Any],
        http_response: Response,
        request: Request,
    ) -> dict[str, Any]:
        if hasattr(user_dao, "update_last_login"):
            await user_dao.update_last_login(str(user["user_id"]))
        if mark_user_online:
            await mark_user_online(str(user["user_id"]))
        response = await token_response(user, http_response, request)
        try:
            gift = await grant_daily_login_points(str(user["user_id"]))
            account = gift.get("account") or {}
            response["daily_gift"] = {
                "granted": bool(gift.get("granted")),
                "amount": int(gift.get("amount") or 0),
                "expires_at": gift.get("expires_at"),
            }
            response["creation_points"] = {
                "available": int(account.get("available_credits") or 0),
                "account": int(account.get("account_credits") or 0),
                "gift": int(account.get("gift_credits") or 0),
                "gift_expires_at": account.get("gift_expires_at"),
            }
        except Exception as exc:

            logger.warning("Daily creation-point grant failed user_id=%s: %s", user.get("user_id"), exc)
        return response

    def map_auth_error(exc: Exception) -> HTTPException:
        if isinstance(exc, CaptchaRateLimited):
            return HTTPException(status_code=429, detail=str(exc), headers={"Retry-After": str(exc.retry_after)})
        if isinstance(exc, VerificationRateLimited):
            return HTTPException(status_code=429, detail="验证码发送过于频繁，请稍后重试")
        if isinstance(exc, VerificationCodeInvalid):
            return HTTPException(status_code=400, detail="验证码错误或已失效")
        if isinstance(exc, (InvalidPhone, InvalidEmail)):
            return HTTPException(status_code=400, detail="手机号或邮箱格式不正确")
        if isinstance(exc, AccountExists):
            return HTTPException(status_code=409, detail=str(exc))
        if isinstance(exc, AccountDisabled):
            return HTTPException(status_code=403, detail="账号已被禁用")
        if isinstance(exc, (InvalidCredentials, AccountNotFound)):
            return HTTPException(status_code=401, detail="账号或凭证错误")
        if isinstance(exc, SmsProviderError):
            return HTTPException(status_code=503, detail="短信发送失败，请稍后重试")
        if isinstance(exc, CaptchaInvalid):
            return HTTPException(status_code=400, detail=str(exc))
        if isinstance(exc, (CaptchaConfigurationError, CaptchaUnavailable)):
            return HTTPException(status_code=503, detail="人机验证服务暂不可用，请稍后重试")
        if isinstance(exc, AuthRateLimited):
            return HTTPException(
                status_code=429,
                detail=str(exc),
                headers={"Retry-After": str(exc.retry_after)},
            )
        if isinstance(exc, (AuthRateLimitConfigurationError, AuthRateLimitUnavailable)):
            return HTTPException(status_code=503, detail="登录保护服务暂不可用，请稍后重试")
        return HTTPException(status_code=400, detail=str(exc) or "认证请求失败")

    @router.get("/api/auth/captcha-config")
    async def captcha_config(request: Request, response: Response):
        try:
            config = public_captcha_config()
            if config["enabled"] and not TOKEN_PATTERN.fullmatch(request.cookies.get(CAPTCHA_COOKIE, "")):
                response.set_cookie(
                    CAPTCHA_COOKIE, secrets.token_urlsafe(32), max_age=3600,
                    httponly=True, samesite="strict", path="/",
                    secure=os.getenv("OSTORY_RUNTIME_ENV", "development").lower() == "production" or request.url.scheme == "https",
                )
            response.headers["Cache-Control"] = "no-store"
            return config
        except CaptchaConfigurationError as exc:
            logger.error("CAPTCHA configuration is invalid: %s", exc)
            raise HTTPException(status_code=503, detail="人机验证服务配置不完整") from exc

    @router.post("/api/auth/captcha/challenge")
    async def slider_captcha_challenge(body: CaptchaChallengeRequest, request: Request, response: Response):
        response.headers["Cache-Control"] = "no-store"
        try:
            return await create_challenge(
                redis_client=get_redis_client(), session_id=request.cookies.get(CAPTCHA_COOKIE, ""),
                remote_ip=request.client.host if request.client else None, action=body.action,
            )
        except Exception as exc:
            raise map_auth_error(exc) from exc

    @router.post("/api/auth/captcha/check")
    async def slider_captcha_check(body: CaptchaCheckRequest, request: Request, response: Response):
        response.headers["Cache-Control"] = "no-store"
        try:
            return await check_challenge(
                redis_client=get_redis_client(), session_id=request.cookies.get(CAPTCHA_COOKIE, ""),
                remote_ip=request.client.host if request.client else None, action=body.action,
                challenge_id=body.challenge_id, x=body.x,
            )
        except Exception as exc:
            raise map_auth_error(exc) from exc

    @router.post("/api/auth/sms-code")
    async def send_sms_code(body: SmsCodeRequest, request: Request):
        try:
            await verify_captcha(
                body.captcha_verification,
                remote_ip=request.client.host if request.client else None,
                expected_action=f"sms_{body.purpose}",
                redis_client=get_redis_client(),
                session_id=request.cookies.get(CAPTCHA_COOKIE, ""),
            )
            phone = normalize_phone(body.phone)
            if body.purpose == "bind_phone":
                user_id = verify_binding_token(body.binding_token or "")
                if not user_id or not await user_dao.get_user_auth_by_id(user_id):
                    raise InvalidCredentials("binding token is invalid")
            elif body.purpose == "login":
                if not await user_dao.get_user_by_phone(phone):
                    return {
                        "success": True,
                        "sent": False,
                        "next_action": "register",
                        "phone": phone,
                        "message": "该手机号尚未注册，请先注册",
                    }
            elif body.purpose == "password_reset":
                # Password reset keeps account discovery private. The frontend
                # must not claim that a code was sent when no delivery occurred.
                if not await user_dao.get_user_by_phone(phone):
                    return {
                        "success": True,
                        "sent": False,
                        "expires_in": 300,
                        "resend_in": 60,
                    }
            elif await user_dao.get_user_by_phone(phone):
                raise AccountExists("手机号已注册，请直接登录")

            provider = build_sms_provider()
            result = await manager().issue(
                channel="sms",
                target=phone,
                purpose=body.purpose,
                sender=provider.send_code,
            )
            response = {
                "success": True,
                "sent": True,
                "expires_in": result["expires_in"],
                "resend_in": result["resend_in"],
            }
            if result.get("development_code"):
                response["development_code"] = result["development_code"]
            return response
        except Exception as exc:
            raise map_auth_error(exc) from exc

    @router.post("/api/auth/phone/register")
    async def register(body: PhoneRegisterRequest, response: Response, request: Request):
        try:
            user = await register_phone_account(
                phone=body.phone,
                password=body.password,
                email=body.email,
                code=body.code,
                verification_manager=manager(),
                user_dao=user_dao,
            )
            email_sent = False
            if user.get("email") and smtp_enabled():
                try:
                    email_result = await manager().issue(
                        channel="email",
                        target=user["email"],
                        purpose="email_verify",
                        sender=enqueue_verification_email,
                    )
                    email_sent = bool(email_result)
                except Exception as email_exc:


                    logger.warning(
                        "Registration email verification enqueue failed user_id=%s: %s",
                        user.get("user_id"),
                        email_exc,
                    )
            payload = await authenticated_response(user, response, request)
            payload["email_verification_sent"] = email_sent
            return payload
        except Exception as exc:
            raise map_auth_error(exc) from exc

    @router.post("/api/auth/phone/login")
    async def phone_login(body: PhoneLoginRequest, response: Response, request: Request):
        try:
            if body.method == "sms_code":
                if not body.code:
                    raise InvalidCredentials("verification code is required")
                user = await login_phone_code(
                    phone=body.phone,
                    code=body.code,
                    verification_manager=manager(),
                    user_dao=user_dao,
                )
            else:
                if not body.password:
                    raise InvalidCredentials("password is required")
                redis_client = get_redis_client()
                normalized_phone = normalize_phone(body.phone)
                await consume_login_attempt(
                    redis_client,
                    identity=normalized_phone,
                    remote_ip=request.client.host if request.client else None,
                )
                await verify_captcha(
                    body.captcha_verification,
                    remote_ip=request.client.host if request.client else None,
                    expected_action="login",
                    redis_client=redis_client,
                    session_id=request.cookies.get(CAPTCHA_COOKIE, ""),
                )
                user = await login_phone_password(phone=body.phone, password=body.password, user_dao=user_dao)
                await clear_login_identity(redis_client, identity=normalized_phone)
            return await authenticated_response(user, response, request)
        except Exception as exc:
            raise map_auth_error(exc) from exc

    @router.post("/api/auth/legacy/bind-phone")
    async def bind_phone(body: LegacyPhoneBindRequest, response: Response, request: Request):
        user_id = verify_binding_token(body.binding_token)
        if not user_id:
            raise HTTPException(status_code=401, detail="绑定凭证已失效，请重新登录旧账号")
        try:
            user = await bind_legacy_phone(
                user_id=user_id,
                phone=body.phone,
                code=body.code,
                verification_manager=manager(),
                user_dao=user_dao,
            )
            return await authenticated_response(user, response, request)
        except Exception as exc:
            raise map_auth_error(exc) from exc

    @router.post("/api/auth/phone/password-reset")
    async def reset_password(body: PasswordResetRequest, response: Response, request: Request):
        try:
            user = await reset_phone_password(
                phone=body.phone,
                code=body.code,
                new_password=body.new_password,
                verification_manager=manager(),
                user_dao=user_dao,
            )
            return await authenticated_response(user, response, request)
        except Exception as exc:
            raise map_auth_error(exc) from exc

    @router.post("/api/me/email/send-code")
    async def send_email_code(
        body: EmailBindingRequest,
        user_id: str = Depends(require_auth_dependency),
    ):
        if not smtp_enabled():
            raise HTTPException(status_code=503, detail="邮件服务尚未配置")
        try:
            row = await begin_email_binding(user_id=user_id, email=body.email, user_dao=user_dao)
            result = await manager().issue(
                channel="email",
                target=row["email"],
                purpose="email_verify",
                sender=enqueue_verification_email,
            )
            return {"success": True, "expires_in": result["expires_in"], "resend_in": result["resend_in"]}
        except Exception as exc:
            raise map_auth_error(exc) from exc

    @router.post("/api/me/email/verify")
    async def verify_email(
        body: EmailVerifyRequest,
        user_id: str = Depends(require_auth_dependency),
    ):
        try:
            row = await verify_email_binding(
                user_id=user_id,
                email=body.email,
                code=body.code,
                verification_manager=manager(),
                user_dao=user_dao,
            )
            return {"success": True, "email": row["email"], "email_verified": True}
        except Exception as exc:
            raise map_auth_error(exc) from exc

    @router.get("/api/me/email-preferences")
    async def get_email_preferences(user_id: str = Depends(require_auth_dependency)):
        user = await user_dao.get_user_auth_by_id(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        return {
            "success": True,
            "email": user.get("email"),
            "email_verified": bool(user.get("email_verified")),
            "preferences": merge_email_preferences(user.get("email_notification_preferences"), {}),
        }

    @router.put("/api/me/email-preferences")
    async def update_email_preferences(
        body: EmailPreferencesRequest,
        user_id: str = Depends(require_auth_dependency),
    ):
        user = await user_dao.get_user_auth_by_id(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        updates = {key: value for key, value in body.model_dump().items() if value is not None}
        preferences = merge_email_preferences(user.get("email_notification_preferences"), updates)
        await user_dao.update_email_notification_preferences(user_id, preferences)
        return {"success": True, "preferences": preferences}

    return router
