import logging

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from routers.storyboard import create_storyboard_router


class _AssetDAO:
    pass


class _EpisodeDAO:
    @staticmethod
    async def get_project_id(_episode_id):
        return "project-1"


async def _allow_project_access(_project_id, _identity, _role):
    return "user-1"


def _build_app(storyboard_dao, episode_script_dao) -> FastAPI:
    app = FastAPI()
    app.include_router(
        create_storyboard_router(
            get_current_user_dependency=lambda: "test-user",
            storyboard_dao=storyboard_dao,
            episode_script_dao=episode_script_dao,
            asset_dao=_AssetDAO,
            episode_dao=_EpisodeDAO,
            logger=logging.getLogger("test_storyboard_stale_script_fallback"),
            project_access_checker=_allow_project_access,
        )
    )
    return app


@pytest.mark.asyncio
async def test_storyboard_items_fallback_for_stale_script_id():
    class StoryboardDAO:
        calls = []

        @staticmethod
        async def get_by_episode(episode_id, script_id=None, limit=None, offset=0, fields=None):
            StoryboardDAO.calls.append((episode_id, script_id, limit, offset, fields))
            if script_id:
                return []
            return [
                {
                    "item_id": "sb_1",
                    "episode_id": episode_id,
                    "script_id": "script_current",
                    "sort_order": 0,
                    "bound_assets": [],
                }
            ]

        @staticmethod
        async def count_by_episode(episode_id, script_id=None):
            return 0 if script_id else 23

    class EpisodeScriptDAO:
        @staticmethod
        async def get_by_id(script_id):
            return None

    app = _build_app(StoryboardDAO, EpisodeScriptDAO)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/api/episodes/ep_1/storyboard-items",
            params={"script_id": "script_deleted", "limit": 10, "include_total": "true"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert [item["item_id"] for item in payload["items"]] == ["sb_1"]
    assert payload["total"] == 23
    assert payload["fallback_script_id"] == "script_deleted"
    assert payload["fallback_reason"] == "stale_script_storyboard"
    assert payload["fallback_scope"] == "episode"
    assert StoryboardDAO.calls == [
        ("ep_1", "script_deleted", 10, 0, None),
        ("ep_1", None, 10, 0, None),
    ]


@pytest.mark.asyncio
async def test_storyboard_items_do_not_fallback_for_valid_empty_script():
    class StoryboardDAO:
        calls = []

        @staticmethod
        async def get_by_episode(episode_id, script_id=None, limit=None, offset=0, fields=None):
            StoryboardDAO.calls.append((episode_id, script_id, limit, offset, fields))
            return []

        @staticmethod
        async def count_by_episode(episode_id, script_id=None):
            return 0 if script_id else 23

    class EpisodeScriptDAO:
        @staticmethod
        async def get_by_id(script_id):
            return {"script_id": script_id, "episode_id": "ep_1"}

    app = _build_app(StoryboardDAO, EpisodeScriptDAO)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/api/episodes/ep_1/storyboard-items",
            params={"script_id": "script_empty", "limit": 10, "include_total": "true"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload == {
        "success": True,
        "items": [],
        "total": 0,
        "limit": 10,
        "offset": 0,
    }
    assert StoryboardDAO.calls == [("ep_1", "script_empty", 10, 0, None)]


@pytest.mark.asyncio
async def test_storyboard_items_fallback_for_partial_stale_script_rows():
    class StoryboardDAO:
        calls = []

        @staticmethod
        async def get_by_episode(episode_id, script_id=None, limit=None, offset=0, fields=None):
            StoryboardDAO.calls.append((episode_id, script_id, limit, offset, fields))
            if script_id:
                return [
                    {
                        "item_id": "sb_stale",
                        "episode_id": episode_id,
                        "script_id": script_id,
                        "sort_order": 0,
                        "bound_assets": [],
                    }
                ]
            return [
                {
                    "item_id": "sb_current",
                    "episode_id": episode_id,
                    "script_id": "script_current",
                    "sort_order": 0,
                    "bound_assets": [],
                }
            ]

        @staticmethod
        async def count_by_episode(episode_id, script_id=None):
            return 1 if script_id else 23

    class EpisodeScriptDAO:
        @staticmethod
        async def get_by_id(script_id):
            return None

    app = _build_app(StoryboardDAO, EpisodeScriptDAO)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/api/episodes/ep_1/storyboard-items",
            params={"script_id": "script_deleted", "limit": 10, "include_total": "true"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert [item["item_id"] for item in payload["items"]] == ["sb_current"]
    assert payload["total"] == 23
    assert payload["fallback_script_id"] == "script_deleted"
    assert payload["fallback_reason"] == "stale_script_storyboard"
    assert payload["fallback_scope"] == "episode"
    assert StoryboardDAO.calls == [
        ("ep_1", "script_deleted", 10, 0, None),
        ("ep_1", None, 10, 0, None),
    ]


@pytest.mark.asyncio
async def test_storyboard_items_keep_partial_valid_script_rows():
    class StoryboardDAO:
        calls = []

        @staticmethod
        async def get_by_episode(episode_id, script_id=None, limit=None, offset=0, fields=None):
            StoryboardDAO.calls.append((episode_id, script_id, limit, offset, fields))
            if script_id:
                return [
                    {
                        "item_id": "sb_valid_partial",
                        "episode_id": episode_id,
                        "script_id": script_id,
                        "sort_order": 0,
                        "bound_assets": [],
                    }
                ]
            return [
                {
                    "item_id": "sb_other_scope",
                    "episode_id": episode_id,
                    "script_id": "script_other",
                    "sort_order": 0,
                    "bound_assets": [],
                }
            ]

        @staticmethod
        async def count_by_episode(episode_id, script_id=None):
            return 1 if script_id else 23

    class EpisodeScriptDAO:
        @staticmethod
        async def get_by_id(script_id):
            return {"script_id": script_id, "episode_id": "ep_1"}

    app = _build_app(StoryboardDAO, EpisodeScriptDAO)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/api/episodes/ep_1/storyboard-items",
            params={"script_id": "script_valid", "limit": 10, "include_total": "true"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert [item["item_id"] for item in payload["items"]] == ["sb_valid_partial"]
    assert payload["total"] == 1
    assert "fallback_script_id" not in payload
    assert StoryboardDAO.calls == [("ep_1", "script_valid", 10, 0, None)]
