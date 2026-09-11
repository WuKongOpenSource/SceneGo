"""Core project create/list/detail business logic."""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from services.project_group_service import require_owned_group


class ProjectCoreServiceError(RuntimeError):
    pass


class ProjectNotFound(ProjectCoreServiceError):
    pass


class ProjectForbidden(ProjectCoreServiceError):
    pass


class OrganizationForbidden(ProjectCoreServiceError):
    pass


def _row_to_dict(row: Any) -> Optional[Dict[str, Any]]:
    return dict(row) if row is not None else None


def _rows_to_dicts(rows: Any) -> list[Dict[str, Any]]:
    return [dict(row) for row in rows]


async def create_project(
    *,
    user_id: str,
    project_name: str,
    description: Optional[str],
    visibility: Optional[str],
    member_usernames: Optional[List[str]],
    settings: Optional[Dict[str, Any]],
    project_dao: Any,
    version_dao: Any,
    project_member_dao: Any,
    user_dao: Any,
    activity_log_dao: Any,
    group_id: Optional[str] = None,
) -> Dict[str, Any]:
    group_fields = {}
    if group_id is not None:
        await require_owned_group(group_id, user_id)
        group_fields['group_id'] = group_id
    project = await project_dao.create_project(
        user_id=user_id,
        project_name=project_name,
        description=description,
        visibility=visibility or "private",
        settings=settings or {},
        **group_fields,
    )
    project_id = project["project_id"]

    version = await version_dao.create_version(
        project_id=project_id,
        user_id=user_id,
        version_name="初始版本",
        description="项目创建时的初始版本",
    )

    await project_member_dao.add_member(
        project_id=project_id,
        user_id=user_id,
        role="owner",
    )

    added_members: list[Dict[str, Any]] = []
    missing_usernames: list[str] = []
    normalized_usernames = list(dict.fromkeys(
        username.strip() for username in (member_usernames or []) if username and username.strip()
    ))
    for username in normalized_usernames:
        target_user = await user_dao.get_user_by_username(username)
        if not target_user:
            missing_usernames.append(username)
            continue
        target_user_id = target_user.get("user_id")
        if not target_user_id or target_user_id == user_id:
            continue
        member = await project_member_dao.add_member(
            project_id=project_id,
            user_id=target_user_id,
            role="member",
            responsibility="all",
        )
        if member:
            added_members.append(dict(member))

    await activity_log_dao.log_activity(
        user_id=user_id,
        action="create_project",
        resource_type="project",
        resource_id=project_id,
    )

    return {
        "success": True,
        "project": _row_to_dict(project),
        "initial_version": _row_to_dict(version),
        "member_additions": {
            "added": added_members,
            "missing_usernames": missing_usernames,
        },
    }


async def list_user_projects(
    *,
    user_id: str,
    include_archived: bool,
    org_id: Optional[str],
    project_member_dao: Any,
    organization_member_dao: Any,
) -> Dict[str, Any]:
    if org_id:
        if not await organization_member_dao.is_member(org_id, user_id):
            raise OrganizationForbidden("User is not a member of this organization")
        projects = await project_member_dao.get_org_accessible_projects(
            user_id,
            org_id,
            include_archived,
        )
    else:
        projects = await project_member_dao.get_user_accessible_projects(user_id, include_archived)
    return {"success": True, "projects": _rows_to_dicts(projects)}


async def get_project_detail(
    project_id: str,
    *,
    user_id: str,
    project_dao: Any,
    version_dao: Any,
    project_member_dao: Any,
    user_dao: Any,
) -> Dict[str, Any]:
    project = await project_dao.get_project(project_id)
    if not project:
        raise ProjectNotFound("Project not found")

    has_access = (
        project.get("user_id") == user_id
        or await project_member_dao.check_permission(project_id, user_id, "readonly")
        or await user_dao.is_admin_user(user_id)
    )
    if not has_access:
        raise ProjectForbidden("No project access")

    await project_dao.update_project_access(project_id)

    versions = await version_dao.get_project_versions(project_id)
    members = await project_member_dao.get_project_members(project_id)

    return {
        "success": True,
        "project": dict(project),
        "versions": _rows_to_dicts(versions),
        "members": _rows_to_dicts(members),
    }
