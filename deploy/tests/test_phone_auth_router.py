import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from routers import phone_auth
from core.session_cookie import session_cookie_name


class Logger:
    def __init__(self):
        self.warnings = []

    def error(self, *_args, **_kwargs):
        pass

    def warning(self, *args, **_kwargs):
        self.warnings.append((args, _kwargs))


class FailingEmailManager:
    def __init__(self, _redis):
        pass

    async def issue(self, **_kwargs):
        raise RuntimeError("mail queue unavailable")


class MissingPhoneDao:
    async def get_user_by_phone(self, _phone):
        return None


class ExistingPhoneDao:
    async def get_user_by_phone(self, phone):
        return {"user_id": "user_phone", "phone_number": phone}


class SessionUserDao:
    async def get_session_identity(self, user_id):
        return {
            "user_id": user_id,
            "username": "13800138000",
            "status": "active",
            "is_active": True,
            "session_version": 1,
        }


class RecordingSmsManager:
    calls = []

    def __init__(self, _redis):
        pass

    async def issue(self, **kwargs):
        self.calls.append(kwargs)
        return {"expires_in": 300, "resend_in": 60}


@pytest.mark.asyncio
async def test_sms_login_for_unregistered_phone_redirects_to_registration_without_sending(monkeypatch):
    provider_calls = []

    def unexpected_provider():
        provider_calls.append(True)
        raise AssertionError("SMS provider must not be called for an unregistered login")

    monkeypatch.setattr(phone_auth, "build_sms_provider", unexpected_provider)

    api = FastAPI()
    api.include_router(
        phone_auth.create_phone_auth_router(
            get_redis_client=lambda: object(),
            create_session_token=lambda user_id, **_kwargs: f"token:{user_id}",
            require_auth_dependency=lambda: {"user_id": "unused"},
            user_dao=MissingPhoneDao(),
            logger=Logger(),
        )
    )

    async with AsyncClient(transport=ASGITransport(app=api), base_url="http://test") as client:
        response = await client.post(
            "/api/auth/sms-code",
            json={"phone": "+86 15889699900", "purpose": "login"},
        )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "success": True,
        "sent": False,
        "next_action": "register",
        "phone": "15889699900",
        "message": "该手机号尚未注册，请先注册",
    }
    assert provider_calls == []


@pytest.mark.asyncio
async def test_sms_login_for_registered_phone_still_sends_login_code(monkeypatch):
    class Provider:
        async def send_code(self, **_kwargs):
            return {"provider_id": "unused-by-manager"}

    RecordingSmsManager.calls = []
    monkeypatch.setattr(phone_auth, "VerificationCodeManager", RecordingSmsManager)
    monkeypatch.setattr(phone_auth, "build_sms_provider", Provider)

    api = FastAPI()
    api.include_router(
        phone_auth.create_phone_auth_router(
            get_redis_client=lambda: object(),
            create_session_token=lambda user_id, **_kwargs: f"token:{user_id}",
            require_auth_dependency=lambda: {"user_id": "unused"},
            user_dao=ExistingPhoneDao(),
            logger=Logger(),
        )
    )

    async with AsyncClient(transport=ASGITransport(app=api), base_url="http://test") as client:
        response = await client.post(
            "/api/auth/sms-code",
            json={"phone": "15889699900", "purpose": "login"},
        )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "success": True,
        "sent": True,
        "expires_in": 300,
        "resend_in": 60,
    }
    assert len(RecordingSmsManager.calls) == 1
    assert RecordingSmsManager.calls[0]["channel"] == "sms"
    assert RecordingSmsManager.calls[0]["target"] == "15889699900"
    assert RecordingSmsManager.calls[0]["purpose"] == "login"


@pytest.mark.asyncio
async def test_optional_email_delivery_failure_does_not_turn_registration_into_failure(monkeypatch):
    logger = Logger()
    user = {
        "user_id": "user_phone",
        "username": "13800138000",
        "phone_number": "13800138000",
        "email": "creator@example.com",
        "email_verified": False,
    }

    async def register(**_kwargs):
        return user

    async def grant(_user_id):
        return {"granted": False, "amount": 0, "account": {}}

    monkeypatch.setattr(phone_auth, "register_phone_account", register)
    monkeypatch.setattr(phone_auth, "grant_daily_login_points", grant)
    monkeypatch.setattr(phone_auth, "smtp_enabled", lambda: True)
    monkeypatch.setattr(phone_auth, "VerificationCodeManager", FailingEmailManager)

    api = FastAPI()
    api.include_router(
        phone_auth.create_phone_auth_router(
            get_redis_client=lambda: object(),
            create_session_token=lambda user_id, **_kwargs: f"token:{user_id}",
            require_auth_dependency=lambda: {"user_id": "user_phone"},
            user_dao=SessionUserDao(),
            logger=logger,
        )
    )

    async with AsyncClient(transport=ASGITransport(app=api), base_url="http://test") as client:
        response = await client.post(
            "/api/auth/phone/register",
            json={
                "phone": "13800138000",
                "code": "888888",
                "password": "secure-pass",
                "email": "creator@example.com",
            },
        )

    assert response.status_code == 200, response.text
    assert response.json()["session_mode"] == "cookie"
    assert "token" not in response.json()
    assert response.cookies.get("ostory_session") == "token:user_phone"
    assert response.json()["email_verification_sent"] is False
    assert logger.warnings


@pytest.mark.asyncio
async def test_phone_password_login_sets_the_browser_session_cookie(monkeypatch):
    user = {
        "user_id": "user_phone",
        "username": "13800138000",
        "phone_number": "13800138000",
        "status": "active",
        "is_active": True,
        "session_version": 1,
    }

    async def login(**_kwargs):
        return user

    async def grant(_user_id):
        return {"granted": False, "amount": 0, "account": {}}

    async def no_op(*_args, **_kwargs):
        return None

    monkeypatch.setattr(phone_auth, "login_phone_password", login)
    monkeypatch.setattr(phone_auth, "grant_daily_login_points", grant)
    monkeypatch.setattr(phone_auth, "consume_login_attempt", no_op)
    monkeypatch.setattr(phone_auth, "verify_captcha", no_op)

    api = FastAPI()
    api.include_router(
        phone_auth.create_phone_auth_router(
            get_redis_client=lambda: object(),
            create_session_token=lambda user_id, **_kwargs: f"token:{user_id}",
            require_auth_dependency=lambda: "user_phone",
            user_dao=SessionUserDao(),
            logger=Logger(),
        )
    )

    async with AsyncClient(transport=ASGITransport(app=api), base_url="http://test") as client:
        response = await client.post(
            "/api/auth/phone/login",
            json={"phone": "13800138000", "password": "secure-pass", "captcha_verification": "ok"},
        )

    assert response.status_code == 200, response.text
    assert response.json()["session_mode"] == "cookie"
    assert response.cookies.get(session_cookie_name()) == "token:user_phone"
