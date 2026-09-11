import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient

from core.request_body_limit import RequestBodyLimitMiddleware, configured_request_body_limit


def app(max_bytes: int = 5) -> FastAPI:
    api = FastAPI()
    api.add_middleware(RequestBodyLimitMiddleware, max_bytes=max_bytes, spool_memory_bytes=64 * 1024)

    @api.post("/echo")
    async def echo(request: Request):
        body = await request.body()
        return {"size": len(body)}

    return api


@pytest.mark.asyncio
async def test_declared_oversized_body_is_rejected_before_route_parsing() -> None:
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="https://test") as client:
        response = await client.post("/echo", content=b"123456")

    assert response.status_code == 413
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
async def test_body_at_limit_reaches_route() -> None:
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="https://test") as client:
        response = await client.post("/echo", content=b"12345")

    assert response.status_code == 200
    assert response.json() == {"size": 5}


def test_invalid_request_body_limit_fails_closed(monkeypatch) -> None:
    monkeypatch.setenv("MAX_REQUEST_BODY_BYTES", "0")

    with pytest.raises(ValueError):
        configured_request_body_limit()
