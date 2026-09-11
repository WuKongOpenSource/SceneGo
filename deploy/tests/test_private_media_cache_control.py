"""Confidential media caching, independent of private node capabilities."""
import pytest
from fastapi import FastAPI
from fastapi.responses import Response
from httpx import ASGITransport, AsyncClient


@pytest.mark.parametrize("path", ["/storage/file.webp", "/uploads/file.mp4"])
@pytest.mark.parametrize("status", [200, 401, 403, 404, 500])
async def test_project_media_is_not_publicly_cached(path, status):
    from public_main import CacheControlMiddleware

    app = FastAPI()
    app.add_middleware(CacheControlMiddleware)

    @app.get(path)
    async def media():
        return Response(status_code=status, headers={"Cache-Control": "public, max-age=600"})

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.get(path)
    assert response.status_code == status
    assert response.headers["cache-control"] == "private, no-store, max-age=0"
    assert response.headers["pragma"] == "no-cache"
