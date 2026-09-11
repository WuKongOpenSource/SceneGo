from __future__ import annotations

import io
import zipfile

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

import media_library_routes as routes


@pytest.mark.asyncio
async def test_batch_download_bounds_file_paths_and_sanitizes_zip_names(monkeypatch, tmp_path):
    allowed = tmp_path / "allowed.mp4"
    allowed.write_bytes(b"video")
    outside = tmp_path / "outside.txt"
    outside.write_bytes(b"private")

    async def current_user():
        return "user-1"

    async def get_item(item_id, user_id):
        assert user_id == "user-1"
        return {
            "library_item_id": item_id,
            "file_id": f"file-{item_id}",
            "title": "../../escaped.mp4" if item_id == "visible" else "private.txt",
        }

    async def get_file(file_id):
        return {
            "file_id": file_id,
            "file_path": str(allowed if file_id == "file-visible" else outside),
            "file_name": "fallback.bin",
        }

    def resolve(path, **_kwargs):
        return allowed if str(path) == str(allowed) else None

    monkeypatch.setattr(routes.media_library_service, "get_item", get_item)
    monkeypatch.setattr(routes.FileDAO, "get_file", get_file)
    monkeypatch.setattr(routes, "resolve_allowed_media_file", resolve)

    api = FastAPI()
    api.include_router(routes.router)
    api.dependency_overrides[routes.get_current_user] = current_user
    async with AsyncClient(transport=ASGITransport(app=api), base_url="http://test") as client:
        response = await client.post(
            "/api/media-library/batch-download",
            json={"library_item_ids": ["visible", "unsafe"]},
        )

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert archive.namelist() == ["visible_escaped.mp4"]
        assert archive.read("visible_escaped.mp4") == b"video"


@pytest.mark.asyncio
async def test_batch_download_rejects_total_bytes_over_limit(monkeypatch, tmp_path):
    media = tmp_path / "large.mp4"
    media.write_bytes(b"12")

    async def current_user():
        return "user-1"

    async def get_item(item_id, _user_id):
        return {"library_item_id": item_id, "file_id": "file-1", "title": "large.mp4"}

    async def get_file(_file_id):
        return {"file_id": "file-1", "file_path": str(media), "file_name": "large.mp4"}

    monkeypatch.setattr(routes.media_library_service, "get_item", get_item)
    monkeypatch.setattr(routes.FileDAO, "get_file", get_file)
    monkeypatch.setattr(routes, "resolve_allowed_media_file", lambda *_args, **_kwargs: media)
    monkeypatch.setattr(routes, "_batch_download_max_bytes", lambda: 1)

    api = FastAPI()
    api.include_router(routes.router)
    api.dependency_overrides[routes.get_current_user] = current_user
    async with AsyncClient(transport=ASGITransport(app=api), base_url="http://test") as client:
        response = await client.post(
            "/api/media-library/batch-download",
            json={"library_item_ids": ["visible"]},
        )

    assert response.status_code == 413
