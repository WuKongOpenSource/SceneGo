"""Legacy project compatibility routes."""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException

from schemas.project import ExportToVideoRequest, ProjectData
from services.project_read_service import (
    ProjectReadForbidden,
    ProjectReadNotFound,
    get_project_response,
    get_shot_images_response,
)
from services.project_save_service import ProjectSaveForbidden, save_project_response
from services.project_video_task_service import (
    ProjectVideoTaskForbidden,
    ProjectVideoTaskNotFound,
    clear_project_video_tasks_response,
    export_project_to_video_response,
)
from utils.json_helpers import parse_jsonb_field


def create_projects_router(
    *,
    require_auth_dependency: Any,
    project_dao: Any,
    project_member_dao: Any,
    user_dao: Any,
    file_dao: Any,
    version_dao: Any,
    logger: logging.Logger,
    storyboard_dao: Any = None,
    entity_file_dao: Any = None,
) -> APIRouter:
    router = APIRouter()
    ProjectDAO = project_dao
    ProjectMemberDAO = project_member_dao
    UserDAO = user_dao
    FileDAO = file_dao
    VersionDAO = version_dao
    StoryboardDAO = storyboard_dao
    EntityFileDAO = entity_file_dao

    @router.post("/api/projects/save")
    async def save_project(project: ProjectData, username: str = Depends(require_auth_dependency)):
        """Save legacy project payload and persist embedded base64 images."""
        try:
            return await save_project_response(
                project,
                username=username,
                project_dao=ProjectDAO,
                file_dao=FileDAO,
                version_dao=VersionDAO,
                logger=logger,
            )
        except ProjectSaveForbidden as exc:
            raise HTTPException(status_code=403, detail="无权保存该项目") from exc
        except Exception as exc:
            logger.error("Project save failed: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.get("/api/projects/list")
    async def list_projects(
        username: str = Depends(require_auth_dependency),
        limit: int = 100,
        org_id: Optional[str] = None,
    ):
        try:
            if org_id:
                from dao_organization import OrganizationMemberDAO

                if not await OrganizationMemberDAO.is_member(org_id, username):
                    raise HTTPException(status_code=403, detail="\u4e0d\u662f\u8be5\u7ec4\u7ec7\u6210\u5458")
                db_projects = await ProjectDAO.get_projects_for_org(
                    user_id=username,
                    org_id=org_id,
                    include_archived=False,
                )
            else:
                db_projects = await ProjectDAO.get_user_projects(
                    user_id=username,
                    include_archived=False,
                )

            projects = []
            for proj in db_projects[:limit]:
                project_data = parse_jsonb_field(proj.get("settings"))
                projects.append(
                    {
                        "project_id": proj.get("project_id"),
                        "name": proj.get("project_name"),
                        "stage": project_data.get("stage", 1),
                        "created_at": proj.get("created_at").isoformat() if proj.get("created_at") else None,
                        "updated_at": proj.get("updated_at").isoformat() if proj.get("updated_at") else None,
                        "owner_user_id": proj.get("user_id"),
                        "group_id": proj.get("group_id"),
                        "visibility": proj.get("visibility"),
                    }
                )

            return {"success": True, "projects": projects}
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("Project list failed: %s", exc, exc_info=True)
            return {"success": False, "projects": []}

    @router.get("/api/projects/{project_id}")
    @router.get("/api/projects/{project_id}/workspace")
    async def get_project(
        project_id: str,
        thumbnail_only: bool = True,
        username: str = Depends(require_auth_dependency),
    ):
        try:
            return await get_project_response(
                project_id,
                username=username,
                thumbnail_only=thumbnail_only,
                project_dao=ProjectDAO,
                project_member_dao=ProjectMemberDAO,
                user_dao=UserDAO,
                logger=logger,
            )
        except ProjectReadNotFound as exc:
            raise HTTPException(status_code=404, detail="\u9879\u76ee\u4e0d\u5b58\u5728") from exc
        except ProjectReadForbidden as exc:
            raise HTTPException(status_code=403, detail="\u65e0\u6743\u8bbf\u95ee\u6b64\u9879\u76ee") from exc
        except Exception as exc:
            logger.error("Project get failed: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.delete("/api/projects/{project_id}")
    async def delete_project(project_id: str, username: str = Depends(require_auth_dependency)):
        try:
            db_project = await ProjectDAO.get_project(project_id)
            if not db_project:
                raise HTTPException(status_code=404, detail="\u9879\u76ee\u4e0d\u5b58\u5728")
            if db_project.get("user_id") != username:
                raise HTTPException(status_code=403, detail="\u65e0\u6743\u5220\u9664\u6b64\u9879\u76ee")

            await ProjectDAO.delete_project(project_id, username)
            logger.info("Deleted project: %s", project_id)
            return {"success": True, "message": "\u9879\u76ee\u5220\u9664\u6210\u529f"}
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("Project delete failed: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.get("/api/projects/{project_id}/images/{shot_id}")
    async def get_shot_images(
        project_id: str,
        shot_id: str,
        username: str = Depends(require_auth_dependency),
    ):
        try:
            return await get_shot_images_response(
                project_id,
                shot_id,
                username=username,
                project_dao=ProjectDAO,
                project_member_dao=ProjectMemberDAO,
                user_dao=UserDAO,
                logger=logger,
            )
        except ProjectReadNotFound as exc:
            raise HTTPException(status_code=404, detail="\u9879\u76ee\u4e0d\u5b58\u5728") from exc
        except ProjectReadForbidden as exc:
            raise HTTPException(status_code=403, detail="\u65e0\u6743\u8bbf\u95ee\u6b64\u9879\u76ee") from exc
        except Exception as exc:
            logger.error("Project shot images failed: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.post("/api/projects/{project_id}/export-to-video")
    async def export_to_video(
        project_id: str,
        request: ExportToVideoRequest,
        username: str = Depends(require_auth_dependency),
    ):
        try:
            return await export_project_to_video_response(
                project_id,
                selected_items=request.selected_items,
                username=username,
                project_dao=ProjectDAO,
                version_dao=VersionDAO,
                file_dao=FileDAO,
                logger=logger,
                storyboard_dao=StoryboardDAO,
                entity_file_dao=EntityFileDAO,
            )
        except ProjectVideoTaskNotFound as exc:
            raise HTTPException(status_code=404, detail="\u9879\u76ee\u4e0d\u5b58\u5728") from exc
        except ProjectVideoTaskForbidden as exc:
            raise HTTPException(status_code=403, detail="\u65e0\u6743\u8bbf\u95ee\u6b64\u9879\u76ee") from exc
        except Exception as exc:
            logger.error("Project export-to-video failed: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.post("/api/projects/{project_id}/clear-video-tasks")
    async def clear_video_tasks(
        project_id: str,
        username: str = Depends(require_auth_dependency),
    ):
        try:
            return await clear_project_video_tasks_response(
                project_id,
                username=username,
                project_dao=ProjectDAO,
                logger=logger,
            )
        except ProjectVideoTaskNotFound as exc:
            raise HTTPException(status_code=404, detail="\u9879\u76ee\u4e0d\u5b58\u5728") from exc
        except ProjectVideoTaskForbidden as exc:
            raise HTTPException(status_code=403, detail="\u65e0\u6743\u8bbf\u95ee\u6b64\u9879\u76ee") from exc
        except Exception as exc:
            logger.error("Project clear video_tasks failed: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return router
