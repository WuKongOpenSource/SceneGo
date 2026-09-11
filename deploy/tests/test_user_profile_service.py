import hashlib
from datetime import datetime

import pytest

from services import user_profile_service as svc


class _UserDAO:
    users = {}
    by_username = {}
    updates = []
    reset_calls = []

    @classmethod
    def reset(cls):
        cls.users = {
            "user_1": {
                "id": 1,
                "user_id": "user_1",
                "username": "yuan",
                "email": "yuan@example.test",
                "phone_number": None,
                "phone_verified": False,
                "phone_verified_at": None,
                "created_at": datetime(2026, 7, 26, 9, 0),
            },
            "user_2": {
                "id": 2,
                "user_id": "user_2",
                "username": "other",
                "email": "other@example.test",
                "phone_number": None,
                "phone_verified": False,
                "phone_verified_at": None,
                "created_at": datetime(2026, 7, 26, 10, 0),
            },
        }
        cls.by_username = {row["username"]: row for row in cls.users.values()}
        cls.updates = []
        cls.reset_calls = []

    @classmethod
    async def get_user_by_username(cls, username):
        return cls.by_username.get(username)

    @classmethod
    async def get_user_by_id(cls, user_id):
        return cls.users.get(user_id)

    @classmethod
    async def get_user_profile_by_id(cls, user_id):
        row = cls.users.get(user_id)
        return dict(row) if row else None

    @classmethod
    async def update_self_profile(cls, user_id, **fields):
        cls.updates.append({"user_id": user_id, **fields})
        cls.users[user_id].update(fields)
        if "username" in fields:
            cls.by_username = {row["username"]: row for row in cls.users.values()}
        return True

    @classmethod
    async def get_user_with_password_by_id(cls, user_id):
        row = cls.users.get(user_id)
        if not row:
            return None
        return {
            "user_id": user_id,
            "username": row["username"],
            "password_hash": hashlib.sha256("test-placeholder-current".encode()).hexdigest(),
        }

    @classmethod
    async def reset_password(cls, user_id, new_password):
        cls.reset_calls.append({"user_id": user_id, "new_password": new_password})
        return True


class _ProjectDAO:
    @staticmethod
    async def get_user_projects(_user_id, include_archived=True):
        return []


class _ProjectMemberDAO:
    @staticmethod
    async def get_user_accessible_projects(user_id, include_archived=True):
        return [
            {
                "project_id": "p1",
                "project_name": "最近项目",
                "user_id": user_id,
                "is_archived": False,
                "episode_count": 2,
                "updated_at": datetime(2026, 7, 26, 12, 0),
            },
            {
                "project_id": "p2",
                "project_name": "归档项目",
                "user_id": "user_2",
                "is_archived": True,
                "episode_count": 1,
                "updated_at": datetime(2026, 7, 25, 12, 0),
            },
        ]


class _CreditDAO:
    @staticmethod
    async def get_or_create(_owner_type, owner_id):
        return {
            "account_id": f"credit_{owner_id}",
            "available_credits": 120,
            "frozen_credits": 3,
            "total_used_credits": 40,
        }


@pytest.fixture(autouse=True)
def _reset_user_dao():
    _UserDAO.reset()


@pytest.mark.asyncio
async def test_resolve_authenticated_user_id_accepts_username_or_stable_id():
    assert await svc.resolve_authenticated_user_id("yuan", user_dao=_UserDAO) == "user_1"
    assert await svc.resolve_authenticated_user_id("user_1", user_dao=_UserDAO) == "user_1"
    assert await svc.resolve_authenticated_user_id("ghost", user_dao=_UserDAO) == "ghost"


@pytest.mark.asyncio
async def test_get_profile_summary_uses_canonical_user_scope():
    result = await svc.get_profile_summary(
        "user_1",
        user_dao=_UserDAO,
        project_dao=_ProjectDAO,
        project_member_dao=_ProjectMemberDAO,
        credit_account_dao=_CreditDAO,
    )

    assert result["profile"]["user_id"] == "user_1"
    assert result["credits"]["available_credits"] == 120
    assert result["project_stats"] == {"total": 2, "active": 1, "archived": 1, "owned": 1, "shared": 1}
    assert result["recent_projects"][0]["project_id"] == "p1"


@pytest.mark.asyncio
async def test_update_profile_validates_unique_username_and_keeps_phone_identity_immutable():
    with pytest.raises(svc.UsernameAlreadyExists):
        await svc.update_profile(
            "user_1",
            username="other",
            phone_number=None,
            verification_code=None,
            user_dao=_UserDAO,
        )

    with pytest.raises(svc.PhoneIdentityImmutable):
        await svc.update_profile(
            "user_1",
            username=None,
            phone_number="13800138000",
            verification_code="888888",
            user_dao=_UserDAO,
        )

    result = await svc.update_profile(
        "user_1",
        username="new_name",
        phone_number=None,
        verification_code=None,
        user_dao=_UserDAO,
    )

    assert result["success"] is True
    assert result["username_changed"] is True
    assert result["profile"]["username"] == "new_name"
    assert result["profile"]["phone_verified"] is False
    assert _UserDAO.updates[-1]["user_id"] == "user_1"


@pytest.mark.asyncio
async def test_change_password_checks_current_hash_before_resetting():
    with pytest.raises(svc.InvalidPassword):
        await svc.change_password(
            "user_1",
            current_password="wrong",
            new_password="test-placeholder-replacement",
            user_dao=_UserDAO,
        )

    result = await svc.change_password(
        "user_1",
        current_password="test-placeholder-current",
        new_password="test-placeholder-replacement",
        user_dao=_UserDAO,
    )

    assert result == {"success": True}
    assert _UserDAO.reset_calls == [{"user_id": "user_1", "new_password": "test-placeholder-replacement"}]
