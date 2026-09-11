import logging

import pytest
from fastapi import HTTPException

from routers import entity_files as routes


class EmptyDAO:
    listed = False

    @classmethod
    async def get_entity_files(cls, *_args, **_kwargs):
        cls.listed = True
        return {"items": [], "total": 0}


class UserDAO:
    admin = False

    @classmethod
    async def is_admin_user(cls, _identity):
        return cls.admin

    @staticmethod
    async def get_user_by_id(_identity):
        return None

    @staticmethod
    async def get_user_by_username(identity):
        return {"user_id": f"id-{identity}"}


def build_router():
    async def current_user():
        return "alice"

    return routes.create_entity_files_router(
        get_current_user_dependency=current_user,
        file_dao=EmptyDAO,
        entity_file_dao=EmptyDAO,
        episode_dao=EmptyDAO,
        storyboard_dao=EmptyDAO,
        asset_dao=EmptyDAO,
        video_segment_dao=EmptyDAO,
        user_dao=UserDAO,
        save_generated_file_to_db_provider=lambda: None,
        logger=logging.getLogger(__name__),
    )


def endpoint(router, path, method):
    return next(route.endpoint for route in router.routes if route.path == path and method in route.methods)


@pytest.mark.asyncio
async def test_entity_list_checks_access_before_query(monkeypatch):
    EmptyDAO.listed = False

    async def deny(*_args, **_kwargs):
        raise routes.EntityAccessDenied("denied")

    monkeypatch.setattr(routes, "require_entity_access", deny)
    handler = endpoint(build_router(), "/api/entity-files", "GET")
    with pytest.raises(HTTPException) as exc:
        await handler(entity_type="asset", entity_id="asset_1", user_id="alice")
    assert exc.value.status_code == 404
    assert EmptyDAO.listed is False


@pytest.mark.asyncio
async def test_global_file_migration_requires_admin(monkeypatch):
    UserDAO.admin = False
    called = False

    async def migration():
        nonlocal called
        called = True

    monkeypatch.setattr(routes, "run_entity_file_migration_service", migration)
    handler = endpoint(build_router(), "/api/entity-files/migrate", "POST")
    with pytest.raises(HTTPException) as exc:
        await handler(user_id="alice")
    assert exc.value.status_code == 403
    assert called is False


@pytest.mark.asyncio
async def test_permanent_delete_passes_canonical_owner_and_risk_ack(monkeypatch):
    calls = []

    async def hard_delete(**kwargs):
        calls.append(kwargs)
        return {"success": True, "freed_bytes": 12}

    monkeypatch.setattr(routes, "hard_delete_entity_file_service", hard_delete)
    handler = endpoint(build_router(), "/api/entity-files/{file_id}/hard", "DELETE")

    result = await handler(file_id="file_deleted", risk_ack=True, user_id="alice")

    assert result["freed_bytes"] == 12
    assert calls[0]["file_id"] == "file_deleted"
    assert calls[0]["user_id"] == "id-alice"
    assert calls[0]["risk_ack"] is True
