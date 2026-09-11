from __future__ import annotations

import pytest

from services import project_admin_service


class FakeProjectDAO:
    metadata_updates = []
    archived = []
    unarchived = []

    @classmethod
    async def update_project_metadata(cls, project_id: str, fields: dict):
        cls.metadata_updates.append({"project_id": project_id, "fields": fields})

    @classmethod
    async def archive_project(cls, project_id: str, user_id: str):
        cls.archived.append({"project_id": project_id, "user_id": user_id})

    @classmethod
    async def unarchive_project(cls, project_id: str, user_id: str):
        cls.unarchived.append({"project_id": project_id, "user_id": user_id})


class FakeProjectMemberDAO:
    permissions = {}
    members = [{"project_id": "proj_1", "user_id": "owner", "role": "owner"}]
    added = None
    role_updates = []
    responsibility_updates = []
    removed = []
    member_role = "member"

    @classmethod
    async def check_permission(cls, project_id: str, user_id: str, required_role: str):
        return cls.permissions.get((project_id, user_id, required_role), False)

    @classmethod
    async def get_project_members(cls, project_id: str):
        return cls.members

    @classmethod
    async def add_member(cls, project_id: str, user_id: str, role: str, responsibility: str):
        cls.added = {
            "project_id": project_id,
            "user_id": user_id,
            "role": role,
            "responsibility": responsibility,
        }
        return cls.added

    @classmethod
    async def update_member_role(cls, project_id: str, user_id: str, role: str):
        cls.role_updates.append({"project_id": project_id, "user_id": user_id, "role": role})

    @classmethod
    async def update_member_responsibility(cls, project_id: str, user_id: str, responsibility: str):
        cls.responsibility_updates.append(
            {"project_id": project_id, "user_id": user_id, "responsibility": responsibility}
        )

    @classmethod
    async def get_member(cls, project_id: str, user_id: str):
        return {"project_id": project_id, "user_id": user_id, "role": cls.member_role}

    @classmethod
    async def remove_member(cls, project_id: str, user_id: str):
        cls.removed.append({"project_id": project_id, "user_id": user_id})


class FakeUserDAO:
    existing = {"user_2"}
    existing_by_username = {"alice": "user_alice"}

    @classmethod
    async def get_user_by_id(cls, user_id: str):
        return {"user_id": user_id} if user_id in cls.existing else None

    @classmethod
    async def get_user_by_username(cls, username: str):
        user_id = cls.existing_by_username.get(username)
        return {"user_id": user_id, "username": username} if user_id else None


def setup_function():
    FakeProjectDAO.metadata_updates = []
    FakeProjectDAO.archived = []
    FakeProjectDAO.unarchived = []
    FakeProjectMemberDAO.permissions = {
        ("proj_1", "admin", "admin"): True,
        ("proj_1", "reader", "readonly"): True,
    }
    FakeProjectMemberDAO.members = [{"project_id": "proj_1", "user_id": "owner", "role": "owner"}]
    FakeProjectMemberDAO.added = None
    FakeProjectMemberDAO.role_updates = []
    FakeProjectMemberDAO.responsibility_updates = []
    FakeProjectMemberDAO.removed = []
    FakeProjectMemberDAO.member_role = "member"
    FakeUserDAO.existing = {"user_2"}
    FakeUserDAO.existing_by_username = {"alice": "user_alice"}


async def test_update_project_requires_admin_and_preserves_empty_fields():
    result = await project_admin_service.update_project(
        "proj_1",
        "admin",
        {"description": "", "tags": []},
        project_dao=FakeProjectDAO,
        project_member_dao=FakeProjectMemberDAO,
    )

    assert result == {"success": True}
    assert FakeProjectDAO.metadata_updates == [
        {"project_id": "proj_1", "fields": {"description": "", "tags": []}}
    ]


async def test_update_project_rejects_non_admin():
    with pytest.raises(project_admin_service.ProjectAdminForbidden):
        await project_admin_service.update_project(
            "proj_1",
            "visitor",
            {"project_name": "Nope"},
            project_dao=FakeProjectDAO,
            project_member_dao=FakeProjectMemberDAO,
        )


async def test_archive_and_unarchive_project_delegate_after_admin_check():
    archived = await project_admin_service.archive_project(
        "proj_1",
        "admin",
        project_dao=FakeProjectDAO,
        project_member_dao=FakeProjectMemberDAO,
    )
    unarchived = await project_admin_service.unarchive_project(
        "proj_1",
        "admin",
        project_dao=FakeProjectDAO,
        project_member_dao=FakeProjectMemberDAO,
    )

    assert archived == {"success": True}
    assert unarchived == {"success": True}
    assert FakeProjectDAO.archived == [{"project_id": "proj_1", "user_id": "admin"}]
    assert FakeProjectDAO.unarchived == [{"project_id": "proj_1", "user_id": "admin"}]


async def test_list_members_requires_readonly():
    result = await project_admin_service.list_members(
        "proj_1",
        "reader",
        project_member_dao=FakeProjectMemberDAO,
    )

    assert result == {"success": True, "members": FakeProjectMemberDAO.members}


async def test_add_member_requires_admin_and_existing_user():
    result = await project_admin_service.add_member(
        "proj_1",
        "admin",
        target_user_id="user_2",
        role="member",
        responsibility="art",
        user_dao=FakeUserDAO,
        project_member_dao=FakeProjectMemberDAO,
    )

    assert result["success"] is True
    assert FakeProjectMemberDAO.added == {
        "project_id": "proj_1",
        "user_id": "user_2",
        "role": "member",
        "responsibility": "art",
    }

    with pytest.raises(project_admin_service.UserNotFound):
        await project_admin_service.add_member(
            "proj_1",
            "admin",
            target_user_id="missing",
            role="member",
            responsibility="all",
            user_dao=FakeUserDAO,
            project_member_dao=FakeProjectMemberDAO,
        )


async def test_add_member_accepts_username_and_stores_canonical_user_id():
    result = await project_admin_service.add_member(
        "proj_1",
        "admin",
        target_user_id="alice",
        role="member",
        responsibility="all",
        user_dao=FakeUserDAO,
        project_member_dao=FakeProjectMemberDAO,
    )

    assert result["success"] is True
    assert FakeProjectMemberDAO.added == {
        "project_id": "proj_1",
        "user_id": "user_alice",
        "role": "member",
        "responsibility": "all",
    }


async def test_update_member_only_updates_explicit_fields():
    result = await project_admin_service.update_member(
        "proj_1",
        "admin",
        "user_2",
        {"role": "admin", "responsibility": ""},
        project_member_dao=FakeProjectMemberDAO,
    )

    assert result == {"success": True}
    assert FakeProjectMemberDAO.role_updates == [
        {"project_id": "proj_1", "user_id": "user_2", "role": "admin"}
    ]
    assert FakeProjectMemberDAO.responsibility_updates == [
        {"project_id": "proj_1", "user_id": "user_2", "responsibility": ""}
    ]


async def test_remove_member_rejects_owner_and_removes_non_owner():
    FakeProjectMemberDAO.member_role = "owner"
    with pytest.raises(project_admin_service.OwnerRemoveForbidden):
        await project_admin_service.remove_member(
            "proj_1",
            "admin",
            "owner",
            project_member_dao=FakeProjectMemberDAO,
        )

    FakeProjectMemberDAO.member_role = "member"
    result = await project_admin_service.remove_member(
        "proj_1",
        "admin",
        "user_2",
        project_member_dao=FakeProjectMemberDAO,
    )

    assert result == {"success": True}
    assert FakeProjectMemberDAO.removed == [{"project_id": "proj_1", "user_id": "user_2"}]
