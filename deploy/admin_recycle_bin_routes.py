"""Admin recycle-bin routes."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from db_manager import get_db_manager
from services.admin_recycle_bin_service import (
    RecycleBinNotFound,
    RecycleBinRiskNotAcknowledged,
    RecycleBinUnsafePath,
    get_recycle_bin_download_info,
    list_recycle_bin_files,
    purge_recycle_bin_file,
    purge_recycle_bin_files,
    restore_recycle_bin_file,
)


router = APIRouter()


def _require_db() -> None:
    if not get_db_manager():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database unavailable",
        )


class PurgeFileBody(BaseModel):
    risk_ack: bool = False
    delete_db_record: bool = True


class PurgeFilesBody(PurgeFileBody):
    file_ids: List[str]


@router.get("/trash/files")
async def admin_list_trash_files(
    user_id: Optional[str] = None,
    project_id: Optional[str] = None,
    file_type: Optional[str] = None,
    keyword: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
):
    _require_db()
    return await list_recycle_bin_files(
        user_id=user_id,
        project_id=project_id,
        file_type=file_type,
        keyword=keyword,
        limit=limit,
        offset=offset,
    )


@router.post("/trash/files/{file_id}/restore")
async def admin_restore_trash_file(file_id: str):
    _require_db()
    try:
        return await restore_recycle_bin_file(file_id)
    except RecycleBinNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/trash/files/{file_id}/download")
async def admin_download_trash_file(file_id: str):
    _require_db()
    try:
        download = await get_recycle_bin_download_info(file_id)
        return FileResponse(
            path=download["path"],
            filename=download["filename"],
            media_type=download["media_type"],
        )
    except RecycleBinUnsafePath as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RecycleBinNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/trash/files/{file_id}/purge")
async def admin_purge_trash_file(file_id: str, body: PurgeFileBody, request: Request):
    _require_db()
    try:
        result = await purge_recycle_bin_file(
            file_id,
            risk_ack=body.risk_ack,
            delete_db_record=body.delete_db_record,
        )
        try:
            import admin_audit_service

            await admin_audit_service.record(
                request,
                admin_user_id=admin_audit_service.caller_admin_id(request),
                action="trash_file_purge",
                target_type="file",
                target_id=file_id,
                after=result,
                notes="Permanent disk purge from admin recycle bin",
            )
        except Exception:
            pass
        return result
    except RecycleBinRiskNotAcknowledged as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RecycleBinUnsafePath as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RecycleBinNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/trash/files/purge")
async def admin_purge_trash_files(body: PurgeFilesBody, request: Request):
    _require_db()
    try:
        result = await purge_recycle_bin_files(
            body.file_ids,
            risk_ack=body.risk_ack,
            delete_db_record=body.delete_db_record,
        )
        try:
            import admin_audit_service

            await admin_audit_service.record(
                request,
                admin_user_id=admin_audit_service.caller_admin_id(request),
                action="trash_file_purge_batch",
                target_type="file",
                target_id="batch",
                after={
                    "requested": result.get("requested"),
                    "purged": result.get("purged"),
                    "freed_bytes": result.get("freed_bytes"),
                    "error_count": len(result.get("errors") or []),
                },
                notes="Permanent batch disk purge from admin recycle bin",
            )
        except Exception:
            pass
        return result
    except RecycleBinRiskNotAcknowledged as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
