"""Source-edition video utilities that never contact a local execution node."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from dao_content import FileDAO
from schemas.video import CropVideoRequest
from services.public_video_crop_service import (
    PublicVideoCropAccessDenied,
    PublicVideoCropFailed,
    PublicVideoCropInvalidRequest,
    PublicVideoCropUnavailable,
    crop_public_video_file,
)


def create_public_video_router(*, require_auth_dependency, logger: logging.Logger) -> APIRouter:
    router = APIRouter()

    @router.post("/api/video/crop")
    async def crop_video(
        request: CropVideoRequest,
        identity: str = Depends(require_auth_dependency),
    ):
        try:
            return await crop_public_video_file(
                video_ref=request.video_filename,
                start_time=request.start_time,
                end_time=request.end_time,
                identity=identity,
                file_dao=FileDAO,
                deploy_root=Path(__file__).resolve().parents[1],
                logger=logger,
            )
        except PublicVideoCropAccessDenied as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except PublicVideoCropInvalidRequest as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except PublicVideoCropUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except PublicVideoCropFailed as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return router
