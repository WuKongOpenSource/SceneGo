from contextlib import asynccontextmanager
import json

import pytest

from dao.creative import storyboard


class FakeConnection:
    def __init__(self):
        self.queries = []
        self.existing = [
            {
                "item_id": "sb_keep",
                "episode_id": "ep_1",
                "script_id": "script_1",
                "sort_order": 0,
                "generated_image_url": "/old.webp",
                "configured_references": '[{"referenceId":"ref-1"}]',
                "reference_config_initialized": True,
            },
            {
                "item_id": "sb_remove",
                "episode_id": "ep_1",
                "script_id": "script_1",
                "sort_order": 1,
            },
        ]

    @asynccontextmanager
    async def transaction(self):
        yield

    async def fetch(self, query, *args):
        self.queries.append((query, args))
        if "FOR UPDATE" in query:
            return self.existing
        return [
            {
                "item_id": "sb_keep",
                "episode_id": "ep_1",
                "script_id": "script_1",
                "sort_order": 0,
                "generated_image_url": "/old.webp",
            }
        ]

    async def fetchrow(self, query, *args):
        self.queries.append((query, args))
        assert args[0] == "sb_keep"
        assert json.loads(args[10]) == [{"referenceId": "ref-1"}]
        assert args[11] is True
        assert args[19] == "/old.webp"
        return {
            "item_id": "sb_keep",
            "episode_id": "ep_1",
            "script_id": "script_1",
            "sort_order": 0,
            "generated_image_url": "/old.webp",
            "configured_references": [{"referenceId": "ref-1"}],
        }

    async def execute(self, query, *args):
        self.queries.append((query, args))
        return "DELETE 1"


class FakeDB:
    def __init__(self, conn):
        self.conn = conn

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


@pytest.mark.asyncio
async def test_replace_batch_updates_matching_item_and_removes_only_unmatched(monkeypatch):
    conn = FakeConnection()
    monkeypatch.setattr(storyboard, "get_db_manager", lambda: FakeDB(conn))

    rows = await storyboard.StoryboardDAO.replace_batch(
        "ep_1",
        [{"sort_order": 0, "scene_heading": "New scene"}],
        script_id="script_1",
    )

    assert [row["item_id"] for row in rows] == ["sb_keep"]
    update_query = next(query for query, _args in conn.queries if "UPDATE storyboard_items" in query)
    assert "WHERE item_id = $1 AND episode_id = $2" in update_query
    delete_query, delete_args = next(
        (query, args)
        for query, args in conn.queries
        if "DELETE FROM storyboard_items" in query
    )
    assert "script_id = $2" in delete_query
    assert delete_args[2] == ["sb_keep"]
