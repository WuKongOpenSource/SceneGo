import pytest

from dao.business import task as task_module


class _FakeDb:
    def __init__(self):
        self.args = None

    async def fetch(self, query, *args):
        self.args = args
        self.query = query
        return [{"task_id": f"task-{index}"} for index in range(4)]


@pytest.mark.asyncio
async def test_cleanup_stale_defaults_to_twenty_four_hours(monkeypatch):
    db = _FakeDb()
    monkeypatch.setattr(task_module, "get_db_manager", lambda: db)

    cleaned = await task_module.TaskDAO.cleanup_stale()

    assert cleaned == 4
    assert db.args == (24, 50)
    assert "RETURNING task_id" in db.query


@pytest.mark.asyncio
async def test_cleanup_stale_ids_are_bounded(monkeypatch):
    db = _FakeDb()
    monkeypatch.setattr(task_module, "get_db_manager", lambda: db)

    task_ids = await task_module.TaskDAO.cleanup_stale_ids(hours=3, limit=9999)

    assert task_ids == ["task-0", "task-1", "task-2", "task-3"]
    assert db.args == (3, 500)
