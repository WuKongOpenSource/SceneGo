import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from routers import auth as auth_router


class Logger:
    def info(self, *_args, **_kwargs):
        pass

    def warning(self, *_args, **_kwargs):
        pass


class FakeUserDAO:
    row = None

    @classmethod
    async def get_user_auth_by_id(cls, _user_id):
        return cls.row

    @classmethod
    async def get_session_identity(cls, _subject):
        return {**cls.row, "is_active": True, "session_version": 1}


def app():
    api = FastAPI()
    api.include_router(
        auth_router.create_auth_router(
            verify_credentials=lambda username, password: username == "legacy" and password == "secret",
            create_session_token=lambda user_id, **_kwargs: f"token:{user_id}",
            logger=Logger(),
        )
    )
    return api


@pytest.fixture(autouse=True)
def patch_dependencies(monkeypatch):
    FakeUserDAO.row = {
        "user_id": "user_legacy",
        "username": "legacy",
        "role": "user",
        "status": "active",
        "legacy_login_enabled": True,
        "phone_verified": False,
    }
    monkeypatch.setattr(auth_router, "UserDAO", FakeUserDAO)

    async def ensure(*_args, **_kwargs):
        return True

    async def resolve(*_args, **_kwargs):
        return "user_legacy"

    monkeypatch.setattr(auth_router, "ensure_login_user_record", ensure)
    monkeypatch.setattr(auth_router, "resolve_authenticated_user_id", resolve)
    monkeypatch.setattr(auth_router, "create_binding_token", lambda user_id: f"bind:{user_id}")


@pytest.mark.asyncio
async def test_built_in_legacy_login_must_bind_phone_before_session():
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        response = await client.post("/api/login", json={"username": "legacy", "password": "secret"})

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "requires_phone_binding": True,
        "binding_token": "bind:user_legacy",
        "username": "legacy",
        "user_id": "user_legacy",
    }


@pytest.mark.asyncio
async def test_super_admin_legacy_login_must_also_bind_phone_before_session():
    FakeUserDAO.row.update(
        user_id="admin",
        username="admin",
        role="super_admin",
        legacy_login_enabled=True,
        phone_verified=False,
    )

    async def resolve(*_args, **_kwargs):
        return "admin"

    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        with pytest.MonkeyPatch.context() as monkeypatch:
            monkeypatch.setattr(auth_router, "resolve_authenticated_user_id", resolve)
            response = await client.post("/api/login", json={"username": "legacy", "password": "secret"})

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "requires_phone_binding": True,
        "binding_token": "bind:admin",
        "username": "legacy",
        "user_id": "admin",
    }


@pytest.mark.asyncio
async def test_verified_legacy_account_receives_session():
    FakeUserDAO.row["phone_verified"] = True
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        response = await client.post("/api/login", json={"username": "legacy", "password": "secret"})

    assert response.status_code == 200
    assert response.json()["session_mode"] == "cookie"
    assert "token" not in response.json()
    assert response.cookies.get("ostory_session") == "token:user_legacy"


@pytest.mark.asyncio
async def test_phone_migrated_account_cannot_keep_using_legacy_username_login():
    FakeUserDAO.row.update(phone_verified=True, legacy_login_enabled=False)
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        response = await client.post("/api/login", json={"username": "legacy", "password": "secret"})

    assert response.status_code == 401
    assert "手机号登录" in response.json()["detail"]
