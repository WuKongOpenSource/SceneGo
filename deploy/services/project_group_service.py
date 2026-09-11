"""Project-group management and ownership checks shared by project workflows."""
from __future__ import annotations

from dao.organization.project_group import ProjectGroupDAO


class GroupAccessError(ValueError):
    def __init__(self, message: str, status_code: int = 403):
        super().__init__(message)
        self.status_code = status_code


def normalize_group_name(value: str | None) -> str:
    name = (value or "").strip()
    if not name or len(name) > 255:
        raise ValueError("分组名称需为 1-255 个字符")
    return name


async def require_owned_group(group_id: str, user_id: str):
    group = await ProjectGroupDAO.get(group_id)
    if not group:
        raise GroupAccessError("项目分组不存在", 404)
    if group['user_id'] != user_id:
        raise GroupAccessError("只能管理自己的项目分组")
    return group


async def validate_assignment(project, user_id: str, group_id: str | None):
    if not project or project.get('is_deleted'):
        raise GroupAccessError("项目不存在", 404)
    if project['user_id'] != user_id:
        raise GroupAccessError("只有项目所有者可以调整项目分组")
    if group_id is not None:
        await require_owned_group(group_id, user_id)


async def create_group(user_id: str, group_name: str):
    return await ProjectGroupDAO.create(user_id=user_id, group_name=normalize_group_name(group_name))


async def rename_group(user_id: str, group_id: str, group_name: str):
    await require_owned_group(group_id, user_id)
    group = await ProjectGroupDAO.update(group_id, {'group_name': normalize_group_name(group_name)})
    if not group:
        raise GroupAccessError("项目分组不存在", 404)
    return group


async def delete_group(user_id: str, group_id: str):
    await require_owned_group(group_id, user_id)
    await ProjectGroupDAO.delete(group_id)
