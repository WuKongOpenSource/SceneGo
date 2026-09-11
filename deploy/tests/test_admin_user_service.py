import pytest

from services import admin_user_service as svc


class _UserDAO:
    users = {}

    @classmethod
    def reset(cls):
        cls.users = {
            "user_1": {"user_id": "user_1", "username": "old_name", "role": "user"},
            "user_2": {"user_id": "user_2", "username": "taken_name", "role": "user"},
            "admin": {"user_id": "admin", "username": "admin", "role": "super_admin"},
        }

    @classmethod
    async def admin_get_user_detail(cls, user_id):
        row = cls.users.get(user_id)
        return dict(row) if row else None

    @classmethod
    async def get_user_by_username_any(cls, username):
        return next((dict(row) for row in cls.users.values() if row["username"] == username), None)

    @classmethod
    async def update_self_profile(cls, user_id, **fields):
        cls.users[user_id].update(fields)
        return True


@pytest.fixture(autouse=True)
def _reset_user_dao():
    _UserDAO.reset()


@pytest.mark.asyncio
async def test_rename_user_changes_only_username_and_keeps_stable_user_id():
    result = await svc.rename_user("user_1", "new_name", user_dao=_UserDAO)

    assert result["changed"] is True
    assert result["before"]["username"] == "old_name"
    assert result["user"]["username"] == "new_name"
    assert result["user"]["user_id"] == "user_1"


@pytest.mark.asyncio
async def test_rename_user_rejects_invalid_or_duplicate_username():
    with pytest.raises(svc.AdminUsernameInvalid):
        await svc.rename_user("user_1", "bad name", user_dao=_UserDAO)

    with pytest.raises(svc.AdminUsernameExists):
        await svc.rename_user("user_1", "taken_name", user_dao=_UserDAO)


@pytest.mark.asyncio
async def test_rename_user_protects_bootstrap_admin_identity():
    with pytest.raises(svc.ProtectedSystemUsername):
        await svc.rename_user("admin", "renamed_admin", user_dao=_UserDAO)


@pytest.mark.asyncio
async def test_rename_user_treats_same_name_as_noop():
    result = await svc.rename_user("user_1", " old_name ", user_dao=_UserDAO)

    assert result["changed"] is False
    assert result["user"]["username"] == "old_name"
