from dao.user import user as user_module
from dao.user.user import UserDAO


class _FakeDB:
    def __init__(self):
        self.calls = []
        self.fetchrow_results = []

    async def execute(self, query, *args):
        self.calls.append((query, args))
        return "DELETE 1"

    async def fetchrow(self, query, *args):
        self.calls.append((query, args))
        if self.fetchrow_results:
            result = self.fetchrow_results.pop(0)
            if isinstance(result, BaseException):
                raise result
            return result
        return None


async def test_delete_user_by_id_returns_none_when_db_unavailable(monkeypatch):
    monkeypatch.setattr(user_module, "get_db_manager", lambda: None)

    result = await UserDAO.delete_user_by_id("user_missing_db")

    assert result is None


async def test_auth_user_dao_methods_return_empty_values_when_db_unavailable(monkeypatch):
    monkeypatch.setattr(user_module, "get_db_manager", lambda: None)

    assert await UserDAO.get_user_by_id("user_missing_db") is None
    assert await UserDAO.get_user_by_username("yuan") is None
    assert await UserDAO.get_user_by_username_any("yuan") is None
    assert await UserDAO.create_user(username="yuan", password="secret") is None
    assert await UserDAO.update_last_login("user_missing_db") is False
    assert await UserDAO.update_user_permissions("user_missing_db", {"allowedModels": []}) is False
    assert await UserDAO.admin_get_user_detail("user_missing_db") is None


async def test_delete_user_by_id_uses_user_id_parameter(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(user_module, "get_db_manager", lambda: db)

    result = await UserDAO.delete_user_by_id("user_123")

    assert result == "DELETE 1"
    assert len(db.calls) == 1
    query, args = db.calls[0]
    assert "DELETE FROM users WHERE user_id = $1" in query
    assert args == ("user_123",)


async def test_get_user_by_username_any_includes_disabled_accounts(monkeypatch):
    db = _FakeDB()
    db.fetchrow_results = [{
        "user_id": "user_disabled",
        "username": "reserved_name",
        "status": "disabled",
        "is_active": True,
    }]
    monkeypatch.setattr(user_module, "get_db_manager", lambda: db)

    result = await UserDAO.get_user_by_username_any("reserved_name")

    assert result["user_id"] == "user_disabled"
    query, args = db.calls[0]
    assert "WHERE username = $1" in query
    assert "is_active = TRUE" not in query
    assert args == ("reserved_name",)


async def test_admin_get_user_detail_prefers_full_admin_fields(monkeypatch):
    db = _FakeDB()
    db.fetchrow_results = [
        {"user_id": "user_123", "username": "yuan", "email": "base@example.test", "is_active": True},
        {
            "user_id": "user_123",
            "username": "yuan",
            "email": "full@example.test",
            "role": "admin",
            "status": "active",
            "permissions": {"allowedModels": ["deepseek"]},
            "is_active": True,
        },
    ]
    monkeypatch.setattr(user_module, "get_db_manager", lambda: db)

    result = await UserDAO.admin_get_user_detail("user_123")

    assert result["email"] == "full@example.test"
    assert result["role"] == "admin"
    assert result["permissions"] == {"allowedModels": ["deepseek"]}
    assert len(db.calls) == 2
    assert "WHERE user_id = $1 AND is_active = TRUE" in db.calls[0][0]
    assert "disabled_reason" in db.calls[1][0]
    assert db.calls[1][1] == ("user_123",)


async def test_admin_get_user_detail_falls_back_to_base_user_when_full_query_fails(monkeypatch):
    db = _FakeDB()
    base_user = {
        "user_id": "user_123",
        "username": "yuan",
        "email": "base@example.test",
        "is_active": True,
    }
    db.fetchrow_results = [base_user, RuntimeError("missing admin columns")]
    monkeypatch.setattr(user_module, "get_db_manager", lambda: db)

    result = await UserDAO.admin_get_user_detail("user_123")

    assert result == base_user
