import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from routers import auth_legacy


class FakeUserDAO:
    row = None
    created = []

    @classmethod
    async def verify_password(cls, _username, _password):
        return cls.row

    @classmethod
    async def get_session_identity(cls, _subject):
        return {**cls.row, "is_active": True, "session_version": 1}

    @classmethod
    async def get_user_by_username(cls, _username):
        return None

    @classmethod
    async def get_user_by_username_any(cls, _username):
        return None

    @classmethod
    async def create_user(cls, **kwargs):
        cls.created.append(kwargs)
        return {"user_id": "new-user", "username": kwargs["username"]}


class FakeActivityLogDAO:
    calls = []

    @classmethod
    async def log_activity(cls, **kwargs):
        cls.calls.append(kwargs)


def app():
    api = FastAPI()
    api.include_router(
        auth_legacy.create_auth_legacy_router(
            get_current_user_dependency=lambda: "admin",
            user_dao=FakeUserDAO,
            activity_log_dao=FakeActivityLogDAO,
            create_session_token=lambda user_id, **_kwargs: f"token:{user_id}",
        )
    )
    return api


@pytest.fixture(autouse=True)
def reset(monkeypatch):
    FakeUserDAO.row = {
        "user_id": "admin",
        "username": "admin",
        "role": "super_admin",
        "status": "active",
        "legacy_login_enabled": True,
        "phone_verified": False,
    }
    FakeActivityLogDAO.calls = []
    FakeUserDAO.created = []
    monkeypatch.setattr(auth_legacy, "create_binding_token", lambda user_id: f"bind:{user_id}")


@pytest.mark.asyncio
async def test_unverified_super_admin_cannot_bypass_phone_binding_on_legacy_api():
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        response = await client.post("/api/auth/login", json={"username": "admin", "password": "secret"})

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "requires_phone_binding": True,
        "binding_token": "bind:admin",
        "username": "admin",
        "user_id": "admin",
    }
    assert FakeActivityLogDAO.calls == []


@pytest.mark.asyncio
async def test_phone_migrated_admin_cannot_use_legacy_api_login():
    FakeUserDAO.row.update(phone_verified=True, legacy_login_enabled=False)
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        response = await client.post("/api/auth/login", json={"username": "admin", "password": "secret"})

    assert response.status_code == 401
    assert "手机号登录" in response.json()["detail"]


@pytest.mark.asyncio
async def test_verified_legacy_admin_can_finish_migration_window_login():
    FakeUserDAO.row.update(phone_verified=True, legacy_login_enabled=True)
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        response = await client.post("/api/auth/login", json={"username": "admin", "password": "secret"})

    assert response.status_code == 200
    assert response.json()["session_mode"] == "cookie"
    assert "token" not in response.json()
    assert response.cookies.get("ostory_session") == "token:admin"
    assert FakeActivityLogDAO.calls == [{"user_id": "admin", "action": "login"}]


@pytest.mark.asyncio
async def test_enabled_legacy_registration_requires_abuse_controls(monkeypatch):
    calls = []

    async def consume(_redis, **kwargs):
        calls.append(("rate", kwargs))

    async def captcha(value, **kwargs):
        calls.append(("captcha", {"value": value, **kwargs}))

    async def clear(_redis, **kwargs):
        calls.append(("clear", kwargs))

    monkeypatch.setenv("ALLOW_PUBLIC_REGISTRATION", "true")
    monkeypatch.setattr(auth_legacy, "consume_login_attempt", consume)
    monkeypatch.setattr(auth_legacy, "verify_captcha", captcha)
    monkeypatch.setattr(auth_legacy, "clear_login_identity", clear)

    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        response = await client.post(
            "/api/auth/register",
            json={
                "username": "new-user",
                "password": "strong-password",
                "captcha_verification": "captcha-proof",
            },
        )

    assert response.status_code == 200
    assert FakeUserDAO.created[0]["username"] == "new-user"
    assert "user_id" not in FakeUserDAO.created[0]
    assert [kind for kind, _ in calls] == ["rate", "captcha", "clear"]
    assert calls[1][1]["expected_action"] == "register"


@pytest.mark.asyncio
async def test_legacy_registration_rejects_path_like_username_before_database_write(monkeypatch):
    monkeypatch.setenv("ALLOW_PUBLIC_REGISTRATION", "true")

    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        response = await client.post(
            "/api/auth/register",
            json={"username": "../outside", "password": "strong-password"},
        )

    assert response.status_code == 400
    assert FakeUserDAO.created == []
