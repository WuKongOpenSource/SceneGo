"""Generic file upload routes."""
from __future__ import annotations

import logging
from typing import Callable, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from core.runtime_config import SystemConfig
from dao_content import FileDAO, ProjectDAO, VersionDAO
from services.file_route_service import (
    ThumbnailFileNotFound,
    ThumbnailImageUnsafe,
    UnsupportedUploadFileType,
    UploadFileRecordError,
    UploadFileTooLarge,
    UploadVersionAccessDenied,
    build_thumbnail_file,
    cleanup_thumbnail_cache as cleanup_thumbnail_cache_service,
    require_thumbnail_source_access,
    upload_generic_file,
)
from services.upload_stream_service import UploadPayloadTooLarge, read_upload_limited

logger = logging.getLogger(__name__)


def cleanup_thumbnail_cache(**kwargs):
    return cleanup_thumbnail_cache_service(logger=logger, **kwargs)


def create_files_router(
    *,
    require_auth_dependency,
    security_dependency,
    verify_token: Callable[[str], Optional[str]],
) -> APIRouter:
    router = APIRouter()

    @router.get("/api/thumbnail")
    async def get_thumbnail(
        url: str,
        width: int = 300,
        height: int = 200,
        username: str = Depends(require_auth_dependency),
    ):
        """Generate a cached thumbnail for an image-like file URL."""
        try:
            await require_thumbnail_source_access(url, username, file_dao=FileDAO)
            thumbnail = await build_thumbnail_file(
                url=url,
                width=width,
                height=height,
                file_dao=FileDAO,
                logger=logger,
            )
            return FileResponse(
                thumbnail.path,
                media_type=thumbnail.media_type,
                headers=thumbnail.headers,
            )
        except ThumbnailFileNotFound as exc:
            raise HTTPException(status_code=404, detail="文件不存在") from exc
        except ThumbnailImageUnsafe as exc:
            raise HTTPException(status_code=422, detail="图片尺寸超过服务器安全限制") from exc
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("生成缩略图失败: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail=f"生成缩略图失败: {str(exc)}") from exc

    @router.post("/api/upload")
    async def upload_file(
        file: UploadFile = File(...),
        version_id: Optional[str] = Form(None),
        username: str = Depends(require_auth_dependency),
    ):
        """Upload an image, video, or audio file and register it in the database."""
        try:
            return await upload_generic_file(
                filename=file.filename or "upload",
                content_type=file.content_type or "",
                content=await read_upload_limited(file, max_bytes=SystemConfig.MAX_UPLOAD_SIZE),
                version_id=version_id,
                username=username,
                max_upload_size=SystemConfig.MAX_UPLOAD_SIZE,
                file_dao=FileDAO,
                project_dao=ProjectDAO,
                version_dao=VersionDAO,
                logger=logger,
            )
        except (UploadFileTooLarge, UploadPayloadTooLarge) as exc:
            raise HTTPException(status_code=413, detail="文件太大") from exc
        except UnsupportedUploadFileType as exc:
            raise HTTPException(status_code=400, detail=f"不支持的文件类型: {exc.content_type}") from exc
        except UploadVersionAccessDenied as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except UploadFileRecordError as exc:
            raise HTTPException(status_code=500, detail=f"保存文件记录失败: {str(exc)}") from exc
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("上传文件失败: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail=f"上传失败: {str(exc)}") from exc

    return router
