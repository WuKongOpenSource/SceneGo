import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from routers.frontend_pages import create_frontend_pages_router


@pytest.mark.asyncio
async def test_global_tools_direct_links_serve_only_the_spa(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("routers.frontend_pages.DEPLOY_ROOT", tmp_path)
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist/index.html").write_text("<html>tools-app</html>", encoding="utf-8")
    (tmp_path / ".env").write_text("PRIVATE_VALUE=must-not-leak", encoding="utf-8")
    app = FastAPI()
    app.include_router(create_frontend_pages_router())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for path in ("/tools", "/tools/", "/tools/image-upscale", "/tools/materials", "/tools/history", "/tools/recycle-bin", "/tools/.env"):
            response = await client.get(path)
            assert response.status_code == 200
            assert response.text == "<html>tools-app</html>"
            assert "no-store" in response.headers["cache-control"]
        for path in ("/.env", "/api/projects", "/api/admin/api-configs"):
            assert (await client.get(path)).status_code == 404
