from __future__ import annotations

from dao.business import notification as notification_module


class FakeDB:
    def __init__(self):
        self.fetch_call = None
        self.execute_call = None

    async def fetch(self, query, *args):
        self.fetch_call = (query, args)
        return []

    async def execute(self, query, *args):
        self.execute_call = (query, args)
        return "UPDATE 2"


async def test_history_excludes_dismissed_notifications(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(notification_module, "get_db_manager", lambda: db)

    await notification_module.NotificationDAO.get_history("user_1", limit=50, offset=0)

    query, args = db.fetch_call
    assert "status <> 'dismissed'" in query
    assert args == ("user_1", 50, 0)


async def test_dismiss_accepts_notification_or_task_identifier(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(notification_module, "get_db_manager", lambda: db)

    dismissed = await notification_module.NotificationDAO.dismiss("task_123", "user_1")

    query, args = db.execute_call
    assert "notification_id=$1 OR task_id=$1" in query
    assert args == ("task_123", "user_1")
    assert dismissed is True
