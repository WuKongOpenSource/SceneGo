from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from routers.project_groups import create_project_groups_router
from services import project_group_service as service


@pytest.fixture
def group_api(monkeypatch):
    groups = {
        'grp_1': {'group_id': 'grp_1', 'user_id': 'owner', 'group_name': 'Original'},
        'grp_other': {'group_id': 'grp_other', 'user_id': 'other', 'group_name': 'Private'},
    }
    monkeypatch.setattr(service.ProjectGroupDAO, 'get', AsyncMock(side_effect=lambda gid: groups.get(gid)))
    monkeypatch.setattr(service.ProjectGroupDAO, 'list_for_user', AsyncMock(side_effect=lambda uid: [g for g in groups.values() if g['user_id'] == uid]))
    update = AsyncMock(side_effect=lambda gid, fields: groups[gid].update(fields) or dict(groups[gid]))
    delete = AsyncMock()
    create = AsyncMock(return_value={'group_id': 'grp_new', 'user_id': 'owner', 'group_name': 'New'})
    monkeypatch.setattr(service.ProjectGroupDAO, 'update', update)
    monkeypatch.setattr(service.ProjectGroupDAO, 'delete', delete)
    monkeypatch.setattr(service.ProjectGroupDAO, 'create', create)
    async def identity():
        return 'owner'
    app = FastAPI()
    app.include_router(create_project_groups_router(get_current_user_dependency=identity))
    return app, update, delete, create


@pytest.mark.asyncio
async def test_creator_can_list_create_and_rename_own_groups(group_api):
    app, update, _, create = group_api
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        listed = (await client.get('/api/project-groups')).json()['groups']
        assert [g['group_id'] for g in listed] == ['grp_1']
        assert (await client.post('/api/project-groups', json={'group_name': ' New ', 'user_id': 'other'})).status_code == 201
        create.assert_awaited_once_with(user_id='owner', group_name='New')
        response = await client.put('/api/project-groups/grp_1', json={'group_name': ' Renamed '})
        assert response.status_code == 200
        assert response.json()['group']['group_id'] == 'grp_1'
        update.assert_awaited_once_with('grp_1', {'group_name': 'Renamed'})


@pytest.mark.asyncio
async def test_cross_owner_and_missing_group_mutations_are_rejected(group_api):
    app, update, delete, _ = group_api
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        for gid, code in [('grp_other', 403), ('missing', 404)]:
            assert (await client.put(f'/api/project-groups/{gid}', json={'group_name': 'X'})).status_code == code
            assert (await client.delete(f'/api/project-groups/{gid}')).status_code == code
        assert (await client.put('/api/project-groups/grp_1', json={'group_name': '  '})).status_code == 400
    update.assert_not_awaited()
    delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_all_group_routes_require_identity():
    async def denied():
        raise HTTPException(401, 'Not authenticated')
    app = FastAPI()
    app.include_router(create_project_groups_router(get_current_user_dependency=denied))
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        assert (await client.get('/api/project-groups')).status_code == 401
        assert (await client.post('/api/project-groups', json={'group_name': 'X'})).status_code == 401
        assert (await client.put('/api/project-groups/grp_1', json={'group_name': 'X'})).status_code == 401
        assert (await client.delete('/api/project-groups/grp_1')).status_code == 401


@pytest.mark.asyncio
async def test_assignment_rejects_foreign_groups_and_non_owners(group_api):
    project = {'project_id': 'proj_1', 'user_id': 'owner'}
    await service.validate_assignment(project, 'owner', 'grp_1')
    await service.validate_assignment(project, 'owner', None)
    for user_id, group_id in [('owner', 'grp_other'), ('other', 'grp_other'), ('other', None)]:
        with pytest.raises(service.GroupAccessError):
            await service.validate_assignment(project, user_id, group_id)


@pytest.mark.asyncio
async def test_invalid_assignment_does_not_partially_save_project_metadata(group_api):
    from types import SimpleNamespace
    from services.project_admin_service import update_project
    project_dao = SimpleNamespace(
        get_project=AsyncMock(return_value={'project_id': 'p', 'user_id': 'owner'}),
        update_project_metadata=AsyncMock(),
    )
    members = SimpleNamespace(check_permission=AsyncMock(return_value=True))
    with pytest.raises(service.GroupAccessError):
        await update_project('p', 'owner', {'project_name': 'Changed', 'group_id': 'grp_other'}, project_dao=project_dao, project_member_dao=members)
    project_dao.update_project_metadata.assert_not_awaited()


@pytest.mark.asyncio
async def test_creation_checks_group_before_creating_project(group_api):
    from types import SimpleNamespace
    from services.project_core_service import create_project
    project_dao = SimpleNamespace(create_project=AsyncMock())
    with pytest.raises(service.GroupAccessError):
        await create_project(user_id='owner', project_name='X', description='', visibility='private', member_usernames=[], settings={},
                             project_dao=project_dao, version_dao=None, project_member_dao=None, user_dao=None, activity_log_dao=None, group_id='grp_other')
    project_dao.create_project.assert_not_awaited()
