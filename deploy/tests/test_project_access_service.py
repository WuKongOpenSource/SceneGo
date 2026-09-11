import pytest

from services.project_access_service import (
    ProjectAccessDenied,
    require_project_access,
    resolve_user_id,
)


class _Users:
    @staticmethod
    async def get_user_by_id(value):
        return {'user_id': value, 'username': 'yuan'} if value == 'user-1' else None

    @staticmethod
    async def get_user_by_username(value):
        return {'user_id': 'user-1', 'username': value} if value == 'yuan' else None


class _Projects:
    owner_id = 'owner-1'

    @classmethod
    async def get_project(cls, project_id):
        return {'project_id': project_id, 'user_id': cls.owner_id} if project_id == 'project-1' else None


class _Members:
    calls = []
    allowed = False

    @classmethod
    async def check_permission(cls, project_id, user_id, role):
        cls.calls.append((project_id, user_id, role))
        return cls.allowed


@pytest.mark.asyncio
async def test_resolve_user_id_accepts_username_and_canonical_id():
    assert await resolve_user_id('yuan', user_dao=_Users) == 'user-1'
    assert await resolve_user_id('user-1', user_dao=_Users) == 'user-1'


@pytest.mark.asyncio
async def test_project_owner_does_not_depend_on_membership_row():
    _Projects.owner_id = 'user-1'
    _Members.calls = []
    _Members.allowed = False

    user_id = await require_project_access(
        'project-1', 'yuan', 'member',
        user_dao=_Users, project_dao=_Projects, member_dao=_Members,
    )

    assert user_id == 'user-1'
    assert _Members.calls == []


@pytest.mark.asyncio
async def test_project_member_check_uses_resolved_user_id():
    _Projects.owner_id = 'owner-1'
    _Members.calls = []
    _Members.allowed = True

    user_id = await require_project_access(
        'project-1', 'yuan', 'readonly',
        user_dao=_Users, project_dao=_Projects, member_dao=_Members,
    )

    assert user_id == 'user-1'
    assert _Members.calls == [('project-1', 'user-1', 'readonly')]


@pytest.mark.asyncio
async def test_unknown_or_unauthorized_project_is_hidden():
    _Projects.owner_id = 'owner-1'
    _Members.allowed = False

    with pytest.raises(ProjectAccessDenied):
        await require_project_access(
            'project-1', 'yuan', 'member',
            user_dao=_Users, project_dao=_Projects, member_dao=_Members,
        )
    with pytest.raises(ProjectAccessDenied):
        await require_project_access(
            'missing', 'yuan', 'readonly',
            user_dao=_Users, project_dao=_Projects, member_dao=_Members,
        )
