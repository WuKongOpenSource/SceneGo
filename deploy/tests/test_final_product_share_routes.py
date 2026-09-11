import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

import final_product_share_routes as routes


class MediaDAO:
    item = {
        "library_item_id": "mli_final_1",
        "source": "composed_final",
        "user_id": "user_1",
        "project_id": "proj_1",
        "episode_id": "ep_1",
        "duration_seconds": 90,
    }

    @classmethod
    async def get(cls, library_item_id):
        return dict(cls.item) if library_item_id == "mli_final_1" else None


class ShareDAO:
    share = None
    feedback = []
    public_file_path = ""

    @classmethod
    async def get_active_for_item(cls, _library_item_id):
        return cls.share

    @classmethod
    async def create_or_get(cls, **kwargs):
        cls.share = {
            "share_id": "fps_1",
            "share_token": "public-token-1234567890",
            "library_item_id": kwargs["library_item_id"],
            "owner_user_id": kwargs["owner_user_id"],
            "is_active": True,
            "access_count": 0,
        }
        return cls.share

    @classmethod
    async def deactivate(cls, share_id, owner_user_id):
        if share_id != "fps_1" or owner_user_id != "user_1":
            return False
        cls.share = None
        return True

    @classmethod
    async def get_public(cls, share_token):
        if share_token != "public-token-1234567890" or not cls.share:
            return None
        return {
            "share_id": "fps_1",
            "title": "全片成片",
            "file_path": cls.public_file_path,
            "file_url": "/storage/video/final.mp4",
            "thumbnail_url": "https://internal.invalid/private-thumb.jpg?token=secret",
            "mime_type": "video/mp4",
            "duration_seconds": 90,
        }

    @staticmethod
    async def increment_access(_share_id):
        return None

    @classmethod
    async def add_feedback(cls, **kwargs):
        row = {"feedback_id": "fpf_1", **kwargs}
        cls.feedback.insert(0, row)
        return row

    @classmethod
    async def list_feedback_for_share(cls, _share_id, limit=100):
        return cls.feedback[:limit]

    @classmethod
    async def list_feedback_for_item(cls, _library_item_id, limit=200):
        return cls.feedback[:limit]


def app(*, media_roots=None):
    api = FastAPI()

    async def current_user():
        return "user_1"

    api.include_router(routes.create_final_product_share_router(
        get_current_user_dependency=current_user,
        share_dao=ShareDAO,
        media_dao=MediaDAO,
        media_roots=media_roots,
    ))
    return api


@pytest.fixture(autouse=True)
def reset(monkeypatch):
    ShareDAO.share = None
    ShareDAO.feedback = []
    ShareDAO.public_file_path = ""

    async def allowed(_item, _user_id):
        return True

    monkeypatch.setattr(routes.media_library_service, "can_view", allowed)
    monkeypatch.setattr(routes.media_library_service, "can_mutate", allowed)


@pytest.mark.asyncio
async def test_share_link_is_scoped_to_one_final_and_accepts_timestamped_feedback():
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        created = await client.post("/api/final-products/mli_final_1/share")
        public = await client.get("/api/public/final-products/public-token-1234567890")
        feedback = await client.post("/api/public/final-products/public-token-1234567890/feedback", json={
            "author_name": "审片人",
            "content": "第十二秒转场过快",
            "timestamp_seconds": 12,
        })
        owner = await client.get("/api/final-products/mli_final_1/feedback")

    assert created.status_code == 200
    assert public.status_code == 200
    assert public.json()["final"]["file_url"] == "/api/public/final-products/public-token-1234567890/media"
    assert "file_path" not in public.json()["final"]
    assert "thumbnail_url" not in public.json()["final"]
    assert feedback.status_code == 200
    assert owner.json()["feedback"][0]["content"] == "第十二秒转场过快"
    assert owner.json()["feedback"][0]["timestamp_seconds"] == 12


@pytest.mark.asyncio
async def test_public_feedback_rejects_timestamp_after_final_duration():
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        await client.post("/api/final-products/mli_final_1/share")
        response = await client.post("/api/public/final-products/public-token-1234567890/feedback", json={
            "content": "超出时长",
            "timestamp_seconds": 120,
        })
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_public_routes_reject_malformed_share_tokens_before_database_lookup():
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        response = await client.get("/api/public/final-products/short")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_public_feedback_rejects_database_control_characters():
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        await client.post("/api/final-products/mli_final_1/share")
        response = await client.post(
            "/api/public/final-products/public-token-1234567890/feedback",
            json={"content": "invalid\u0000feedback"},
        )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_stopped_share_immediately_invalidates_public_link():
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        await client.post("/api/final-products/mli_final_1/share")
        stopped = await client.delete("/api/final-products/mli_final_1/share/fps_1")
        public = await client.get("/api/public/final-products/public-token-1234567890")
    assert stopped.status_code == 200
    assert public.status_code == 404


@pytest.mark.asyncio
async def test_public_media_is_scoped_to_active_share_and_allowed_storage_root(tmp_path):
    media = tmp_path / "final.mp4"
    media.write_bytes(b"video-bytes")
    ShareDAO.public_file_path = str(media)

    async with AsyncClient(
        transport=ASGITransport(app=app(media_roots=[tmp_path])),
        base_url="http://test",
    ) as client:
        await client.post("/api/final-products/mli_final_1/share")
        response = await client.get("/api/public/final-products/public-token-1234567890/media")

    assert response.status_code == 200
    assert response.content == b"video-bytes"
    assert response.headers["content-type"].startswith("video/mp4")
    assert response.headers["content-disposition"].startswith("inline;")
    assert response.headers["cache-control"] == "private, no-store, max-age=0"


@pytest.mark.asyncio
async def test_public_share_never_inlines_executable_content(tmp_path):
    media = tmp_path / "payload.html"
    media.write_text("<script>alert(1)</script>", encoding="utf-8")
    ShareDAO.public_file_path = str(media)

    async with AsyncClient(
        transport=ASGITransport(app=app(media_roots=[tmp_path])),
        base_url="http://test",
    ) as client:
        await client.post("/api/final-products/mli_final_1/share")
        response = await client.get("/api/public/final-products/public-token-1234567890/media")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/octet-stream")
    assert response.headers["content-disposition"].startswith("attachment;")
    assert response.headers["content-security-policy"].startswith("sandbox")
