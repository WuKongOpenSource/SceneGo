import pytest

from services import admin_compat_service as svc


class _Logger:
    def __init__(self):
        self.warnings = []
        self.errors = []
        self.infos = []

    def warning(self, *args, **_kwargs):
        self.warnings.append(args)

    def error(self, *args, **_kwargs):
        self.errors.append(args)

    def info(self, *args, **_kwargs):
        self.infos.append(args)


class _AdminStatsDAO:
    summary_calls = []
    breakdown_calls = []
    logs_calls = []
    raise_breakdown = False

    @classmethod
    def reset(cls):
        cls.summary_calls = []
        cls.breakdown_calls = []
        cls.logs_calls = []
        cls.raise_breakdown = False

    @classmethod
    async def get_summary_stats(cls, **kwargs):
        cls.summary_calls.append(kwargs)
        return {"totalProjects": 2, "activeUsers": kwargs["active_users_count"]}

    @classmethod
    async def get_stats_breakdown(cls, **kwargs):
        cls.breakdown_calls.append(kwargs)
        if cls.raise_breakdown:
            raise RuntimeError("breakdown failed")
        return [{"user_id": "yuan", "projects": 2}]

    @classmethod
    async def get_generation_logs(cls, **kwargs):
        cls.logs_calls.append(kwargs)
        return [{"id": "log1"}]


class _UserDAO:
    created_calls = []
    role_calls = []
    delete_result = 1
    raise_delete = False
    existing_by_username = {}
    users_by_id = {"target": {"user_id": "target", "username": "target-user"}}
    listed_users = []

    @classmethod
    def reset(cls):
        cls.created_calls = []
        cls.role_calls = []
        cls.delete_result = 1
        cls.raise_delete = False
        cls.existing_by_username = {}
        cls.users_by_id = {"target": {"user_id": "target", "username": "target-user"}}
        cls.listed_users = []

    @classmethod
    async def create_user(cls, **kwargs):
        cls.created_calls.append(kwargs)
        return {"user_id": "user_generated"}

    @classmethod
    async def get_user_by_username_any(cls, username):
        return cls.existing_by_username.get(username)

    @classmethod
    async def set_role(cls, user_id, role):
        cls.role_calls.append((user_id, role))
        return True

    @classmethod
    async def get_user_by_id(cls, user_id):
        return cls.users_by_id.get(user_id)

    @classmethod
    async def delete_user_by_id(cls, _user_id):
        if cls.raise_delete:
            raise RuntimeError("delete failed")
        return cls.delete_result

    @classmethod
    async def admin_list_users(cls, **_kwargs):
        return cls.listed_users

    @classmethod
    async def admin_count_users(cls, **_kwargs):
        return len(cls.listed_users)


@pytest.fixture(autouse=True)
def _reset_fakes():
    _AdminStatsDAO.reset()
    _UserDAO.reset()


@pytest.mark.asyncio
async def test_get_admin_stats_validates_group_by():
    with pytest.raises(svc.InvalidGroupBy):
        await svc.get_admin_stats_response(
            "admin",
            group_by="bad",
            super_admin="yuan",
            active_users_count=1,
            admin_stats_dao=_AdminStatsDAO,
            logger=_Logger(),
        )


@pytest.mark.asyncio
async def test_get_admin_stats_delegates_summary_and_breakdown():
    result = await svc.get_admin_stats_response(
        "admin",
        group_by="user",
        super_admin="yuan",
        active_users_count=3,
        admin_stats_dao=_AdminStatsDAO,
        logger=_Logger(),
    )

    assert result["success"] is True
    assert result["stats"]["activeUsers"] == 3
    assert result["breakdown"] == [{"user_id": "yuan", "projects": 2}]
    assert _AdminStatsDAO.summary_calls[0]["requesting_username"] == "admin"
    assert _AdminStatsDAO.breakdown_calls[0]["group_by"] == "user"


@pytest.mark.asyncio
async def test_get_admin_stats_downgrades_breakdown_errors():
    _AdminStatsDAO.raise_breakdown = True
    logger = _Logger()

    result = await svc.get_admin_stats_response(
        "admin",
        group_by="org",
        super_admin="yuan",
        active_users_count=3,
        admin_stats_dao=_AdminStatsDAO,
        logger=logger,
    )

    assert result["breakdown"] == []
    assert logger.warnings


@pytest.mark.asyncio
async def test_get_admin_logs_delegates_to_dao():
    result = await svc.get_admin_logs_response(
        "yuan",
        limit=20,
        super_admin="yuan",
        admin_stats_dao=_AdminStatsDAO,
    )

    assert result == {"success": True, "logs": [{"id": "log1"}]}
    assert _AdminStatsDAO.logs_calls[0]["limit"] == 20


@pytest.mark.asyncio
async def test_list_admin_users_normalizes_public_frontend_shape_and_bounds_paging():
    _UserDAO.listed_users = [{
        "user_id": "user-1",
        "username": "yuan",
        "role": "user",
        "status": "disabled",
        "permissions": {"allowedModels": ["gemini-image"]},
    }]

    result = await svc.list_admin_users_response(
        user_dao=_UserDAO,
        limit=10000,
        offset=-50,
    )

    assert result["limit"] == 500
    assert result["offset"] == 0
    assert result["total"] == 1
    assert result["users"][0]["id"] == "user-1"
    assert result["users"][0]["isActive"] is False
    assert result["users"][0]["permissions"]["allowedModels"] == ["gemini-image"]


@pytest.mark.asyncio
async def test_create_admin_user_persists_generated_id_role_and_audit_without_legacy_password_copy():
    default_users = {}
    audit_calls = []

    async def audit_record(*args, **kwargs):
        audit_calls.append((args, kwargs))

    result = await svc.create_admin_user_response(
        {"username": "new-user", "password": "12345678", "email": "n@example.com", "role": "admin"},
        request=object(),
        admin_username="admin",
        super_admin="yuan",
        default_users=default_users,
        user_dao=_UserDAO,
        audit_record=audit_record,
        logger=_Logger(),
    )

    assert result["success"] is True
    assert default_users == {}
    assert "user_id" not in _UserDAO.created_calls[0]
    assert result["user"]["user_id"] == "user_generated"
    assert _UserDAO.role_calls == [("user_generated", "admin")]
    assert audit_calls[0][1]["target_id"] == "user_generated"
    assert audit_calls[0][1]["action"] == "user_create"


@pytest.mark.asyncio
async def test_create_admin_user_validates_credentials_and_duplicates():
    with pytest.raises(svc.MissingUserCredentials):
        await svc.create_admin_user_response(
            {"username": "new-user"},
            request=None,
            admin_username="admin",
            super_admin="yuan",
            default_users={},
            user_dao=_UserDAO,
            audit_record=None,
            logger=_Logger(),
        )

    with pytest.raises(svc.WeakPassword):
        await svc.create_admin_user_response(
            {"username": "new-user", "password": "short"},
            request=None,
            admin_username="admin",
            super_admin="yuan",
            default_users={},
            user_dao=_UserDAO,
            audit_record=None,
            logger=_Logger(),
        )

    with pytest.raises(svc.UsernameExists):
        await svc.create_admin_user_response(
            {"username": "new-user", "password": "12345678"},
            request=None,
            admin_username="admin",
            super_admin="yuan",
            default_users={"new-user": "old"},
            user_dao=_UserDAO,
            audit_record=None,
            logger=_Logger(),
        )


@pytest.mark.asyncio
async def test_delete_admin_user_guards_and_delegates():
    with pytest.raises(svc.SelfDeleteForbidden):
        await svc.delete_admin_user_response(
            "admin",
            admin_username="admin",
            super_admin="yuan",
            user_dao=_UserDAO,
            logger=_Logger(),
        )

    with pytest.raises(svc.SystemUserDeleteForbidden):
        await svc.delete_admin_user_response(
            "yuan",
            admin_username="admin",
            super_admin="yuan",
            user_dao=_UserDAO,
            logger=_Logger(),
        )

    result = await svc.delete_admin_user_response(
        "target",
        admin_username="admin",
        super_admin="yuan",
        user_dao=_UserDAO,
        logger=_Logger(),
    )
    assert result == {"success": True, "message": "用户 target 已从数据库删除"}


@pytest.mark.asyncio
async def test_delete_admin_user_handles_db_unavailable_and_errors():
    _UserDAO.delete_result = None
    with pytest.raises(svc.UserDeleteFailed, match="数据库不可用，用户未删除"):
        await svc.delete_admin_user_response(
            "target",
            admin_username="admin",
            super_admin="yuan",
            user_dao=_UserDAO,
            logger=_Logger(),
        )

    _UserDAO.existing_by_username["disabled-user"] = {
        "user_id": "disabled-id",
        "username": "disabled-user",
        "is_active": False,
    }
    with pytest.raises(svc.UsernameExists):
        await svc.create_admin_user_response(
            {"username": "disabled-user", "password": "12345678"},
            request=None,
            admin_username="admin",
            super_admin="yuan",
            default_users={},
            user_dao=_UserDAO,
            audit_record=None,
            logger=_Logger(),
        )

    with pytest.raises(svc.InvalidUserFields):
        await svc.create_admin_user_response(
            {"username": "bad/name", "password": "12345678"},
            request=None,
            admin_username="admin",
            super_admin="yuan",
            default_users={},
            user_dao=_UserDAO,
            audit_record=None,
            logger=_Logger(),
        )

    _UserDAO.users_by_id["admin-id"] = {"user_id": "admin-id", "username": "admin"}
    with pytest.raises(svc.SelfDeleteForbidden):
        await svc.delete_admin_user_response(
            "admin-id",
            admin_username="admin",
            super_admin="yuan",
            user_dao=_UserDAO,
            logger=_Logger(),
        )

    _UserDAO.raise_delete = True
    with pytest.raises(svc.UserDeleteFailed):
        await svc.delete_admin_user_response(
            "target",
            admin_username="admin",
            super_admin="yuan",
            user_dao=_UserDAO,
            logger=_Logger(),
        )


@pytest.mark.asyncio
async def test_delete_admin_user_rejects_missing_target_and_noop_delete():
    with pytest.raises(svc.UserDeleteFailed, match="用户不存在或数据库不可用"):
        await svc.delete_admin_user_response(
            "missing",
            admin_username="admin",
            super_admin="yuan",
            user_dao=_UserDAO,
            logger=_Logger(),
        )

    _UserDAO.delete_result = "DELETE 0"
    with pytest.raises(svc.UserDeleteFailed, match="用户未删除"):
        await svc.delete_admin_user_response(
            "target",
            admin_username="admin",
            super_admin="yuan",
            user_dao=_UserDAO,
            logger=_Logger(),
        )
