from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException
from services.admin_compat_service import normalize_admin_user_record

from routers.admin_compat import create_admin_compat_router


async def _admin():
    return "admin"


async def _super_admin():
    return "owner"


def _router(include_user_management: bool):
    user_dao = Mock()
    user_dao.get_user_by_id = AsyncMock(return_value={
        "user_id": "user-1",
        "username": "ordinary-user",
        "role": "user",
    })
    user_dao.get_user_by_username = AsyncMock(return_value={
        "user_id": "admin-1",
        "username": "admin",
        "role": "super_admin",
    })
    user_dao.set_status = AsyncMock(return_value=True)
    user_dao.set_role = AsyncMock(return_value=True)
    user_dao.reset_password = AsyncMock(return_value=True)
    user_dao.update_user_permissions = AsyncMock(return_value=True)
    return create_admin_compat_router(
        require_auth=_admin,
        require_super_admin=_super_admin,
        online_users={},
        default_users={},
        admin_stats_dao=Mock(),
        user_dao=user_dao,
        audit_record=None,
        logger=Mock(),
        include_user_management=include_user_management,
    )


def _operations(router):
    return {
        (method, route.path)
        for route in router.routes
        for method in getattr(route, "methods", set())
    }


def test_public_admin_user_management_exposes_only_when_explicitly_enabled():
    enabled = _operations(_router(True))
    disabled = _operations(_router(False))

    required = {
        ("GET", "/api/admin/session"),
        ("GET", "/api/admin/users"),
        ("POST", "/api/admin/users"),
        ("GET", "/api/admin/users/{user_id}"),
        ("PUT", "/api/admin/users/{user_id}"),
        ("PUT", "/api/admin/users/{user_id}/username"),
        ("POST", "/api/admin/users/{user_id}/disable"),
        ("POST", "/api/admin/users/{user_id}/enable"),
        ("POST", "/api/admin/users/{user_id}/reset-password"),
        ("PUT", "/api/admin/users/{user_id}/permissions"),
    }
    assert required.issubset(enabled)
    assert not required.issubset(disabled)


async def test_public_admin_session_returns_role_backed_identity():
    router = _router(True)
    endpoint = next(
        route.endpoint
        for route in router.routes
        if route.path == "/api/admin/session"
    )

    result = await endpoint(username="admin")

    assert result == {
        "success": True,
        "user_id": "admin-1",
        "username": "admin",
        "role": "super_admin",
    }


def test_public_admin_user_mutations_require_super_admin_dependency():
    router = _router(True)
    mutation_paths = {
        "/api/admin/users",
        "/api/admin/users/{user_id}",
        "/api/admin/users/{user_id}/username",
        "/api/admin/users/{user_id}/disable",
        "/api/admin/users/{user_id}/enable",
        "/api/admin/users/{user_id}/reset-password",
        "/api/admin/users/{user_id}/permissions",
    }
    for route in router.routes:
        if route.path not in mutation_paths or route.methods == {"GET"}:
            continue
        dependency_calls = {
            getattr(dependency.call, "__name__", "")
            for dependency in route.dependant.dependencies
        }
        assert "_super_admin" in dependency_calls, (route.path, dependency_calls)


@pytest.mark.parametrize("value", [
    datetime(2026, 8, 31, 9, 30, tzinfo=timezone.utc),
    datetime(2026, 8, 31, 9, 30),
    "2026-08-31T17:30:00+08:00",
    "2026-08-31T09:30:00Z",
])
def test_admin_user_normalization_preserves_phone_and_utc_recent_login(value):
    user = normalize_admin_user_record({"phone_number": "13800138000", "last_login_at": value})
    assert user["phone_number"] == "13800138000"
    assert user["last_login_at"] == "2026-08-31T09:30:00Z"
    assert user["lastLogin"] == int(datetime(2026, 8, 31, 9, 30, tzinfo=timezone.utc).timestamp() * 1000)


@pytest.mark.parametrize("value", [None, "", "invalid"])
def test_invalid_or_missing_login_time_does_not_break_the_account_list(value):
    assert normalize_admin_user_record({"last_login_at": value})["lastLogin"] == 0


@pytest.mark.parametrize("canonical", [True, False])
@pytest.mark.parametrize("persisted", [True, False])
async def test_admin_create_checks_disabled_names_and_requires_persisted_stable_id(canonical, persisted):
    created = {"user_id": "user_generated", "username": "new_user"} if persisted else None
    dao = SimpleNamespace(get_user_by_username_any=AsyncMock(return_value=None),
                          create_user=AsyncMock(return_value=created))
    audit = AsyncMock()
    router = create_admin_compat_router(
        require_auth=_admin, require_super_admin=_super_admin, online_users={}, default_users={},
        admin_stats_dao=SimpleNamespace(), user_dao=dao, audit_record=audit, logger=Mock(),
        include_user_management=True,
    )
    path = "/api/admin/users" if canonical else "/api/admin/users/create"
    endpoint = next(r.endpoint for r in router.routes if r.path == path and "POST" in r.methods)
    data = {"username": "new_user", "password": "test-password", "email": "new@example.test"}
    if persisted:
        result = await endpoint(data, SimpleNamespace(headers={}, client=None), username="admin_uuid")
        assert result["user"]["user_id"] == "user_generated"
        assert audit.await_args.kwargs["target_id"] == "user_generated"
    else:
        with pytest.raises(HTTPException) as exc:
            await endpoint(data, SimpleNamespace(headers={}, client=None), username="admin_uuid")
        assert exc.value.status_code == 503
        audit.assert_not_awaited()
    assert "user_id" not in dao.create_user.await_args.kwargs
    dao.get_user_by_username_any.assert_awaited_once_with("new_user")
