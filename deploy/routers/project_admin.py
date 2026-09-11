"""Project settings and membership route handlers."""

from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from services.project_group_service import GroupAccessError

from services.project_admin_service import (
    OwnerRemoveForbidden,
    ProjectAdminForbidden,
    UserNotFound,
    add_member as add_member_service,
    archive_project as archive_project_service,
    list_members as list_members_service,
    remove_member as remove_member_service,
    unarchive_project as unarchive_project_service,
    update_member as update_member_service,
    update_project as update_project_service,
)


class MemberAdd(BaseModel):
    user_id: str
    role: Optional[str] = "member"
    responsibility: Optional[str] = "all"


class MemberUpdate(BaseModel):
    role: Optional[str] = None
    responsibility: Optional[str] = None


class ProjectUpdate(BaseModel):
    group_id: Optional[str] = None
    project_name: Optional[str] = None
    description: Optional[str] = None
    cover_url: Optional[str] = None
    tags: Optional[List[str]] = None


def create_project_admin_router(
    *,
    get_current_user_dependency: Any,
    user_dao: Any,
    project_dao: Any,
    project_member_dao: Any,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    UserDAO = user_dao
    ProjectDAO = project_dao
    ProjectMemberDAO = project_member_dao

    @router.put("/api/projects/{project_id}")
    async def update_project(
        project_id: str,
        data: ProjectUpdate,
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await update_project_service(
                project_id,
                user_id,
                data.model_dump(exclude_unset=True),
                project_dao=ProjectDAO,
                project_member_dao=ProjectMemberDAO,
            )
        except ProjectAdminForbidden as e:
            raise HTTPException(status_code=403, detail="无权管理该项目") from e
        except GroupAccessError as e:
            raise HTTPException(status_code=e.status_code, detail=str(e)) from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/api/projects/{project_id}/archive")
    async def archive_project(
        project_id: str,
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await archive_project_service(
                project_id,
                user_id,
                project_dao=ProjectDAO,
                project_member_dao=ProjectMemberDAO,
            )
        except ProjectAdminForbidden as e:
            raise HTTPException(status_code=403, detail="无权管理该项目") from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/api/projects/{project_id}/unarchive")
    async def unarchive_project(
        project_id: str,
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await unarchive_project_service(
                project_id,
                user_id,
                project_dao=ProjectDAO,
                project_member_dao=ProjectMemberDAO,
            )
        except ProjectAdminForbidden as e:
            raise HTTPException(status_code=403, detail="无权管理该项目") from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.get("/api/projects/{project_id}/members")
    async def get_members(
        project_id: str,
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await list_members_service(
                project_id,
                user_id,
                project_member_dao=ProjectMemberDAO,
            )
        except ProjectAdminForbidden as e:
            raise HTTPException(status_code=403, detail="无权访问项目成员") from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/api/projects/{project_id}/members")
    async def add_member(
        project_id: str,
        data: MemberAdd,
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await add_member_service(
                project_id,
                user_id,
                target_user_id=data.user_id,
                role=data.role,
                responsibility=data.responsibility,
                user_dao=UserDAO,
                project_member_dao=ProjectMemberDAO,
            )
        except ProjectAdminForbidden as e:
            raise HTTPException(status_code=403, detail="无权管理该项目") from e
        except UserNotFound as e:
            raise HTTPException(status_code=404, detail="用户不存在") from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.put("/api/projects/{project_id}/members/{member_user_id}")
    async def update_member(
        project_id: str,
        member_user_id: str,
        data: MemberUpdate,
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await update_member_service(
                project_id,
                user_id,
                member_user_id,
                data.model_dump(exclude_unset=True),
                project_member_dao=ProjectMemberDAO,
            )
        except ProjectAdminForbidden as e:
            raise HTTPException(status_code=403, detail="无权管理该项目") from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.delete("/api/projects/{project_id}/members/{member_user_id}")
    async def remove_member(
        project_id: str,
        member_user_id: str,
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await remove_member_service(
                project_id,
                user_id,
                member_user_id,
                project_member_dao=ProjectMemberDAO,
            )
        except ProjectAdminForbidden as e:
            raise HTTPException(status_code=403, detail="无权管理该项目") from e
        except OwnerRemoveForbidden as e:
            raise HTTPException(status_code=400, detail="不能移除项目 owner") from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    return router
