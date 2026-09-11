import json

import pytest

from dao.content import entity_file as entity_file_module
from dao.content.entity_file import EntityFileDAO
from dao.creative import episode as episode_module
from dao.creative import media_library as media_library_module
from dao.creative.episode import EpisodeDAO
from dao.creative.media_library import MediaLibraryDAO
from dao.organization import resource_share as resource_share_module
from dao.organization.resource_share import ResourceShareDAO


class _FakeDB:
    def __init__(self):
        self.execute_calls = []
        self.fetchrow_calls = []

    async def execute(self, query, *args):
        self.execute_calls.append((query, args))
        return "UPDATE 1" if query.lstrip().startswith("UPDATE") else "DELETE 1"

    async def fetchrow(self, query, *args):
        self.fetchrow_calls.append((query, args))
        return {"library_item_id": args[0]} if args else None


@pytest.mark.asyncio
async def test_storyboard_legacy_url_uses_predeclared_static_query(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(entity_file_module, "get_db_manager", lambda: db)

    result = await EntityFileDAO.sync_legacy_url(
        "storyboard_item",
        "shot_1",
        "generated_image",
        "/storage/image.webp",
    )

    assert result is True
    query, args = db.execute_calls[0]
    assert "SET generated_image_url = $1" in query
    assert args == ("/storage/image.webp", "shot_1")


@pytest.mark.asyncio
async def test_storyboard_legacy_url_rejects_unknown_column_selector(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(entity_file_module, "get_db_manager", lambda: db)

    result = await EntityFileDAO.sync_legacy_url(
        "storyboard_item",
        "shot_1",
        "generated_image_url = 'attacker' --",
        "/storage/image.webp",
    )

    assert result is False
    assert db.execute_calls == []


@pytest.mark.asyncio
async def test_episode_update_keeps_values_out_of_static_sql(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(episode_module, "get_db_manager", lambda: db)

    await EpisodeDAO.update_episode(
        "ep_1",
        episode_name="name'); DROP TABLE episodes; --",
        settings={"fps": 24},
        sort_order=3,
    )

    query, args = db.execute_calls[0]
    assert "DROP TABLE" not in query
    assert "CASE WHEN $1::boolean" in query
    assert args[0:2] == (True, "name'); DROP TABLE episodes; --")
    assert json.loads(args[7]) == {"fps": 24}
    assert args[-1] == "ep_1"


@pytest.mark.asyncio
async def test_media_library_update_uses_json_patch_and_drops_unknown_fields(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(media_library_module, "get_db_manager", lambda: db)

    result = await MediaLibraryDAO.update(
        "mli_1",
        {
            "title": "safe title",
            "tags": None,
            "metadata": None,
            "title = 'attacker' --": "ignored",
        },
    )

    query, args = db.execute_calls[0]
    patch = json.loads(args[0])
    assert "attacker" not in query
    assert patch == {"title": "safe title", "tags": [], "metadata": {}}
    assert args[1] == "mli_1"
    assert result == {"library_item_id": "mli_1"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("target_type", "target_id", "expected_args"),
    [
        (None, None, ("asset", "asset_1")),
        ("org", None, ("asset", "asset_1", "org")),
        (None, "org_1", ("asset", "asset_1", "org_1")),
        ("org", "org_1", ("asset", "asset_1", "org", "org_1")),
    ],
)
async def test_resource_share_delete_uses_static_query_variants(
    monkeypatch,
    target_type,
    target_id,
    expected_args,
):
    db = _FakeDB()
    monkeypatch.setattr(resource_share_module, "get_db_manager", lambda: db)

    deleted = await ResourceShareDAO.delete_for_resource(
        "asset",
        "asset_1",
        share_target_type=target_type,
        share_target_id=target_id,
    )

    query, args = db.execute_calls[0]
    assert "asset_1" not in query
    assert args == expected_args
    assert deleted == 1
