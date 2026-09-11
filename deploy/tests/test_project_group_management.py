"""Shared administrative grouping behavior without importing private orchestration."""
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from routers import admin_project_groups as admin_routes
from services import admin_audit_service
from services.project_group_service import normalize_group_name


@pytest.mark.parametrize('value', ['', '  ', None, 'x' * 256])
def test_invalid_group_names_are_rejected(value):
    with pytest.raises(ValueError, match='1-255'):
        normalize_group_name(value)


def test_group_names_are_trimmed_and_support_unicode():
    assert normalize_group_name('  创作项目组 🎬  ') == '创作项目组 🎬'
    assert len(normalize_group_name('影' * 255)) == 255


@pytest.fixture
def group_route(monkeypatch):
    before = {'group_id': 'grp_1', 'user_id': 'owner', 'group_name': 'Old', 'project_count': 3}
    monkeypatch.setattr(admin_routes, '_require_db', lambda: None)
    monkeypatch.setattr(admin_routes.ProjectGroupDAO, 'get', AsyncMock(return_value=before))
    update = AsyncMock(return_value={**before, 'group_name': '新名称'})
    monkeypatch.setattr(admin_routes.ProjectGroupDAO, 'update', update)
    audit = AsyncMock()
    monkeypatch.setattr(admin_audit_service, 'record', audit)
    monkeypatch.setattr(admin_audit_service, 'caller_admin_id', lambda request: 'operator')
    request = Request({'type': 'http', 'method': 'PUT', 'path': '/api/admin/project-groups/grp_1', 'headers': []})
    return update, audit, request


@pytest.mark.asyncio
async def test_rename_preserves_group_identity_and_records_audit(group_route):
    update, audit, request = group_route
    result = await admin_routes.admin_update_project_group(
        'grp_1', admin_routes.ProjectGroupUpdateBody(group_name=' 新名称 '), request,
    )
    update.assert_awaited_once_with('grp_1', {'group_name': '新名称'})
    assert result['group']['group_id'] == 'grp_1'
    assert result['group']['user_id'] == 'owner'
    assert result['group']['project_count'] == 3
    assert audit.await_args.kwargs['before']['group_name'] == 'Old'
    assert audit.await_args.kwargs['after'] == {'group_name': '新名称'}


@pytest.mark.asyncio
@pytest.mark.parametrize('name', [None, '', '  ', 'x' * 256])
async def test_invalid_rename_does_not_write_or_audit(group_route, name):
    update, audit, request = group_route
    with pytest.raises(HTTPException) as error:
        await admin_routes.admin_update_project_group(
            'grp_1', admin_routes.ProjectGroupUpdateBody(group_name=name), request,
        )
    assert error.value.status_code == 400
    update.assert_not_awaited()
    audit.assert_not_awaited()


@pytest.mark.asyncio
async def test_missing_group_does_not_write(group_route, monkeypatch):
    update, audit, request = group_route
    monkeypatch.setattr(admin_routes.ProjectGroupDAO, 'get', AsyncMock(return_value=None))
    with pytest.raises(HTTPException) as error:
        await admin_routes.admin_update_project_group(
            'missing', admin_routes.ProjectGroupUpdateBody(group_name='Name'), request,
        )
    assert error.value.status_code == 404
    update.assert_not_awaited()


@pytest.mark.asyncio
async def test_description_only_update_does_not_require_rename(group_route):
    update, _, request = group_route
    await admin_routes.admin_update_project_group(
        'grp_1', admin_routes.ProjectGroupUpdateBody(description='Description'), request,
    )
    update.assert_awaited_once_with('grp_1', {'description': 'Description'})


@pytest.mark.parametrize('failure', ['missing_row', 'foreign_key', 'database_error'])
async def test_failed_creation_never_reports_success_or_writes_an_audit(group_route, monkeypatch, failure):
    from asyncpg import ForeignKeyViolationError

    _, audit, request = group_route
    monkeypatch.setattr(admin_routes.UserDAO, 'get_user_by_id', AsyncMock(return_value={'user_id': 'owner'}))
    create = AsyncMock(return_value=None)
    if failure == 'foreign_key':
        create.side_effect = ForeignKeyViolationError('private database diagnostic')
    elif failure == 'database_error':
        create.side_effect = RuntimeError('private database diagnostic')
    monkeypatch.setattr(admin_routes.ProjectGroupDAO, 'create', create)
    with pytest.raises(HTTPException) as error:
        await admin_routes.admin_create_project_group(
            admin_routes.ProjectGroupCreateBody(user_id='owner', group_name='Fixture'), request,
        )
    assert error.value.status_code == (400 if failure == 'foreign_key' else 500)
    assert 'private database diagnostic' not in str(error.value.detail)
    audit.assert_not_awaited()


async def test_missing_creation_owner_does_not_write(group_route, monkeypatch):
    _, audit, request = group_route
    monkeypatch.setattr(admin_routes.UserDAO, 'get_user_by_id', AsyncMock(return_value=None))
    create = AsyncMock()
    monkeypatch.setattr(admin_routes.ProjectGroupDAO, 'create', create)
    with pytest.raises(HTTPException) as error:
        await admin_routes.admin_create_project_group(
            admin_routes.ProjectGroupCreateBody(user_id='missing', group_name='Fixture'), request,
        )
    assert error.value.status_code == 400
    create.assert_not_awaited()
    audit.assert_not_awaited()


async def test_deleted_group_during_update_does_not_write_success_audit(group_route):
    update, audit, request = group_route
    update.return_value = None
    with pytest.raises(HTTPException) as error:
        await admin_routes.admin_update_project_group(
            'grp_1', admin_routes.ProjectGroupUpdateBody(group_name='Name'), request,
        )
    assert error.value.status_code == 404
    audit.assert_not_awaited()


def test_shared_group_router_protects_every_operation_even_without_parent():
    from fastapi.routing import APIRoute
    from services.admin_access_service import require_admin_session

    routes = [route for route in admin_routes.router.routes if isinstance(route, APIRoute)]
    assert len(routes) == 7
    for route in routes:
        assert any(d.call is require_admin_session for d in route.dependant.dependencies), route.path


@pytest.mark.asyncio
async def test_personal_project_list_includes_persisted_group_id(monkeypatch):
    from types import SimpleNamespace
    from dao.content import content

    fetch = AsyncMock(return_value=[{'project_id': 'proj_1', 'group_id': 'grp_1'}])
    monkeypatch.setattr(content, 'get_db_manager', lambda: SimpleNamespace(fetch=fetch))
    result = await content.ProjectMemberDAO.get_user_accessible_projects('owner', True)
    query, user_id = fetch.await_args.args
    assert 'p.group_id' in query.split('FROM projects')[0]
    assert 'pm.user_id = $1' in query
    assert 'p.is_deleted IS NOT TRUE' in query
    assert user_id == 'owner'
    assert result[0]['group_id'] == 'grp_1'
