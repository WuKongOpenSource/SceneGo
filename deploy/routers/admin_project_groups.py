"""Administrative project grouping shared by both application entrypoints.

Grouping changes organization only: they never grant project membership, move
media, alter generation tasks, or delete a project when its group is removed.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from asyncpg import ForeignKeyViolationError
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core.db_manager import get_db_manager
from dao_content import ProjectDAO
from dao_project_group import ProjectGroupDAO
from dao_user import UserDAO
from services import admin_audit_service
from services.admin_access_service import require_admin_session
from services.project_group_service import GroupAccessError, normalize_group_name, validate_assignment
from services.sensitive_data_redaction import redact_sensitive_text

logger = logging.getLogger(__name__)
# The parent supplies /api/admin. Keep authorization here as well so another
# composition cannot accidentally expose the handlers without role validation.
router = APIRouter(tags=["admin-project-groups"], dependencies=[Depends(require_admin_session)])


def _require_db() -> None:
    if not get_db_manager():
        raise HTTPException(status_code=503, detail="Database unavailable")


def _row_to_jsonable(row: Any) -> dict[str, Any]:
    # Group rows contain timestamps and counts, not provider/workflow JSON.
    return {key: value.isoformat() if isinstance(value, (date, datetime)) else
            float(value) if isinstance(value, Decimal) else value
            for key, value in dict(row or {}).items()}


class ProjectGroupCreateBody(BaseModel):
    user_id: str
    group_name: str
    description: str = ""
    color: Optional[str] = None
    sort_order: int = 0


class ProjectGroupUpdateBody(BaseModel):
    group_name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None


class ProjectMoveBody(BaseModel):
    group_id: Optional[str] = None


@router.get("/project-groups")
async def admin_list_project_groups(user_id: Optional[str] = None, org_id: Optional[str] = None):
    _require_db()
    groups = await ProjectGroupDAO.list_for_user(user_id) if user_id else await ProjectGroupDAO.list_all()
    if org_id:
        groups = [group for group in groups if group.get("organization_id") == org_id]
    return {"success": True, "groups": [_row_to_jsonable(group) for group in groups]}


@router.post("/project-groups", status_code=201)
async def admin_create_project_group(body: ProjectGroupCreateBody, request: Request):
    _require_db()
    if not await UserDAO.get_user_by_id(body.user_id):
        raise HTTPException(status_code=400, detail=f"归属用户不存在：{body.user_id}")
    try:
        name = normalize_group_name(body.group_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        group = await ProjectGroupDAO.create(
            user_id=body.user_id, group_name=name, description=body.description or "",
            color=body.color, sort_order=body.sort_order or 0,
        )
    except ForeignKeyViolationError as exc:
        raise HTTPException(status_code=400, detail="归属用户不存在或已不可用") from exc
    except Exception as exc:
        logger.error("Project group creation failed: %s", redact_sensitive_text(exc))
        raise HTTPException(status_code=500, detail="创建分组失败") from exc
    if not group:
        raise HTTPException(status_code=500, detail="创建分组失败")
    await admin_audit_service.record(
        request, admin_user_id=admin_audit_service.caller_admin_id(request),
        action="project_group_create", target_type="project_group", target_id=group["group_id"],
        after=body.model_dump(),
    )
    return {"success": True, "group": _row_to_jsonable(group)}


@router.get("/project-groups/{group_id}/projects")
async def admin_list_group_projects(group_id: str):
    _require_db()
    group = await ProjectGroupDAO.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="分组不存在")
    projects = await ProjectGroupDAO.list_projects(group_id)
    return {"success": True, "group": _row_to_jsonable(group),
            "projects": [_row_to_jsonable(project) for project in projects]}


@router.get("/ungrouped-projects")
async def admin_list_ungrouped_projects():
    _require_db()
    return {"success": True, "projects": [_row_to_jsonable(p) for p in await ProjectGroupDAO.list_projects(None)]}


@router.put("/project-groups/{group_id}")
async def admin_update_project_group(group_id: str, body: ProjectGroupUpdateBody, request: Request):
    _require_db()
    before = await ProjectGroupDAO.get(group_id)
    if not before:
        raise HTTPException(status_code=404, detail="分组不存在")
    fields = body.model_dump(exclude_unset=True)
    if "group_name" in fields:
        try:
            fields["group_name"] = normalize_group_name(fields["group_name"])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    group = await ProjectGroupDAO.update(group_id, fields)
    if not group:
        raise HTTPException(status_code=404, detail="分组不存在")
    await admin_audit_service.record(
        request, admin_user_id=admin_audit_service.caller_admin_id(request),
        action="project_group_update", target_type="project_group", target_id=group_id,
        before=_row_to_jsonable(before), after=fields,
    )
    return {"success": True, "group": _row_to_jsonable(group)}


@router.delete("/project-groups/{group_id}")
async def admin_delete_project_group(group_id: str, request: Request):
    _require_db()
    before = await ProjectGroupDAO.get(group_id)
    # Preserve idempotent deletion; the existing FK sets project.group_id to
    # NULL and leaves project data and owner/member permissions untouched.
    await ProjectGroupDAO.delete(group_id)
    await admin_audit_service.record(
        request, admin_user_id=admin_audit_service.caller_admin_id(request),
        action="project_group_delete", target_type="project_group", target_id=group_id,
        before=_row_to_jsonable(before) if before else None,
    )
    return {"success": True}


@router.post("/projects/{project_id}/move")
async def admin_move_project(project_id: str, body: ProjectMoveBody, request: Request):
    _require_db()
    project = await ProjectDAO.get_project(project_id)
    if not project or project.get("is_deleted"):
        raise HTTPException(status_code=404, detail="项目不存在")
    try:
        # An administrator may reorganize another user's project, but cannot
        # assign it to a group owned by a different user or transfer ownership.
        await validate_assignment(project, project["user_id"], body.group_id)
    except GroupAccessError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    await ProjectGroupDAO.move_project(project_id, body.group_id)
    await admin_audit_service.record(
        request, admin_user_id=admin_audit_service.caller_admin_id(request),
        action="project_move", target_type="project", target_id=project_id,
        after={"group_id": body.group_id},
    )
    return {"success": True}
