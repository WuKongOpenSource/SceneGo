from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.fallback_static import create_fallback_static_router


def _client(tmp_path):
    app = FastAPI()
    app.include_router(
        create_fallback_static_router(deploy_root=tmp_path, logger=logging.getLogger(__name__))
    )
    return TestClient(app)


def test_root_image_fallback_cannot_read_upload_or_process_files(tmp_path, monkeypatch):
    (tmp_path / "uploads").mkdir()
    (tmp_path / "uploads" / "private.png").write_bytes(b"private-media")
    (tmp_path / "cwd-secret.png").write_bytes(b"host-file")
    monkeypatch.chdir(tmp_path)
    client = _client(tmp_path)

    upload_response = client.get("/private.png")
    cwd_response = client.get("/cwd-secret.png")

    assert upload_response.status_code == 404
    assert cwd_response.status_code == 404
    assert b"private-media" not in upload_response.content
    assert b"host-file" not in cwd_response.content


def test_non_image_route_still_serves_spa_entry(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir(parents=True)
    (dist / "index.html").write_text("<html>public-shell</html>", encoding="utf-8")

    response = _client(tmp_path).get("/projects-shell")

    assert response.status_code == 200
    assert "public-shell" in response.text
