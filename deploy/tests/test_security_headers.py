from __future__ import annotations

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from core.security_headers import (
    SecurityHeadersMiddleware,
    fastapi_documentation_options,
    trusted_host_patterns,
)


def test_production_disables_openapi_and_interactive_docs(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")

    assert fastapi_documentation_options() == {
        "docs_url": None,
        "redoc_url": None,
        "openapi_url": None,
    }


def test_development_keeps_framework_documentation_defaults(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "development")

    assert fastapi_documentation_options() == {}


def test_production_trusted_hosts_are_explicit(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    monkeypatch.delenv("TRUSTED_HOSTS", raising=False)
    with pytest.raises(ValueError, match="TRUSTED_HOSTS"):
        trusted_host_patterns()

    monkeypatch.setenv("TRUSTED_HOSTS", "*")
    with pytest.raises(ValueError):
        trusted_host_patterns()

    monkeypatch.setenv("TRUSTED_HOSTS", "app.example.invalid,api.example.invalid")
    assert trusted_host_patterns() == ["app.example.invalid", "api.example.invalid"]


def app() -> FastAPI:
    api = FastAPI()
    api.add_middleware(SecurityHeadersMiddleware, admin_entry_path="/private-admin")

    @api.get("/{path:path}")
    async def page(path: str):
        return {"path": path}

    return api


@pytest.mark.asyncio
async def test_spa_security_headers_disallow_inline_scripts(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "development")
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="https://tv.example") as client:
        response = await client.get("/projects")

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
    assert "script-src 'self';" in response.headers["Content-Security-Policy"]
    assert "script-src 'self' 'unsafe-inline'" not in response.headers["Content-Security-Policy"]
    assert "Strict-Transport-Security" not in response.headers


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/login", "/legacy-login", "/register", "/bind-phone", "/password-reset"])
async def test_login_csp_uses_only_local_verification_assets(monkeypatch, path) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="https://tv.example") as client:
        response = await client.get(path)

    csp = response.headers["Content-Security-Policy"]
    assert "script-src 'self' 'unsafe-inline';" in csp
    assert "frame-src 'none'" in csp
    assert 'challenges.cloudflare.com' not in csp
    assert csp.count("frame-src ") == 1
    assert response.headers["Strict-Transport-Security"] == "max-age=31536000; includeSubDomains"
    assert "frame-ancestors 'none';" in csp


@pytest.mark.asyncio
async def test_auth_and_admin_responses_are_not_cached(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "development")
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="https://tv.example") as client:
        auth_response = await client.get("/api/auth/captcha-config")
        admin_response = await client.get("/api/admin/session")

    assert auth_response.headers["Cache-Control"] == "no-store"
    assert admin_response.headers["Cache-Control"] == "no-store"


@pytest.mark.asyncio
@pytest.mark.parametrize("path", [
    "/private-admin/legacy",
    "/private-admin/legacy/?embed=1&page=cluster",
    "/private-admin/legacy/?embed=1&page=workflows",
    "/private-admin/legacy/?embed=1&page=dashboard",
    "/private-admin/legacy/index.html?embed=1",
    "/studio?projectId=project&episodeId=episode",
    "/studio/?projectId=project&episodeId=episode",
    "/studio/index.html?projectId=project&episodeId=episode",
])
async def test_embedded_documents_allow_only_same_origin_ancestors(path) -> None:
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="https://tv.example") as client:
        response = await client.get(path)

    csp = response.headers["Content-Security-Policy"]
    assert response.headers["X-Frame-Options"] == "SAMEORIGIN"
    assert "frame-ancestors 'self';" in csp
    assert csp.count("frame-ancestors ") == 1
    assert "default-src 'self';" in csp
    if path.startswith("/studio"):
        assert "script-src 'self';" in csp
    else:
        assert "script-src 'self' 'unsafe-inline';" in csp


@pytest.mark.asyncio
@pytest.mark.parametrize("path", [
    "/login?embed=1", "/register", "/projects", "/api/admin/session",
    "/private-admin/settings?item=cluster", "/private-admin/legacy-other/",
    "/private-admin/legacy/nested.html", "/different-admin/legacy/",
    "/studio-other/", "/studio/assets/example.js", "/uploads/index.html",
    "/studio/nested.html", "/studio/index.html/other",
])
async def test_frame_exception_does_not_apply_to_other_pages_or_prefixes(path) -> None:
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="https://tv.example") as client:
        response = await client.get(path)

    csp = response.headers["Content-Security-Policy"]
    assert response.headers["X-Frame-Options"] == "DENY"
    assert "frame-ancestors 'none';" in csp
    assert csp.count("frame-ancestors ") == 1
    if path == "/private-admin/legacy-other/":
        assert "script-src 'self';" in csp


@pytest.mark.asyncio
async def test_frame_exception_preserves_authentication_response() -> None:
    from fastapi.responses import JSONResponse

    api = FastAPI()
    api.add_middleware(SecurityHeadersMiddleware, admin_entry_path="/private-admin/")

    @api.get("/private-admin/legacy/")
    async def denied():
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)

    async with AsyncClient(transport=ASGITransport(app=api), base_url="https://tv.example") as client:
        response = await client.get("/private-admin/legacy/?embed=1&page=cluster")

    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}
    assert "frame-ancestors 'self';" in response.headers["Content-Security-Policy"]


@pytest.mark.asyncio
async def test_real_embedded_static_pages_receive_compatible_headers(tmp_path, monkeypatch) -> None:
    from pathlib import Path
    from fastapi.staticfiles import StaticFiles
    from routers.frontend_pages import create_frontend_pages_router

    deploy_root = Path(__file__).resolve().parents[1]
    monkeypatch.chdir(deploy_root)
    api = FastAPI()
    api.add_middleware(SecurityHeadersMiddleware, admin_entry_path="/private-admin")
    api.mount("/private-admin/legacy", StaticFiles(directory=deploy_root / "admin", html=True))
    studio_dist = tmp_path / "studio-dist"
    studio_dist.mkdir()
    (studio_dist / "index.html").write_text("<html><body>Studio</body></html>", encoding="utf-8")
    monkeypatch.setattr("routers.frontend_pages._studio_dist_dir", lambda: studio_dist)
    api.include_router(create_frontend_pages_router())

    async with AsyncClient(transport=ASGITransport(app=api), base_url="https://tv.example") as client:
        for path in ["/private-admin/legacy/?embed=1&page=cluster", "/private-admin/legacy/?embed=1&page=workflows", "/studio/", "/studio/index.html"]:
            response = await client.get(path)
            assert response.status_code == 200
            assert response.headers["Content-Type"].startswith("text/html")
            assert response.headers["X-Frame-Options"] == "SAMEORIGIN"
            assert "frame-ancestors 'self';" in response.headers["Content-Security-Policy"]
        script = await client.get("/private-admin/legacy/app.js")
        assert script.status_code == 200
        assert "frame-ancestors 'none';" in script.headers["Content-Security-Policy"]


@pytest.mark.asyncio
async def test_existing_restrictive_media_policy_is_preserved() -> None:
    from fastapi.responses import Response

    api = FastAPI()
    api.add_middleware(SecurityHeadersMiddleware, admin_entry_path="/private-admin")

    @api.get("/uploads/document.html")
    async def media():
        return Response(headers={"Content-Security-Policy": "sandbox; default-src 'none'"})

    async with AsyncClient(transport=ASGITransport(app=api), base_url="https://tv.example") as client:
        response = await client.get("/uploads/document.html")

    assert response.headers["Content-Security-Policy"] == "sandbox; default-src 'none'"
    assert response.headers["X-Frame-Options"] == "DENY"
