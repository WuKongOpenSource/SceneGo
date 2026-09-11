"""Version and text-content route handlers."""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from services.content_version_service import (
    ContentVersionCurrentDeleteForbidden,
    ContentVersionForbidden,
    ContentVersionNotFound,
    TextContentNotFound,
    create_text as create_text_service,
    create_version as create_version_service,
    delete_version as delete_version_service,
    get_text as get_text_service,
    get_version_detail as get_version_detail_service,
    restore_version as restore_version_service,
)


class VersionCreate(BaseModel):
    project_id: str
    version_name: Optional[str] = ""
    description: Optional[str] = ""


class TextContentCreate(BaseModel):
    version_id: str
    content_type: str
    title: Optional[str] = ""
    content: str


def create_content_versions_router(
    *,
    get_current_user_dependency: Any,
    project_dao: Any,
    version_dao: Any,
    file_dao: Any,
    text_content_dao: Any,
    activity_log_dao: Any,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    ProjectDAO = project_dao
    VersionDAO = version_dao
    FileDAO = file_dao
    TextContentDAO = text_content_dao
    ActivityLogDAO = activity_log_dao

    @router.post("/api/versions")
    async def create_version(
        version_data: VersionCreate,
        user_id: str = Depends(get_current_user),
    ):
        """Create a new version for a project."""
        try:
            return await create_version_service(
                project_id=version_data.project_id,
                user_id=user_id,
                version_name=version_data.version_name,
                description=version_data.description,
                project_dao=ProjectDAO,
                version_dao=VersionDAO,
                activity_log_dao=ActivityLogDAO,
            )
        except ContentVersionForbidden as exc:
            raise HTTPException(status_code=403, detail="无权访问项目") from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.get("/api/versions/{version_id}")
    async def get_version_detail(
        version_id: str,
        user_id: str = Depends(get_current_user),
    ):
        """Get version detail, including files and text contents."""
        try:
            return await get_version_detail_service(
                version_id=version_id,
                user_id=user_id,
                version_dao=VersionDAO,
                file_dao=FileDAO,
                text_content_dao=TextContentDAO,
            )
        except ContentVersionNotFound as exc:
            raise HTTPException(status_code=404, detail="版本不存在") from exc
        except ContentVersionForbidden as exc:
            raise HTTPException(status_code=403, detail="无权访问") from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.post("/api/versions/{version_id}/restore")
    async def restore_version(
        version_id: str,
        user_id: str = Depends(get_current_user),
    ):
        """Restore a version as current."""
        try:
            return await restore_version_service(
                version_id=version_id,
                user_id=user_id,
                version_dao=VersionDAO,
                activity_log_dao=ActivityLogDAO,
            )
        except ContentVersionForbidden as exc:
            raise HTTPException(status_code=403, detail="无权访问项目") from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.delete("/api/versions/{version_id}")
    async def delete_version(
        version_id: str,
        user_id: str = Depends(get_current_user),
    ):
        """Delete a non-current version."""
        try:
            return await delete_version_service(
                version_id=version_id,
                user_id=user_id,
                version_dao=VersionDAO,
                activity_log_dao=ActivityLogDAO,
            )
        except ContentVersionForbidden as exc:
            raise HTTPException(status_code=403, detail="无权访问项目") from exc
        except ContentVersionCurrentDeleteForbidden as exc:
            raise HTTPException(status_code=400, detail="无法删除当前版本") from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.post("/api/texts")
    async def create_text(
        text_data: TextContentCreate,
        user_id: str = Depends(get_current_user),
    ):
        """Create text content in a version."""
        try:
            return await create_text_service(
                version_id=text_data.version_id,
                content_type=text_data.content_type,
                title=text_data.title,
                content=text_data.content,
                user_id=user_id,
                version_dao=VersionDAO,
                text_content_dao=TextContentDAO,
                activity_log_dao=ActivityLogDAO,
            )
        except ContentVersionForbidden as exc:
            raise HTTPException(status_code=403, detail="无权访问项目") from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.get("/api/texts/{content_id}")
    async def get_text(
        content_id: str,
        user_id: str = Depends(get_current_user),
    ):
        """Get text content detail."""
        try:
            return await get_text_service(
                content_id=content_id,
                user_id=user_id,
                text_content_dao=TextContentDAO,
            )
        except TextContentNotFound as exc:
            raise HTTPException(status_code=404, detail="文本不存在") from exc
        except ContentVersionForbidden as exc:
            raise HTTPException(status_code=403, detail="无权访问") from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return router
