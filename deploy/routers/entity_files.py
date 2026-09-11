"""Unified entity file routes for storyboard items, assets, and video segments."""

import logging
from typing import Any, Callable, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from core.database_config import StorageConfig
from services.entity_file_service import (
    EntityFileBatchTooLarge,
    EntityFileDeleteRiskNotAcknowledged,
    EntityFileMigrationFailed,
    EntityFileNotFound,
    EntityFilePhysicalDeleteFailed,
    EntityFileTransformInvalid,
    get_deleted_user_file as get_deleted_user_file_service,
    hard_delete_entity_file as hard_delete_entity_file_service,
    hard_delete_entity_files_batch as hard_delete_entity_files_batch_service,
    link_entity_file as link_entity_file_service,
    list_entity_files,
    list_deleted_user_files,
    list_user_files,
    restore_entity_file as restore_entity_file_service,
    run_entity_file_migration as run_entity_file_migration_service,
    select_entity_file as select_entity_file_service,
    soft_delete_entity_file,
    upload_entity_file as upload_entity_file_service,
)
from services.entity_access_service import (
    EntityAccessDenied,
    require_entity_access,
    require_file_access,
)
from services.project_access_service import resolve_user_id
from services.file_route_service import ThumbnailFileNotFound, build_thumbnail_file
from services.upload_stream_service import UploadPayloadTooLarge, read_upload_limited


def create_entity_files_router(
    *,
    get_current_user_dependency: Any,
    file_dao: Any,
    entity_file_dao: Any,
    episode_dao: Any,
    storyboard_dao: Any,
    asset_dao: Any,
    video_segment_dao: Any,
    user_dao: Any,
    save_generated_file_to_db_provider: Callable[[], Callable[..., Any]],
    logger: logging.Logger,
    get_media_user_dependency: Any = None,
    node_output_deleter: Optional[Callable[..., Any]] = None,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    get_media_user = get_media_user_dependency or get_current_user_dependency
    FileDAO = file_dao
    EntityFileDAO = entity_file_dao
    scope_dependencies = {
        "episode_dao": episode_dao,
        "storyboard_dao": storyboard_dao,
        "asset_dao": asset_dao,
        "video_segment_dao": video_segment_dao,
    }

    async def canonical_user_id(identity: str) -> str:
        resolved = await resolve_user_id(identity, user_dao=user_dao)
        if not resolved:
            raise HTTPException(403, "User not found or access denied")
        return resolved

    async def guard_entity(entity_type: str, entity_id: str, identity: str, role: str):
        try:
            return await require_entity_access(
                entity_type,
                entity_id,
                identity,
                role,
                **scope_dependencies,
            )
        except EntityAccessDenied as exc:
            raise HTTPException(404, "Entity not found or access denied") from exc

    async def guard_file(file_id: str, identity: str, role: str):
        try:
            return await require_file_access(
                file_id,
                identity,
                role,
                file_dao=FileDAO,
                **scope_dependencies,
            )
        except EntityAccessDenied as exc:
            raise HTTPException(404, "File not found or access denied") from exc

    async def save_generated_file_to_db(*args, **kwargs):
        return await save_generated_file_to_db_provider()(*args, **kwargs)

    class EntityFileLinkRequest(BaseModel):
        file_id: str
        entity_type: str
        entity_id: str
        file_role: str
        is_selected: bool = False

    class EntityFileSelectRequest(BaseModel):
        entity_type: str
        entity_id: str
        file_role: str

    class HardDeleteBatchRequest(BaseModel):
        file_ids: List[str]
        risk_ack: bool = False

    async def delete_node_output(*, agent_id: str, output_id: str) -> dict:
        if node_output_deleter is None:
            raise RuntimeError("Remote local-node deletion is unavailable in this runtime")
        return await node_output_deleter(agent_id=agent_id, output_id=output_id)

    @router.get("/api/user-files")
    async def get_user_files(
        file_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        user_id: str = Depends(get_current_user),
    ):
        user_id = await canonical_user_id(user_id)
        return await list_user_files(
            user_id=user_id,
            file_type=file_type,
            limit=limit,
            offset=offset,
            file_dao=FileDAO,
            entity_file_dao=EntityFileDAO,
        )

    @router.get("/api/user-files/recycle-bin")
    async def get_deleted_user_files(
        file_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        user_id: str = Depends(get_current_user),
    ):
        user_id = await canonical_user_id(user_id)
        return await list_deleted_user_files(
            user_id=user_id,
            file_type=file_type,
            limit=limit,
            offset=offset,
            entity_file_dao=EntityFileDAO,
        )

    @router.get("/api/entity-files/{file_id}/recycle-thumbnail")
    async def get_recycle_thumbnail(
        file_id: str,
        user_id: str = Depends(get_media_user),
    ):
        canonical_id = await canonical_user_id(user_id)
        try:
            row = await get_deleted_user_file_service(
                file_id=file_id,
                user_id=canonical_id,
                entity_file_dao=EntityFileDAO,
            )
            if str(row.get("file_type") or "").lower() != "image":
                raise ThumbnailFileNotFound("not_an_image")

            class DeletedFileThumbnailDAO:
                @staticmethod
                async def get_file(requested_file_id: str):
                    return row if requested_file_id == file_id else None

            thumbnail = await build_thumbnail_file(
                url=f"/api/files/{file_id}/download",
                width=640,
                height=360,
                file_dao=DeletedFileThumbnailDAO,
                logger=logger,
            )
            return FileResponse(
                thumbnail.path,
                media_type=thumbnail.media_type,
                headers={**thumbnail.headers, "Cache-Control": "private, max-age=300"},
            )
        except (EntityFileNotFound, ThumbnailFileNotFound) as exc:
            raise HTTPException(404, "回收站缩略图不存在") from exc

    @router.get("/api/entity-files")
    async def get_entity_files(
        entity_type: str,
        entity_id: str,
        file_role: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        user_id: str = Depends(get_current_user),
    ):
        await guard_entity(entity_type, entity_id, user_id, "readonly")
        return await list_entity_files(
            entity_type=entity_type,
            entity_id=entity_id,
            file_role=file_role,
            limit=limit,
            offset=offset,
            entity_file_dao=EntityFileDAO,
        )

    @router.post("/api/entity-files/link")
    async def link_entity_file(
        req: EntityFileLinkRequest,
        user_id: str = Depends(get_current_user),
    ):
        target_scope = await guard_entity(req.entity_type, req.entity_id, user_id, "member")
        file_row = await guard_file(req.file_id, user_id, "member")
        source_project_id = str(file_row.get("_access_project_id") or "")
        target_project_id = str(target_scope.get("project_id") or "")
        if source_project_id and source_project_id != target_project_id:
            raise HTTPException(409, "File belongs to another project; copy it before linking")
        try:
            return await link_entity_file_service(
                file_id=req.file_id,
                entity_type=req.entity_type,
                entity_id=req.entity_id,
                file_role=req.file_role,
                is_selected=req.is_selected,
                entity_file_dao=EntityFileDAO,
            )
        except EntityFileNotFound as exc:
            raise HTTPException(404, "文件不存在或已删除") from exc

    @router.put("/api/entity-files/{file_id}/select")
    async def select_entity_file(
        file_id: str,
        req: EntityFileSelectRequest,
        user_id: str = Depends(get_current_user),
    ):
        await guard_entity(req.entity_type, req.entity_id, user_id, "member")
        await guard_file(file_id, user_id, "member")
        try:
            return await select_entity_file_service(
                file_id=file_id,
                entity_type=req.entity_type,
                entity_id=req.entity_id,
                file_role=req.file_role,
                entity_file_dao=EntityFileDAO,
                logger=logger,
                selected_by=user_id,
            )
        except EntityFileNotFound as exc:
            raise HTTPException(404, "文件不存在或不属于指定实体") from exc

    @router.post("/api/entity-files/upload")
    async def upload_entity_file(
        file: UploadFile = File(...),
        entity_type: str = Form(None),
        entity_id: str = Form(None),
        file_role: str = Form(None),
        episode_id: str = Form(None),
        source: str = Form("upload"),
        transform: str = Form(None),
        user_id: str = Depends(get_current_user),
    ):
        canonical_id = await canonical_user_id(user_id)
        project_id = None
        if bool(entity_type) != bool(entity_id):
            raise HTTPException(400, "entity_type and entity_id must be provided together")
        if entity_type and entity_id:
            scope = await guard_entity(entity_type, entity_id, user_id, "member")
            project_id = scope.get("project_id")
            scope_episode_id = scope.get("episode_id")
            if episode_id and scope_episode_id and episode_id != scope_episode_id:
                raise HTTPException(409, "episode_id does not match the target entity")
            episode_id = scope_episode_id or episode_id
        elif episode_id:
            scope = await guard_entity("episode", episode_id, user_id, "member")
            project_id = scope.get("project_id")
        try:
            content = await read_upload_limited(file, max_bytes=StorageConfig.MAX_UPLOAD_SIZE)
        except UploadPayloadTooLarge as exc:
            raise HTTPException(413, "文件太大") from exc
        try:
            return await upload_entity_file_service(
                content=content,
                filename=file.filename,
                content_type=file.content_type,
                entity_type=entity_type,
                entity_id=entity_id,
                file_role=file_role,
                episode_id=episode_id,
                user_id=canonical_id,
                save_generated_file_to_db=save_generated_file_to_db,
                project_id=project_id,
                logger=logger,
                source=source,
                transform=transform,
            )
        except EntityFileTransformInvalid as exc:
            raise HTTPException(400, "不支持的本地图片处理方式") from exc

    @router.delete("/api/entity-files/{file_id}")
    async def delete_entity_file(
        file_id: str,
        user_id: str = Depends(get_current_user),
    ):
        await guard_file(file_id, user_id, "member")
        try:
            return await soft_delete_entity_file(file_id=file_id, entity_file_dao=EntityFileDAO)
        except EntityFileNotFound as exc:
            raise HTTPException(404, "文件不存在或已删除") from exc

    @router.post("/api/entity-files/{file_id}/restore")
    async def restore_entity_file(
        file_id: str,
        user_id: str = Depends(get_current_user),
    ):
        canonical_id = await canonical_user_id(user_id)
        try:
            return await restore_entity_file_service(
                file_id=file_id,
                user_id=canonical_id,
                entity_file_dao=EntityFileDAO,
            )
        except EntityFileNotFound as exc:
            raise HTTPException(404, "回收站中未找到该文件") from exc

    @router.delete("/api/entity-files/{file_id}/hard")
    async def hard_delete_entity_file(
        file_id: str,
        risk_ack: bool = False,
        user_id: str = Depends(get_current_user),
    ):
        canonical_id = await canonical_user_id(user_id)
        try:
            return await hard_delete_entity_file_service(
                file_id=file_id,
                user_id=canonical_id,
                risk_ack=risk_ack,
                entity_file_dao=EntityFileDAO,
                node_output_deleter=delete_node_output,
            )
        except EntityFileDeleteRiskNotAcknowledged as exc:
            raise HTTPException(400, "请先确认永久删除风险") from exc
        except EntityFilePhysicalDeleteFailed as exc:
            raise HTTPException(503, f"服务器文件删除失败，记录已保留：{exc}") from exc
        except EntityFileNotFound as exc:
            raise HTTPException(404, "回收站中未找到本人文件") from exc

    @router.post("/api/entity-files/hard-delete-batch")
    async def hard_delete_entity_files_batch(
        request: HardDeleteBatchRequest,
        user_id: str = Depends(get_current_user),
    ):
        if len(request.file_ids) > 200:
            raise HTTPException(400, "Batch hard delete accepts at most 200 files")
        canonical_id = await canonical_user_id(user_id)
        try:
            return await hard_delete_entity_files_batch_service(
                file_ids=request.file_ids,
                user_id=canonical_id,
                risk_ack=request.risk_ack,
                entity_file_dao=EntityFileDAO,
                node_output_deleter=delete_node_output,
            )
        except EntityFileDeleteRiskNotAcknowledged as exc:
            raise HTTPException(400, "请先确认永久删除风险") from exc
        except EntityFileBatchTooLarge as exc:
            raise HTTPException(400, "单次最多删除 200 个文件") from exc

    @router.post("/api/entity-files/migrate")
    async def run_entity_file_migration(user_id: str = Depends(get_current_user)):
        if not await user_dao.is_admin_user(user_id):
            raise HTTPException(403, "Administrator access required")
        try:
            return await run_entity_file_migration_service()
        except EntityFileMigrationFailed as exc:
            raise HTTPException(500, f"迁移失败: {str(exc)}") from exc
        except Exception as exc:
            raise HTTPException(500, f"迁移失败: {str(exc)}")

    return router
