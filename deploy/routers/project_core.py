"""DAO-backed project create/list/detail routes."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from routers.project_groups import create_project_groups_router
from services.project_group_service import GroupAccessError

from services.project_core_service import (
    OrganizationForbidden,
    ProjectForbidden,
    ProjectNotFound,
    create_project as create_project_service,
    get_project_detail as get_project_detail_service,
    list_user_projects as list_user_projects_service,
)


class ProjectCreate(BaseModel):
    project_name: str
    group_id: Optional[str] = None
    description: Optional[str] = ""
    visibility: Optional[str] = "private"
    member_usernames: Optional[List[str]] = None
    settings: Optional[Dict[str, Any]] = None


def create_project_core_router(
    *,
    get_current_user_dependency: Any,
    project_dao: Any,
    version_dao: Any,
    project_member_dao: Any,
    user_dao: Any,
    activity_log_dao: Any,
    organization_member_dao: Any,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    ProjectDAO = project_dao
    VersionDAO = version_dao
    ProjectMemberDAO = project_member_dao
    UserDAO = user_dao
    ActivityLogDAO = activity_log_dao
    OrganizationMemberDAO = organization_member_dao

    @router.post("/api/projects")
    async def create_project(
        project_data: ProjectCreate,
        user_id: str = Depends(get_current_user),
    ):
        """Create a new DAO-backed project."""
        try:
            return await create_project_service(
                user_id=user_id,
                project_name=project_data.project_name,
                group_id=project_data.group_id,
                description=project_data.description,
                visibility=project_data.visibility,
                member_usernames=project_data.member_usernames,
                settings=project_data.settings,
                project_dao=ProjectDAO,
                version_dao=VersionDAO,
                project_member_dao=ProjectMemberDAO,
                user_dao=UserDAO,
                activity_log_dao=ActivityLogDAO,
            )
        except GroupAccessError as e:
            raise HTTPException(status_code=e.status_code, detail=str(e)) from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.get("/api/projects")
    async def get_user_projects(
        include_archived: bool = False,
        org_id: Optional[str] = None,
        user_id: str = Depends(get_current_user),
    ):
        """List all projects available to the current user."""
        try:
            return await list_user_projects_service(
                user_id=user_id,
                include_archived=include_archived,
                org_id=org_id,
                project_member_dao=ProjectMemberDAO,
                organization_member_dao=OrganizationMemberDAO,
            )
        except OrganizationForbidden as e:
            raise HTTPException(status_code=403, detail="不是该组织成员") from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.get("/api/projects/{project_id}")
    async def get_project_detail(
        project_id: str,
        user_id: str = Depends(get_current_user),
    ):
        """Return a DAO-backed project detail payload."""
        try:
            return await get_project_detail_service(
                project_id,
                user_id=user_id,
                project_dao=ProjectDAO,
                version_dao=VersionDAO,
                project_member_dao=ProjectMemberDAO,
                user_dao=UserDAO,
            )
        except ProjectNotFound as e:
            raise HTTPException(status_code=404, detail="项目不存在") from e
        except ProjectForbidden as e:
            raise HTTPException(status_code=403, detail="无权访问") from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    router.include_router(create_project_groups_router(get_current_user_dependency=get_current_user))
    return router
