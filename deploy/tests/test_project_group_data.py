import pytest

from dao.content.content import ProjectDAO, ProjectMemberDAO
from dao.organization.project_group import ProjectGroupDAO
from services.project_admin_service import update_project
from services.project_group_service import rename_group, delete_group


@pytest.mark.asyncio
async def test_frontend_and_admin_share_groups_membership_counts_and_rename(test_db):
    owner = 'user_dao_fixture'
    group = await ProjectGroupDAO.create(owner, 'Original')
    other = await ProjectGroupDAO.create(owner, 'Target')
    projects = []
    for name in ['Live project', 'Archived project', 'Deleted project']:
        project = await ProjectDAO.create_project(owner, name, group_id=group['group_id'])
        await ProjectMemberDAO.add_member(project['project_id'], owner, role='owner')
        projects.append(project)
    await test_db.execute('UPDATE projects SET is_archived=TRUE WHERE project_id=$1', projects[1]['project_id'])
    await test_db.execute('UPDATE projects SET is_deleted=TRUE WHERE project_id=$1', projects[2]['project_id'])
    grouped = await ProjectGroupDAO.list_projects(group['group_id'])
    assert {p['project_id'] for p in grouped} == {p['project_id'] for p in projects[:2]}
    listed = await ProjectGroupDAO.list_all()
    assert next(g for g in listed if g['group_id'] == group['group_id'])['project_count'] == 2

    await rename_group(owner, group['group_id'], ' Renamed ')
    frontend = await ProjectMemberDAO.get_user_accessible_projects(owner, True)
    visible = [p for p in frontend if p['group_id'] == group['group_id']]
    assert len(visible) == 2
    assert all(p['group_name'] == 'Renamed' for p in visible)
    assert (await ProjectGroupDAO.get(group['group_id']))['group_name'] == 'Renamed'

    await update_project(projects[0]['project_id'], owner, {'group_id': other['group_id'], 'project_name': 'Moved'},
                         project_dao=ProjectDAO, project_member_dao=ProjectMemberDAO)
    assert len(await ProjectGroupDAO.list_projects(group['group_id'])) == 1
    assert (await ProjectGroupDAO.list_projects(other['group_id']))[0]['project_name'] == 'Moved'
    assert await ProjectMemberDAO.check_permission(projects[0]['project_id'], owner, 'owner')

    await delete_group(owner, other['group_id'])
    preserved = await ProjectDAO.get_project(projects[0]['project_id'])
    assert preserved['group_id'] is None
    assert preserved['project_name'] == 'Moved'
    assert any(p['project_id'] == preserved['project_id'] for p in await ProjectGroupDAO.list_projects(None))
    assert await ProjectMemberDAO.check_permission(preserved['project_id'], owner, 'owner')
