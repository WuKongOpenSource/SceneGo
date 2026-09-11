from __future__ import annotations

from dao.creative import episode as episode_module
from dao.creative.episode import EpisodeDAO


class FakeDB:
    def __init__(self) -> None:
        self.query = ""
        self.args = ()

    async def fetchrow(self, query: str, *args):
        self.query = query
        self.args = args
        return {"episode_id": args[0], "settings": {"workflow_script_id": args[1]}}


async def test_set_workflow_script_casts_json_value_to_text(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(episode_module, "get_db_manager", lambda: db)

    result = await EpisodeDAO.set_workflow_script("ep_1", "script_2")

    assert "$2::text" in db.query
    assert db.args == ("ep_1", "script_2")
    assert result["settings"]["workflow_script_id"] == "script_2"
