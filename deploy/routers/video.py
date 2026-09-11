"""Video processing routes."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException

from dao_content import FileDAO, ProjectDAO, VersionDAO
from schemas.video import CropVideoRequest
from services.video_crop_service import (
    FfmpegCropFailed,
    FfmpegUnavailable,
    VideoSourceAccessDenied,
    VideoSourceNotFound,
    crop_video_file,
    require_video_crop_source_access,
)

logger = logging.getLogger(__name__)


def create_video_router(
    *,
    require_auth_dependency,
    get_video_cluster_manager: Callable[[], object],
    get_cluster_manager: Callable[[], object],
) -> APIRouter:
    router = APIRouter()

    @router.post("/api/video/crop")
    async def crop_video(
        request: CropVideoRequest,
        username: str = Depends(require_auth_dependency),
    ):
        """Crop a video segment from DB, storage, or ComfyUI sources."""
        try:
            authorized_file_id = await require_video_crop_source_access(
                request.video_filename,
                username,
                file_dao=FileDAO,
            )
            return await crop_video_file(
                video_filename=authorized_file_id,
                start_time=request.start_time,
                end_time=request.end_time,
                username=username,
                file_dao=FileDAO,
                project_dao=ProjectDAO,
                version_dao=VersionDAO,
                get_video_cluster_manager=get_video_cluster_manager,
                get_cluster_manager=get_cluster_manager,
                logger=logger,
                deploy_root=Path(__file__).resolve().parents[1],
            )
        except VideoSourceAccessDenied as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except VideoSourceNotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except FfmpegUnavailable as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except FfmpegCropFailed as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("视频裁剪失败: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail=f"视频裁剪失败: {str(exc)}") from exc

    return router
