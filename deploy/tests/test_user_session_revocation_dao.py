from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from dao.user import user as user_module


class RecordingDB:
    def __init__(self):
        self.calls = []

    async def execute(self, query, *args):
        self.calls.append((query, args))
        return "UPDATE 1"

    async def fetchrow(self, query, *args):
        self.calls.append((query, args))
        if "SELECT permissions" in query:
            return {"permissions": {}}
        return None


@pytest.mark.asyncio
async def test_security_sensitive_account_updates_revoke_existing_sessions(monkeypatch):
    db = RecordingDB()
    monkeypatch.setattr(user_module, "get_db_manager", lambda: db)

    assert await user_module.UserDAO.set_status("user-1", "disabled", disabled_reason="review")
    assert await user_module.UserDAO.set_role("user-1", "user")
    assert await user_module.UserDAO.update_user_permissions("user-1", {"canExport": False})
    assert await user_module.UserDAO.reset_password("user-1", "new-password")

    mutation_sql = [query for query, _args in db.calls if "UPDATE users" in query]
    assert len(mutation_sql) == 4
    assert all("session_version = session_version + 1" in query for query in mutation_sql)


@pytest.mark.asyncio
async def test_reenabling_keeps_the_version_created_by_disable(monkeypatch):
    db = RecordingDB()
    monkeypatch.setattr(user_module, "get_db_manager", lambda: db)

    assert await user_module.UserDAO.set_status("user-1", "active")

    query = db.calls[0][0]
    assert "session_version = session_version + 1" not in query


@pytest.mark.asyncio
async def test_fixed_admin_name_never_grants_role_by_itself(monkeypatch):
    lookup = AsyncMock(
        return_value={
            "user_id": "admin",
            "username": "admin",
            "role": "user",
            "status": "active",
            "is_active": True,
            "session_version": 1,
        }
    )
    monkeypatch.setattr(user_module.UserDAO, "get_session_identity", lookup)

    assert await user_module.UserDAO.is_admin_user("admin") is False
    lookup.assert_awaited_once_with("admin")


@pytest.mark.asyncio
async def test_persisted_active_admin_role_is_accepted(monkeypatch):
    monkeypatch.setattr(
        user_module.UserDAO,
        "get_session_identity",
        AsyncMock(
            return_value={
                "user_id": "owner-1",
                "username": "owner",
                "role": "super_admin",
                "status": "active",
                "is_active": True,
                "session_version": 1,
            }
        ),
    )

    assert await user_module.UserDAO.is_admin_user("owner-1") is True
