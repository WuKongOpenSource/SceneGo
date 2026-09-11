import pytest

from dao.business import task as task_module


class FakeDatabase:
    def __init__(self) -> None:
        self.calls = []

    async def fetch(self, query, *args):
        self.calls.append(("fetch", query, args))
        return []

    async def execute(self, query, *args):
        self.calls.append(("execute", query, args))
        return "DELETE 0"


@pytest.mark.asyncio
async def test_recent_completed_interval_and_limit_are_bound_parameters(monkeypatch) -> None:
    database = FakeDatabase()
    monkeypatch.setattr(task_module, "get_db_manager", lambda: database)

    await task_module.TaskDAO.get_recent_completed_tasks("user-1", hours=48, limit=25)

    _, query, args = database.calls[0]
    assert "make_interval(hours => $2)" in query
    assert "LIMIT $3" in query
    assert args == ("user-1", 48, 25)
    assert "48" not in query


@pytest.mark.asyncio
async def test_cleanup_interval_is_a_bound_parameter(monkeypatch) -> None:
    database = FakeDatabase()
    monkeypatch.setattr(task_module, "get_db_manager", lambda: database)

    await task_module.TaskDAO.cleanup_old_tasks(days=45)

    _, query, args = database.calls[0]
    assert "make_interval(days => $1)" in query
    assert args == (45,)
    assert "45" not in query
