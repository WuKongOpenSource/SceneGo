import pytest

from services import auth_user_service as svc


class _Logger:
    def __init__(self):
        self.errors = []

    def info(self, *_args, **_kwargs):
        pass

    def warning(self, *_args, **_kwargs):
        pass

    def error(self, *args, **_kwargs):
        self.errors.append(args)


class _UserDAO:
    verified_user = None
    username_user = None
    id_user = None
    created_user = {"user_id": "created"}
    raise_on_verify = False
    raise_on_username = False
    updated_permissions = []
    created_calls = []

    @classmethod
    def reset(cls):
        cls.verified_user = None
        cls.username_user = None
        cls.id_user = None
        cls.created_user = {"user_id": "created"}
        cls.raise_on_verify = False
        cls.raise_on_username = False
        cls.updated_permissions = []
        cls.created_calls = []

    @classmethod
    async def verify_password(cls, _username, _password):
        if cls.raise_on_verify:
            raise RuntimeError("db down")
        return cls.verified_user

    @classmethod
    async def get_user_by_username(cls, _username):
        if cls.raise_on_username:
            raise RuntimeError("db down")
        return cls.username_user

    @classmethod
    async def get_user_by_id(cls, _user_id):
        return cls.id_user

    @classmethod
    async def create_user(cls, **kwargs):
        cls.created_calls.append(kwargs)
        return cls.created_user

    @classmethod
    async def update_user_permissions(cls, user_id, permissions):
        cls.updated_permissions.append((user_id, permissions))
        return True


@pytest.fixture(autouse=True)
def _patch_user_dao(monkeypatch):
    _UserDAO.reset()
    monkeypatch.setattr(svc, "UserDAO", _UserDAO)


def test_default_permissions_inherit_the_platform_model_catalog():
    permissions = svc.default_permissions()

    assert permissions["accessMode"] == "inherit"
    assert permissions["allowedModels"] == []


@pytest.mark.asyncio
async def test_verify_database_credentials_returns_user():
    _UserDAO.verified_user = {"user_id": "u1", "username": "yuan"}

    result = await svc.verify_database_credentials("yuan", "secret", logger=_Logger())

    assert result == {"user_id": "u1", "username": "yuan"}


@pytest.mark.asyncio
async def test_verify_database_credentials_swallows_dao_errors():
    _UserDAO.raise_on_verify = True
    logger = _Logger()

    result = await svc.verify_database_credentials("yuan", "secret", logger=logger)

    assert result is None
    assert logger.errors


@pytest.mark.asyncio
async def test_ensure_login_user_record_creates_missing_user_with_permissions():
    _UserDAO.created_user = {"user_id": "user_generated"}

    result = await svc.ensure_login_user_record("yuan", "secret", logger=_Logger())

    assert result is True
    assert _UserDAO.created_calls[0]["username"] == "yuan"
    assert "user_id" not in _UserDAO.created_calls[0]
    assert _UserDAO.updated_permissions[0][0] == "user_generated"
    assert _UserDAO.updated_permissions[0][1]["accessMode"] == "inherit"
    assert _UserDAO.updated_permissions[0][1]["canExport"] is True


@pytest.mark.asyncio
async def test_ensure_login_user_record_updates_existing_user_id_permissions():
    _UserDAO.username_user = {"user_id": "user_123", "permissions": None}

    result = await svc.ensure_login_user_record("yuan", "secret", logger=_Logger())

    assert result is True
    assert _UserDAO.created_calls == []
    assert _UserDAO.updated_permissions[0][0] == "user_123"


@pytest.mark.asyncio
async def test_ensure_login_user_record_keeps_existing_permissions():
    _UserDAO.username_user = {"user_id": "user_123", "permissions": {"allowedModels": ["custom"]}}

    result = await svc.ensure_login_user_record("yuan", "secret", logger=_Logger())

    assert result is True
    assert _UserDAO.updated_permissions == []
