from __future__ import annotations

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from routers import auth
from services.auth_rate_limit_service import AuthRateLimited


class _UserDAO:
    @staticmethod
    async def get_user_auth_by_id(user_id: str):
        return {
            "user_id": user_id,
            "username": "owner",
            "status": "active",
            "legacy_login_enabled": True,
            "phone_verified": True,
        }

    @staticmethod
    async def update_last_login(_user_id: str):
        return True

    @staticmethod
    async def get_session_identity(user_id: str):
        return {
            "user_id": user_id,
            "username": "owner",
            "status": "active",
            "is_active": True,
            "session_version": 1,
        }


@pytest.mark.asyncio
async def test_successful_login_applies_pending_bootstrap_after_account_sync(monkeypatch) -> None:
    events: list[str] = []

    async def ensure_record(_username: str, _password: str, *, logger):
        events.append("account-synced")
        return True

    async def apply_bootstrap():
        events.append("bootstrap-applied")

    async def resolve_user_id(_username: str, *, user_dao):
        return "owner-id"

    monkeypatch.setattr(auth, "UserDAO", _UserDAO)
    monkeypatch.setattr(auth, "ensure_login_user_record", ensure_record)
    monkeypatch.setattr(auth, "resolve_authenticated_user_id", resolve_user_id)

    app = FastAPI()
    app.include_router(
        auth.create_auth_router(
            verify_credentials=lambda username, password: username == "owner" and password == "valid-password",
            create_session_token=lambda user_id, **_kwargs: f"token:{user_id}",
            logger=type("Logger", (), {"info": lambda *_args: None, "warning": lambda *_args: None})(),
            apply_admin_bootstrap=apply_bootstrap,
        )
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/login",
            json={"username": "owner", "password": "valid-password"},
        )

    assert response.status_code == 200
    assert response.json()["session_mode"] == "cookie"
    assert "token" not in response.json()
    assert response.cookies.get("ostory_session") == "token:owner-id"
    assert response.headers["Cache-Control"] == "no-store"
    assert events == ["account-synced", "bootstrap-applied"]


@pytest.mark.asyncio
async def test_login_exposes_bearer_only_when_api_client_explicitly_requests_it(monkeypatch) -> None:
    async def ensure_record(_username: str, _password: str, *, logger):
        return True

    async def resolve_user_id(_username: str, *, user_dao):
        return "owner-id"

    monkeypatch.setattr(auth, "UserDAO", _UserDAO)
    monkeypatch.setattr(auth, "ensure_login_user_record", ensure_record)
    monkeypatch.setattr(auth, "resolve_authenticated_user_id", resolve_user_id)

    app = FastAPI()
    app.include_router(
        auth.create_auth_router(
            verify_credentials=lambda username, password: True,
            create_session_token=lambda user_id, **_kwargs: f"token:{user_id}",
            logger=type("Logger", (), {"info": lambda *_args: None, "warning": lambda *_args: None})(),
        )
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/login",
            headers={"X-Ostory-Session-Mode": "bearer"},
            json={"username": "owner", "password": "valid-password"},
        )

    assert response.status_code == 200
    assert response.json()["session_mode"] == "cookie+bearer"
    assert response.json()["token"] == "token:owner-id"


@pytest.mark.asyncio
async def test_login_rate_limit_stops_authentication_and_sets_retry_after(monkeypatch) -> None:
    credential_calls: list[tuple[str, str]] = []

    async def reject_attempt(*_args, **_kwargs):
        raise AuthRateLimited(321)

    monkeypatch.setattr(auth, "consume_login_attempt", reject_attempt)

    app = FastAPI()
    app.include_router(
        auth.create_auth_router(
            verify_credentials=lambda username, password: credential_calls.append((username, password)),
            create_session_token=lambda user_id, **_kwargs: f"token:{user_id}",
            logger=type("Logger", (), {"error": lambda *_args: None})(),
            get_redis_client=lambda: object(),
        )
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/login",
            json={"username": "owner", "password": "invalid-password"},
        )

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "321"
    assert credential_calls == []
