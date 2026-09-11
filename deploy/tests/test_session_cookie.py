from __future__ import annotations

from starlette.requests import Request
from starlette.responses import Response
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
import pytest

from core.session_cookie import (
    DEVELOPMENT_COOKIE_NAME,
    PRODUCTION_COOKIE_NAME,
    clear_session_cookies,
    request_session_token,
    SameOriginSessionMiddleware,
    set_session_cookie,
    SessionCookieUpgradeMiddleware,
)


def _request(*, authorization: str = "", cookie: str = "") -> Request:
    headers = []
    if authorization:
        headers.append((b"authorization", authorization.encode("latin-1")))
    if cookie:
        headers.append((b"cookie", cookie.encode("latin-1")))
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers})


def test_bearer_token_takes_precedence_over_cookie() -> None:
    request = _request(
        authorization="Bearer header-token",
        cookie=f"{DEVELOPMENT_COOKIE_NAME}=cookie-token",
    )

    assert request_session_token(request) == "header-token"


def test_production_cookie_is_host_only_secure_and_http_only(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    response = Response()

    set_session_cookie(response, "signed-token")

    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{PRODUCTION_COOKIE_NAME}=signed-token")
    assert "HttpOnly" in cookie
    assert "Secure" in cookie
    assert "SameSite=strict" in cookie
    assert "Path=/" in cookie
    assert "Domain=" not in cookie


def test_development_cookie_is_read_without_url_token(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "development")
    request = _request(cookie=f"{DEVELOPMENT_COOKIE_NAME}=cookie-token")

    assert request_session_token(request) == "cookie-token"


def test_logout_expires_both_cookie_names() -> None:
    response = Response()

    clear_session_cookies(response)

    cookies = response.headers.getlist("set-cookie")
    assert len(cookies) == 2
    assert any(cookie.startswith(f"{PRODUCTION_COOKIE_NAME}=") for cookie in cookies)
    assert any(cookie.startswith(f"{DEVELOPMENT_COOKIE_NAME}=") for cookie in cookies)
    assert all("Max-Age=0" in cookie for cookie in cookies)


@pytest.mark.asyncio
async def test_valid_legacy_bearer_is_upgraded_to_cookie() -> None:
    app = FastAPI()
    app.add_middleware(
        SessionCookieUpgradeMiddleware,
        token_verifier=lambda token: "owner" if token == "legacy-token" else None,
    )

    @app.get("/api/example")
    async def example():
        return {"success": True}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/api/example",
            headers={"Authorization": "Bearer legacy-token"},
        )

    assert response.status_code == 200
    assert response.headers["x-ostory-session-upgraded"] == "1"
    assert response.cookies.get(DEVELOPMENT_COOKIE_NAME) == "legacy-token"


@pytest.mark.asyncio
async def test_invalid_legacy_bearer_is_not_upgraded() -> None:
    app = FastAPI()
    app.add_middleware(SessionCookieUpgradeMiddleware, token_verifier=lambda _token: None)

    @app.get("/api/example")
    async def example():
        return {"success": True}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/api/example",
            headers={"Authorization": "Bearer invalid-token"},
        )

    assert "x-ostory-session-upgraded" not in response.headers
    assert response.cookies.get(DEVELOPMENT_COOKIE_NAME) is None


@pytest.mark.parametrize("environment", ["development", "production"])
@pytest.mark.parametrize("action", ["replace", "clear", "unrelated"])
async def test_legacy_upgrade_preserves_endpoint_session_decisions(monkeypatch, environment, action):
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", environment)
    name = PRODUCTION_COOKIE_NAME if environment == "production" else DEVELOPMENT_COOKIE_NAME
    app = FastAPI()
    app.add_middleware(SessionCookieUpgradeMiddleware, token_verifier=lambda _token: "old-subject")

    @app.post("/api/example")
    async def example():
        response = Response(status_code=204)
        if action == "replace":
            set_session_cookie(response, "new-stable-id-token")
        elif action == "clear":
            clear_session_cookies(response)
        else:
            response.set_cookie("ui_preference", "compact")
        return response

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        response = await client.post("/api/example", headers={"Authorization": "Bearer legacy-token"})
    cookies = response.headers.get_list("set-cookie")
    assert response.status_code == 204
    assert response.headers["x-ostory-session-upgraded"] == "1"
    if action == "replace":
        assert len(cookies) == 1
        assert response.cookies.get(name) == "new-stable-id-token"
    elif action == "clear":
        assert len(cookies) == 2 and all("Max-Age=0" in cookie for cookie in cookies)
        assert not any("legacy-token" in cookie for cookie in cookies)
    else:
        assert response.cookies.get(name) == "legacy-token"
        assert response.cookies.get("ui_preference") == "compact"


@pytest.mark.asyncio
async def test_cookie_authenticated_post_requires_same_origin() -> None:
    app = FastAPI()
    app.add_middleware(SameOriginSessionMiddleware)

    @app.post("/api/example")
    async def example():
        return {"success": True}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://tv.example") as client:
        client.cookies.set(DEVELOPMENT_COOKIE_NAME, "cookie-token")
        denied = await client.post(
            "/api/example",
            headers={"Origin": "https://attacker.example"},
        )
        allowed = await client.post(
            "/api/example",
            headers={"Origin": "https://tv.example"},
        )

    assert denied.status_code == 403
    assert denied.json()["detail"] == "拒绝跨站会话请求"
    assert allowed.status_code == 200


@pytest.mark.asyncio
async def test_configured_origin_is_exact_and_host_suffix_cannot_bypass() -> None:
    app = FastAPI()
    app.add_middleware(
        SameOriginSessionMiddleware,
        allowed_origins=["https://app.example"],
    )

    @app.post("/api/example")
    async def example():
        return {"success": True}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://internal") as client:
        client.cookies.set(DEVELOPMENT_COOKIE_NAME, "cookie-token")
        configured = await client.post("/api/example", headers={"Origin": "https://app.example"})
        deceptive = await client.post("/api/example", headers={"Origin": "https://evilapp.example"})

    assert configured.status_code == 200
    assert deceptive.status_code == 403


@pytest.mark.asyncio
async def test_bearer_api_client_is_not_subject_to_cookie_csrf_check() -> None:
    app = FastAPI()
    app.add_middleware(SameOriginSessionMiddleware)

    @app.post("/api/example")
    async def example():
        return {"success": True}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://tv.example") as client:
        response = await client.post(
            "/api/example",
            headers={"Authorization": "Bearer api-token"},
        )

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_cross_origin_anonymous_login_cannot_install_an_attacker_session() -> None:
    app = FastAPI()
    app.add_middleware(SameOriginSessionMiddleware)

    @app.post("/api/login")
    async def login():
        return {"success": True}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://tv.example") as client:
        denied = await client.post(
            "/api/login",
            headers={"Origin": "https://attacker.example"},
        )
        allowed = await client.post(
            "/api/login",
            headers={"Origin": "https://tv.example"},
        )

    assert denied.status_code == 403
    assert allowed.status_code == 200


@pytest.mark.asyncio
async def test_explicit_non_browser_login_client_can_request_bearer_mode_without_origin() -> None:
    app = FastAPI()
    app.add_middleware(SameOriginSessionMiddleware)

    @app.post("/api/login")
    async def login():
        return {"success": True}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://tv.example") as client:
        response = await client.post(
            "/api/login",
            headers={"X-Ostory-Session-Mode": "bearer"},
        )

    assert response.status_code == 200
