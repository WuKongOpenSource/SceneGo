from __future__ import annotations

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from core.safe_errors import safe_http_exception_handler


def app() -> FastAPI:
    api = FastAPI()
    api.add_exception_handler(HTTPException, safe_http_exception_handler)

    @api.get("/server-error")
    async def server_error():
        raise HTTPException(
            status_code=500,
            detail="database failed at C:\\private\\database.env secret=value",
        )

    @api.get("/upstream-error")
    async def upstream_error():
        raise HTTPException(
            status_code=502,
            detail="provider response included a private endpoint",
            headers={"Retry-After": "5"},
        )

    @api.get("/client-error")
    async def client_error():
        raise HTTPException(status_code=400, detail="输入格式不正确")

    @api.get("/unsafe-client-error")
    async def unsafe_client_error():
        raise HTTPException(
            status_code=400,
            detail="failed at C:\\private\\database.env?token=sk-example-secret-value",
        )

    @api.get("/structured-client-error")
    async def structured_client_error():
        raise HTTPException(
            status_code=422,
            detail={
                "message": "invalid /srv/ovideo/private.env",
                "api_key": "sk-example-secret-value",
                "issues": ["password=hunter2"],
            },
        )

    return api


@pytest.mark.asyncio
async def test_production_redacts_internal_server_detail(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        response = await client.get("/server-error")

    assert response.status_code == 500
    assert response.json() == {"detail": "服务器处理请求失败"}
    assert "private" not in response.text


@pytest.mark.asyncio
async def test_production_preserves_status_headers_but_not_upstream_detail(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        response = await client.get("/upstream-error")

    assert response.status_code == 502
    assert response.headers["Retry-After"] == "5"
    assert response.json() == {"detail": "上游服务暂不可用，请稍后重试"}


@pytest.mark.asyncio
async def test_client_errors_and_development_diagnostics_remain_actionable(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        client_error = await client.get("/client-error")
    assert client_error.json() == {"detail": "输入格式不正确"}

    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        unsafe_client_error = await client.get("/unsafe-client-error")
    assert "private" not in unsafe_client_error.text
    assert "sk-example-secret-value" not in unsafe_client_error.text

    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        structured = await client.get("/structured-client-error")
    assert structured.json()["detail"]["api_key"] == "[REDACTED]"
    assert "ovideo" not in structured.text
    assert "hunter2" not in structured.text

    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "development")
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        development_error = await client.get("/server-error")
    assert "database failed" in development_error.json()["detail"]
