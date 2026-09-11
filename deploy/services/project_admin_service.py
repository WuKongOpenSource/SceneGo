"""Project settings and membership business logic."""
from __future__ import annotations

from typing import Any, Dict, Optional
from services.project_group_service import validate_assignment


class ProjectAdminServiceError(RuntimeError):
    pass


class ProjectAdminForbidden(ProjectAdminServiceError):
    pass


class UserNotFound(ProjectAdminServiceError):
    pass


class OwnerRemoveForbidden(ProjectAdminServiceError):
    pass


def _row_to_dict(row: Any) -> Optional[Dict[str, Any]]:
    return dict(row) if row is not None else None


def _rows_to_dicts(rows: Any) -> list[Dict[str, Any]]:
    return [dict(row) for row in rows]


async def _require_project_permission(
    project_id: str,
    user_id: str,
    required_role: str,
    *,
    project_member_dao: Any,
) -> None:
    allowed = await project_member_dao.check_permission(project_id, user_id, required_role)
    if not allowed:
        raise ProjectAdminForbidden("Project permission denied")


async def update_project(
    project_id: str,
    user_id: str,
    fields: Dict[str, Any],
    *,
    project_dao: Any,
    project_member_dao: Any,
) -> Dict[str, Any]:
    await _require_project_permission(project_id, user_id, "admin", project_member_dao=project_member_dao)
    if 'group_id' in fields:
        project = await project_dao.get_project(project_id)
        await validate_assignment(project, user_id, fields['group_id'])
    await project_dao.update_project_metadata(project_id, fields)
    return {"success": True}


async def archive_project(
    project_id: str,
    user_id: str,
    *,
    project_dao: Any,
    project_member_dao: Any,
) -> Dict[str, Any]:
    await _require_project_permission(project_id, user_id, "admin", project_member_dao=project_member_dao)
    await project_dao.archive_project(project_id, user_id)
    return {"success": True}


async def unarchive_project(
    project_id: str,
    user_id: str,
    *,
    project_dao: Any,
    project_member_dao: Any,
) -> Dict[str, Any]:
    await _require_project_permission(project_id, user_id, "admin", project_member_dao=project_member_dao)
    await project_dao.unarchive_project(project_id, user_id)
    return {"success": True}


async def list_members(
    project_id: str,
    user_id: str,
    *,
    project_member_dao: Any,
) -> Dict[str, Any]:
    await _require_project_permission(project_id, user_id, "readonly", project_member_dao=project_member_dao)
    members = await project_member_dao.get_project_members(project_id)
    return {"success": True, "members": _rows_to_dicts(members)}


async def add_member(
    project_id: str,
    user_id: str,
    *,
    target_user_id: str,
    role: Optional[str],
    responsibility: Optional[str],
    user_dao: Any,
    project_member_dao: Any,
) -> Dict[str, Any]:
    await _require_project_permission(project_id, user_id, "admin", project_member_dao=project_member_dao)
    target_user = await user_dao.get_user_by_id(target_user_id)
    if not target_user:
        lookup_by_username = getattr(user_dao, "get_user_by_username", None)
        if callable(lookup_by_username):
            target_user = await lookup_by_username(target_user_id)
    if not target_user:
        raise UserNotFound("Target user not found")
    resolved_user_id = str(target_user.get("user_id") or target_user_id)
    member = await project_member_dao.add_member(project_id, resolved_user_id, role, responsibility)
    return {"success": True, "member": _row_to_dict(member)}


async def update_member(
    project_id: str,
    user_id: str,
    member_user_id: str,
    fields: Dict[str, Any],
    *,
    project_member_dao: Any,
) -> Dict[str, Any]:
    await _require_project_permission(project_id, user_id, "admin", project_member_dao=project_member_dao)
    if fields.get("role") is not None:
        await project_member_dao.update_member_role(project_id, member_user_id, fields["role"])
    if fields.get("responsibility") is not None:
        await project_member_dao.update_member_responsibility(
            project_id,
            member_user_id,
            fields["responsibility"],
        )
    return {"success": True}


async def remove_member(
    project_id: str,
    user_id: str,
    member_user_id: str,
    *,
    project_member_dao: Any,
) -> Dict[str, Any]:
    await _require_project_permission(project_id, user_id, "admin", project_member_dao=project_member_dao)
    member = await project_member_dao.get_member(project_id, member_user_id)
    if member and member["role"] == "owner":
        raise OwnerRemoveForbidden("Cannot remove project owner")
    await project_member_dao.remove_member(project_id, member_user_id)
    return {"success": True}
