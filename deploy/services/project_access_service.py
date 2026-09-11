"""Canonical project resource access checks.

Authentication currently yields a username, while project membership is keyed by
``users.user_id``.  All project-scoped routes should resolve that identity here
before consulting ownership or membership.
"""
from __future__ import annotations

from typing import Any, Optional

from dao_content import ProjectDAO, ProjectMemberDAO
from dao_user import UserDAO


class ProjectAccessDenied(LookupError):
    pass


async def resolve_user_id(identity: str, *, user_dao: Any = UserDAO) -> Optional[str]:
    value = str(identity or '').strip()
    if not value:
        return None

    user = await user_dao.get_user_by_id(value)
    if not user:
        user = await user_dao.get_user_by_username(value)
    return str((user or {}).get('user_id') or '').strip() or None


async def require_project_access(
    project_id: str,
    identity: str,
    required_role: str = 'readonly',
    *,
    user_dao: Any = UserDAO,
    project_dao: Any = ProjectDAO,
    member_dao: Any = ProjectMemberDAO,
) -> str:
    """Return the canonical user id or raise without leaking project existence."""
    project = await project_dao.get_project(project_id)
    user_id = await resolve_user_id(identity, user_dao=user_dao)
    if not project or not user_id:
        raise ProjectAccessDenied('项目不存在或无权访问')

    if str(project.get('user_id') or '') == user_id:
        return user_id
    if await member_dao.check_permission(project_id, user_id, required_role):
        return user_id
    raise ProjectAccessDenied('项目不存在或无权访问')
