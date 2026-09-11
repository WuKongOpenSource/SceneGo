from __future__ import annotations

import pytest

from services import project_core_service


class FakeProjectDAO:
    created = None
    access_updates = []
    missing = False
    owner_id = "owner"

    @classmethod
    async def create_project(cls, **kwargs):
        cls.created = kwargs
        return {"project_id": "proj_1", **kwargs}

    @classmethod
    async def get_project(cls, project_id: str):
        if cls.missing:
            return None
        return {"project_id": project_id, "user_id": cls.owner_id, "project_name": "Project"}

    @classmethod
    async def update_project_access(cls, project_id: str):
        cls.access_updates.append(project_id)


class FakeVersionDAO:
    created = None

    @classmethod
    async def create_version(cls, **kwargs):
        cls.created = kwargs
        return {"version_id": "ver_1", **kwargs}

    @staticmethod
    async def get_project_versions(project_id: str):
        return [{"version_id": "ver_1", "project_id": project_id}]


class FakeProjectMemberDAO:
    added = None
    added_rows = []
    logged_org_query = None
    logged_user_query = None
    permission_users = set()

    @classmethod
    async def add_member(cls, **kwargs):
        cls.added = kwargs
        cls.added_rows.append(kwargs)
        return {"member_id": "pm_1", **kwargs}

    @classmethod
    async def get_org_accessible_projects(cls, user_id: str, org_id: str, include_archived: bool):
        cls.logged_org_query = {
            "user_id": user_id,
            "org_id": org_id,
            "include_archived": include_archived,
        }
        return [{"project_id": "proj_org"}]

    @classmethod
    async def get_user_accessible_projects(cls, user_id: str, include_archived: bool):
        cls.logged_user_query = {"user_id": user_id, "include_archived": include_archived}
        return [{"project_id": "proj_user"}]

    @classmethod
    async def check_permission(cls, project_id: str, user_id: str, required_role: str):
        return user_id in cls.permission_users

    @staticmethod
    async def get_project_members(project_id: str):
        return [{"project_id": project_id, "user_id": "owner", "role": "owner"}]


class FakeActivityLogDAO:
    logged = None

    @classmethod
    async def log_activity(cls, **kwargs):
        cls.logged = kwargs


class FakeOrganizationMemberDAO:
    members = {"member"}

    @classmethod
    async def is_member(cls, org_id: str, user_id: str):
        return user_id in cls.members


class FakeUserDAO:
    admins = set()
    users_by_name = {}

    @classmethod
    async def is_admin_user(cls, user_id: str):
        return user_id in cls.admins

    @classmethod
    async def get_user_by_username(cls, username: str):
        return cls.users_by_name.get(username)


def setup_function():
    FakeProjectDAO.created = None
    FakeProjectDAO.access_updates = []
    FakeProjectDAO.missing = False
    FakeProjectDAO.owner_id = "owner"
    FakeVersionDAO.created = None
    FakeProjectMemberDAO.added = None
    FakeProjectMemberDAO.added_rows = []
    FakeProjectMemberDAO.logged_org_query = None
    FakeProjectMemberDAO.logged_user_query = None
    FakeProjectMemberDAO.permission_users = set()
    FakeActivityLogDAO.logged = None
    FakeOrganizationMemberDAO.members = {"member"}
    FakeUserDAO.admins = set()
    FakeUserDAO.users_by_name = {}


async def test_create_project_creates_initial_version_owner_member_and_log():
    result = await project_core_service.create_project(
        user_id="owner",
        project_name="My Project",
        description="desc",
        visibility=None,
        member_usernames=None,
        settings={"creation_preferences": {"orientation": "portrait", "aspect_ratio": "9:16"}},
        project_dao=FakeProjectDAO,
        version_dao=FakeVersionDAO,
        project_member_dao=FakeProjectMemberDAO,
        user_dao=FakeUserDAO,
        activity_log_dao=FakeActivityLogDAO,
    )

    assert result["success"] is True
    assert result["project"]["project_id"] == "proj_1"
    assert FakeProjectDAO.created["visibility"] == "private"
    assert FakeProjectDAO.created["settings"] == {
        "creation_preferences": {"orientation": "portrait", "aspect_ratio": "9:16"}
    }
    assert FakeVersionDAO.created == {
        "project_id": "proj_1",
        "user_id": "owner",
        "version_name": "初始版本",
        "description": "项目创建时的初始版本",
    }
    assert FakeProjectMemberDAO.added == {"project_id": "proj_1", "user_id": "owner", "role": "owner"}
    assert FakeActivityLogDAO.logged == {
        "user_id": "owner",
        "action": "create_project",
        "resource_type": "project",
        "resource_id": "proj_1",
    }


async def test_create_project_adds_named_members_and_reports_missing_users():
    FakeUserDAO.users_by_name = {
        "alice": {"user_id": "user_alice", "username": "alice"},
        "owner-name": {"user_id": "owner", "username": "owner-name"},
    }

    result = await project_core_service.create_project(
        user_id="owner",
        project_name="Shared Project",
        description="",
        visibility="private",
        member_usernames=[" alice ", "missing", "alice", "owner-name"],
        settings=None,
        project_dao=FakeProjectDAO,
        version_dao=FakeVersionDAO,
        project_member_dao=FakeProjectMemberDAO,
        user_dao=FakeUserDAO,
        activity_log_dao=FakeActivityLogDAO,
    )

    assert FakeProjectMemberDAO.added_rows == [
        {"project_id": "proj_1", "user_id": "owner", "role": "owner"},
        {
            "project_id": "proj_1",
            "user_id": "user_alice",
            "role": "member",
            "responsibility": "all",
        },
    ]
    assert result["member_additions"]["missing_usernames"] == ["missing"]
    assert result["member_additions"]["added"][0]["user_id"] == "user_alice"


async def test_list_user_projects_uses_user_scope_without_org():
    result = await project_core_service.list_user_projects(
        user_id="user_1",
        include_archived=True,
        org_id=None,
        project_member_dao=FakeProjectMemberDAO,
        organization_member_dao=FakeOrganizationMemberDAO,
    )

    assert result == {"success": True, "projects": [{"project_id": "proj_user"}]}
    assert FakeProjectMemberDAO.logged_user_query == {"user_id": "user_1", "include_archived": True}


async def test_list_user_projects_requires_org_membership():
    with pytest.raises(project_core_service.OrganizationForbidden):
        await project_core_service.list_user_projects(
            user_id="outsider",
            include_archived=False,
            org_id="org_1",
            project_member_dao=FakeProjectMemberDAO,
            organization_member_dao=FakeOrganizationMemberDAO,
        )


async def test_list_user_projects_uses_org_scope_for_members():
    result = await project_core_service.list_user_projects(
        user_id="member",
        include_archived=False,
        org_id="org_1",
        project_member_dao=FakeProjectMemberDAO,
        organization_member_dao=FakeOrganizationMemberDAO,
    )

    assert result == {"success": True, "projects": [{"project_id": "proj_org"}]}
    assert FakeProjectMemberDAO.logged_org_query == {
        "user_id": "member",
        "org_id": "org_1",
        "include_archived": False,
    }


async def test_get_project_detail_allows_owner_and_returns_versions_members():
    result = await project_core_service.get_project_detail(
        "proj_1",
        user_id="owner",
        project_dao=FakeProjectDAO,
        version_dao=FakeVersionDAO,
        project_member_dao=FakeProjectMemberDAO,
        user_dao=FakeUserDAO,
    )

    assert result["success"] is True
    assert result["versions"] == [{"version_id": "ver_1", "project_id": "proj_1"}]
    assert result["members"][0]["role"] == "owner"
    assert FakeProjectDAO.access_updates == ["proj_1"]


async def test_get_project_detail_allows_member_or_admin():
    FakeProjectDAO.owner_id = "owner"
    FakeProjectMemberDAO.permission_users = {"editor"}

    member_result = await project_core_service.get_project_detail(
        "proj_1",
        user_id="editor",
        project_dao=FakeProjectDAO,
        version_dao=FakeVersionDAO,
        project_member_dao=FakeProjectMemberDAO,
        user_dao=FakeUserDAO,
    )

    FakeUserDAO.admins = {"admin"}
    admin_result = await project_core_service.get_project_detail(
        "proj_1",
        user_id="admin",
        project_dao=FakeProjectDAO,
        version_dao=FakeVersionDAO,
        project_member_dao=FakeProjectMemberDAO,
        user_dao=FakeUserDAO,
    )

    assert member_result["success"] is True
    assert admin_result["success"] is True


async def test_get_project_detail_raises_not_found_and_forbidden():
    FakeProjectDAO.missing = True
    with pytest.raises(project_core_service.ProjectNotFound):
        await project_core_service.get_project_detail(
            "missing",
            user_id="owner",
            project_dao=FakeProjectDAO,
            version_dao=FakeVersionDAO,
            project_member_dao=FakeProjectMemberDAO,
            user_dao=FakeUserDAO,
        )

    FakeProjectDAO.missing = False
    FakeProjectDAO.owner_id = "owner"
    with pytest.raises(project_core_service.ProjectForbidden):
        await project_core_service.get_project_detail(
            "proj_1",
            user_id="visitor",
            project_dao=FakeProjectDAO,
            version_dao=FakeVersionDAO,
            project_member_dao=FakeProjectMemberDAO,
            user_dao=FakeUserDAO,
        )
