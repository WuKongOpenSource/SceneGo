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


@pytest.mark.asyncio
@pytest.mark.parametrize('path,method,length,expected', [
    ('/stream/abc', 'POST', '500', 401),
    ('/stream/abc', 'POST', '1001', 413),
    ('/stream/abc/extra', 'POST', '500', 413),
    ('/stream/abc', 'PUT', '500', 413),
    ('/ordinary', 'POST', '500', 413),
    ('/stream/abc', 'POST', '-1', 411),
    ('/stream/abc', 'POST', None, 411),
])
async def test_streaming_limit_is_exact_and_leaves_auth_before_body(path, method, length, expected):
    async def protected(scope, receive, send):
        # Reject unauthorized clients without consuming or spooling their body.
        await send({'type': 'http.response.start', 'status': 401, 'headers': []})
        await send({'type': 'http.response.body', 'body': b''})
    middleware = RequestBodyLimitMiddleware(protected, max_bytes=5,
                                            streaming_limits={r'/stream/[a-z]+': 1000})
    async def receive():
        raise AssertionError('body must not be read before authentication')
    messages = []
    async def send(message):
        messages.append(message)
    await middleware({'type': 'http', 'method': method, 'path': path,
                      'headers': [(b'content-length', length.encode())] if length else []}, receive, send)
    assert messages[0]['status'] == expected


@pytest.mark.asyncio
async def test_large_known_stream_uses_backpressure_without_spooling(monkeypatch):
    import core.request_body_limit as module
    monkeypatch.setattr(module.tempfile, 'SpooledTemporaryFile', lambda **_: pytest.fail('must stream'))
    api = FastAPI()
    api.add_middleware(RequestBodyLimitMiddleware, max_bytes=5,
                       streaming_limits={r'/stream/abc': 1000})
    @api.post('/stream/abc')
    async def stream(request: Request):
        return {'size': sum([len(chunk) async for chunk in request.stream()])}
    async with AsyncClient(transport=ASGITransport(app=api), base_url='https://test') as client:
        result = await client.post('/stream/abc', content=b'x' * 600)
    assert result.status_code == 200
    assert result.json()['size'] == 600
