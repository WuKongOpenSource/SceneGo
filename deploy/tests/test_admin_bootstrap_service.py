from __future__ import annotations

from unittest.mock import Mock

import pytest

from services.admin_bootstrap_service import (
    BOOTSTRAP_STATE_KEY,
    apply_configured_admin_bootstrap,
    configured_admin_roles,
    load_builtin_users,
)


class _Logger:
    def info(self, *_args, **_kwargs):
        pass

    def warning(self, *_args, **_kwargs):
        pass


class _UserDAO:
    users: dict[str, dict] = {}
    updates: list[tuple[str, str]] = []

    @classmethod
    async def get_user_by_username(cls, username: str):
        return cls.users.get(username)

    @classmethod
    async def set_role(cls, user_id: str, role: str):
        cls.updates.append((user_id, role))
        for user in cls.users.values():
            if user.get("user_id") == user_id:
                user["role"] = role
        return True


class _SettingsDAO:
    values: dict[str, str] = {}

    @classmethod
    async def get(cls, key: str):
        return cls.values.get(key)

    @classmethod
    async def set(cls, key: str, value: str, _description: str = ""):
        cls.values[key] = value
        return True


@pytest.fixture(autouse=True)
def _reset_fakes():
    _UserDAO.users = {}
    _UserDAO.updates = []
    _SettingsDAO.values = {}


def test_explicit_credential_environment_does_not_read_process_values(monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", "process-password-must-not-leak")
    monkeypatch.setenv("ALLOW_DEV_ADMIN_PASSWORD", "true")
    logger = Mock()
    assert load_builtin_users(logger=logger, environment={}) == {}
    logger.info.assert_called_once()


@pytest.mark.parametrize("environment", [
    {"ADMIN_PASSWORD": "x!7"},
    {"ADMIN_PASSWORD": "private-credential-value", "OSTORY_BUILTIN_ADMIN_USERNAME": "   "},
])
def test_invalid_credential_logs_never_include_password_values(environment):
    logger = Mock()
    assert load_builtin_users(logger=logger, environment=environment) == {}
    logger.error.assert_called_once()
    assert environment["ADMIN_PASSWORD"] not in str(logger.mock_calls)


def test_super_admin_assignment_wins_duplicate_configuration() -> None:
    roles = configured_admin_roles(
        {
            "OSTORY_ADMIN_USERNAMES": "operator, owner",
            "OSTORY_SUPER_ADMIN_USERNAMES": "owner",
        }
    )

    assert roles == {"operator": "admin", "owner": "super_admin"}


@pytest.mark.asyncio
async def test_bootstrap_persists_roles_and_completion_marker() -> None:
    _UserDAO.users = {
        "operator": {"user_id": "u-operator", "username": "operator", "role": "user"},
        "owner": {"user_id": "u-owner", "username": "owner", "role": "admin"},
    }
    environment = {
        "OSTORY_ADMIN_USERNAMES": "operator",
        "OSTORY_SUPER_ADMIN_USERNAMES": "owner",
    }

    result = await apply_configured_admin_bootstrap(
        user_dao=_UserDAO,
        settings_dao=_SettingsDAO,
        logger=_Logger(),
        environment=environment,
    )

    assert result == {"configured": 2, "updated": 2, "missing": 0, "applied": True}
    assert _UserDAO.updates == [("u-operator", "admin"), ("u-owner", "super_admin")]
    assert _SettingsDAO.values[BOOTSTRAP_STATE_KEY]

    # The completion marker prevents the same config from restoring a demoted role.
    _UserDAO.users["owner"]["role"] = "user"
    repeated = await apply_configured_admin_bootstrap(
        user_dao=_UserDAO,
        settings_dao=_SettingsDAO,
        logger=_Logger(),
        environment=environment,
    )
    assert repeated["applied"] is False
    assert _UserDAO.users["owner"]["role"] == "user"
    assert len(_UserDAO.updates) == 2


@pytest.mark.asyncio
async def test_bootstrap_waits_for_every_configured_account() -> None:
    result = await apply_configured_admin_bootstrap(
        user_dao=_UserDAO,
        settings_dao=_SettingsDAO,
        logger=_Logger(),
        environment={"OSTORY_SUPER_ADMIN_USERNAMES": "future-owner"},
    )

    assert result == {"configured": 1, "updated": 0, "missing": 1, "applied": False}
    assert BOOTSTRAP_STATE_KEY not in _SettingsDAO.values

