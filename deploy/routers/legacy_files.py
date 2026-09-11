"""Legacy file upload/download routes.

These routes back older project/version file flows. Newer entity-bound uploads
live in routers/entity_files.py, but this API surface is still public and must
keep its existing path contract.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from core.database_config import StorageConfig
from services.legacy_file_service import (
    LegacyFileForbidden,
    LegacyFileNotFound,
    LegacyStorageQuotaExceeded,
    delete_legacy_file,
    get_legacy_download_info,
    ranged_file_reader,
    upload_legacy_file,
)
from services.upload_stream_service import UploadPayloadTooLarge, read_upload_limited


def create_legacy_files_router(
    *,
    get_current_user_dependency: Any,
    user_dao: Any,
    version_dao: Any,
    file_dao: Any,
    activity_log_dao: Any,
    file_optimization_service: Any,
    file_deduplication_service: Any,
    jwt_auth_module: Any,
    logger: Any,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency

    def deploy_root() -> Path:
        return Path(__file__).resolve().parents[1]

    @router.post("/api/files/upload")
    async def upload_file(
        version_id: str = Form(...),
        file: UploadFile = File(...),
        user_id: str = Depends(get_current_user),
    ):
        """Upload a version-scoped legacy file."""
        try:
            return await upload_legacy_file(
                version_id=version_id,
                filename=file.filename or "",
                content_type=file.content_type,
                content=await read_upload_limited(file, max_bytes=StorageConfig.MAX_UPLOAD_SIZE),
                user_id=user_id,
                user_dao=user_dao,
                version_dao=version_dao,
                file_dao=file_dao,
                activity_log_dao=activity_log_dao,
                file_optimization_service=file_optimization_service,
                file_deduplication_service=file_deduplication_service,
            )
        except LegacyFileForbidden as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except LegacyStorageQuotaExceeded as exc:
            raise HTTPException(status_code=507, detail=str(exc)) from exc
        except UploadPayloadTooLarge as exc:
            raise HTTPException(status_code=413, detail="文件太大") from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.get("/api/files/{file_id}/download")
    async def download_file(
        file_id: str,
        request: Request,
        identity: str = Depends(get_current_user),
    ):
        """Download a legacy file with range support for audio/video."""
        try:
            download = await get_legacy_download_info(
                file_id=file_id,
                range_header=request.headers.get("range"),
                identity=identity,
                deploy_root=deploy_root(),
                file_dao=file_dao,
                logger=logger,
            )

            if download.is_range:
                assert download.range_start is not None
                assert download.range_end is not None
                assert download.content_length is not None
                return StreamingResponse(
                    ranged_file_reader(
                        download.file_path,
                        start=download.range_start,
                        content_length=download.content_length,
                    ),
                    status_code=206,
                    media_type=download.mime_type,
                    headers={
                        **download.extra_headers,
                        "Content-Range": f"bytes {download.range_start}-{download.range_end}/{download.file_size}",
                        "Accept-Ranges": "bytes",
                        "Content-Length": str(download.content_length),
                        "Content-Disposition": download.content_disposition,
                        "X-Content-Type-Options": "nosniff",
                    },
                )

            return StreamingResponse(
                file_optimization_service.file_chunked_reader(download.file_path),
                media_type=download.mime_type,
                headers={
                    **download.extra_headers,
                    "Content-Disposition": download.content_disposition,
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(download.file_size),
                    "X-Content-Type-Options": "nosniff",
                },
            )
        except LegacyFileNotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("下载文件失败: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.delete("/api/files/{file_id}")
    async def delete_file(
        file_id: str,
        user_id: str = Depends(get_current_user),
    ):
        """Delete a legacy file record."""
        try:
            return await delete_legacy_file(
                file_id=file_id,
                user_id=user_id,
                file_dao=file_dao,
                activity_log_dao=activity_log_dao,
            )
        except LegacyFileForbidden as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return router
