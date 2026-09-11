"""Storyboard item, script export, and storyboard audio mix routes."""

import logging
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dao.creative.content_workflow import ContentWorkflowDAO

from services.project_access_service import require_project_access
from services.storyboard_service import (
    EpisodeNotFound,
    StoryboardCreateFailed,
    StoryboardItemNotFound,
    StoryboardReorderFailed,
    StoryboardScriptNotFound,
    UnsupportedStoryboardFields,
    batch_create_storyboard_items as batch_create_storyboard_items_service,
    create_storyboard_item as create_storyboard_item_service,
    delete_all_storyboard_items as delete_all_storyboard_items_service,
    delete_storyboard_item as delete_storyboard_item_service,
    export_script as export_script_service,
    extract_to_assets as extract_to_assets_service,
    get_storyboard_items as get_storyboard_items_service,
    mix_storyboard_audio as mix_storyboard_audio_service,
    reorder_storyboard_items as reorder_storyboard_items_service,
    require_storyboard_episode_access,
    require_storyboard_item_access,
    require_storyboard_script,
    sync_storyboard_items as sync_storyboard_items_service,
    update_storyboard_item as update_storyboard_item_service,
)


class ExportScriptRequest(BaseModel):
    project_id: str
    original_content: str = ""
    script_content: str = ""
    storyboard_items: List[dict] = []
    characters: List[dict] = []
    scenes: List[dict] = []
    props: List[dict] = []
    script_id: Optional[str] = None
    preserve_existing_storyboards: bool = False


class StoryboardItemCreate(BaseModel):
    sort_order: int = 0
    scene_heading: Optional[str] = ""
    dialogue: Optional[str] = ""
    action_text: Optional[str] = ""
    camera_movement: Optional[str] = ""
    image_prompt: Optional[str] = ""
    video_prompt: Optional[str] = ""
    script_id: Optional[str] = None
    configured_references: Optional[list] = None
    reference_config_initialized: bool = False


class StoryboardItemUpdate(BaseModel):
    sort_order: Optional[int] = None
    scene_heading: Optional[str] = None
    dialogue: Optional[str] = None
    action_text: Optional[str] = None
    camera_movement: Optional[str] = None
    image_prompt: Optional[str] = None
    video_prompt: Optional[str] = None
    generated_image_url: Optional[str] = None
    status: Optional[str] = None
    dialogue_audio_url: Optional[str] = None
    narration_audio_url: Optional[str] = None
    sfx_audio_url: Optional[str] = None
    audio_duration_ms: Optional[int] = None
    planned_duration_ms: Optional[int] = None
    bound_assets: Optional[list] = None
    configured_references: Optional[list] = None
    reference_config_initialized: Optional[bool] = None


class ReorderRequest(BaseModel):
    item_ids: List[str]


class MixAudioRequest(BaseModel):
    item_id: str
    dialogue_url: Optional[str] = None
    narration_url: Optional[str] = None
    sfx_url: Optional[str] = None
    dialogue_gain_db: float = 0.0
    narration_gain_db: float = -3.0
    sfx_gain_db: float = -8.0


class MixAudioResponse(BaseModel):
    success: bool
    mixed_audio_url: str
    cached: bool
    duration_ms: int


class BatchStoryboardCreate(BaseModel):
    items: list
    script_id: Optional[str] = None


class SyncStoryboardItemsRequest(BaseModel):
    items: list
    script_id: Optional[str] = None


class ExtractToAssetsRequest(BaseModel):
    characters: list = []
    scenes: list = []
    props: list = []
    script_id: Optional[str] = None


def create_storyboard_router(
    *,
    get_current_user_dependency: Any,
    storyboard_dao: Any,
    episode_script_dao: Any,
    asset_dao: Any,
    episode_dao: Any,
    logger: logging.Logger,
    project_access_checker: Any = require_project_access,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    StoryboardDAO = storyboard_dao
    EpisodeScriptDAO = episode_script_dao
    AssetDAO = asset_dao
    EpisodeDAO = episode_dao

    async def require_episode(episode_id: str, identity: str, role: str) -> str:
        try:
            return await require_storyboard_episode_access(
                episode_id,
                identity,
                role,
                episode_dao=EpisodeDAO,
                project_access_checker=project_access_checker,
            )
        except EpisodeNotFound as exc:
            raise HTTPException(status_code=404, detail="集不存在") from exc

    async def require_item(item_id: str, identity: str, role: str) -> dict:
        try:
            return await require_storyboard_item_access(
                item_id,
                identity,
                role,
                storyboard_dao=StoryboardDAO,
                episode_dao=EpisodeDAO,
                project_access_checker=project_access_checker,
            )
        except StoryboardItemNotFound as exc:
            raise HTTPException(status_code=404, detail="分镜不存在")
        except EpisodeNotFound as exc:
            raise HTTPException(status_code=404, detail="集不存在") from exc

    async def require_script(episode_id: str, script_id: Optional[str]) -> None:
        try:
            await require_storyboard_script(
                episode_id,
                script_id,
                episode_script_dao=EpisodeScriptDAO,
            )
        except StoryboardScriptNotFound as exc:
            raise HTTPException(status_code=404, detail="Script not found for this episode")

    @router.get("/api/episodes/{episode_id}/storyboard-items")
    async def get_storyboard_items(
        episode_id: str,
        script_id: Optional[str] = None,
        limit: Optional[int] = None,
        offset: int = 0,
        include_total: bool = False,
        fields: Optional[str] = None,
        user_id: str = Depends(get_current_user),
    ):
        await require_episode(episode_id, user_id, 'readonly')
        selected_fields = (fields or "").strip().lower() or None
        if selected_fields and selected_fields not in {"audio", "video", "audio_stage", "materials"}:
            raise HTTPException(status_code=400, detail="unsupported storyboard fields")
        try:
            return await get_storyboard_items_service(
                episode_id,
                script_id=script_id,
                limit=limit,
                offset=offset,
                include_total=include_total,
                fields=selected_fields,
                storyboard_dao=StoryboardDAO,
                episode_script_dao=EpisodeScriptDAO,
                logger=logger,
            )
        except UnsupportedStoryboardFields as exc:
            raise HTTPException(status_code=400, detail="unsupported storyboard fields") from exc

    @router.post("/api/episodes/{episode_id}/storyboard-items")
    async def create_storyboard_item(
        episode_id: str,
        data: StoryboardItemCreate,
        user_id: str = Depends(get_current_user),
    ):
        await require_episode(episode_id, user_id, 'member')
        try:
            return await create_storyboard_item_service(
                episode_id,
                sort_order=data.sort_order,
                scene_heading=data.scene_heading,
                dialogue=data.dialogue,
                action_text=data.action_text,
                camera_movement=data.camera_movement,
                image_prompt=data.image_prompt,
                video_prompt=data.video_prompt,
                configured_references=data.configured_references,
                reference_config_initialized=data.reference_config_initialized,
                script_id=data.script_id,
                storyboard_dao=StoryboardDAO,
                episode_script_dao=EpisodeScriptDAO,
                logger=logger,
            )
        except StoryboardCreateFailed as exc:
            raise HTTPException(status_code=500, detail="创建分镜失败") from exc

    @router.put("/api/storyboard-items/{item_id}")
    async def update_storyboard_item(
        item_id: str,
        data: StoryboardItemUpdate,
        user_id: str = Depends(get_current_user),
    ):
        await require_item(item_id, user_id, 'member')
        try:
            return await update_storyboard_item_service(
                item_id,
                data.model_dump(exclude_none=True),
                storyboard_dao=StoryboardDAO,
                content_workflow_dao=ContentWorkflowDAO,
                updated_by=user_id,
            )
        except StoryboardItemNotFound as exc:
            raise HTTPException(status_code=404, detail="分镜不存在") from exc

    @router.delete("/api/storyboard-items/{item_id}")
    async def delete_storyboard_item(item_id: str, user_id: str = Depends(get_current_user)):
        await require_item(item_id, user_id, 'member')
        try:
            return await delete_storyboard_item_service(item_id, storyboard_dao=StoryboardDAO)
        except StoryboardItemNotFound as exc:
            raise HTTPException(status_code=404, detail="分镜不存在") from exc

    @router.delete("/api/episodes/{episode_id}/storyboard-items/all")
    async def delete_all_storyboard_items(
        episode_id: str,
        script_id: Optional[str] = None,
        user_id: str = Depends(get_current_user),
    ):
        await require_episode(episode_id, user_id, 'member')
        return await delete_all_storyboard_items_service(
            episode_id,
            script_id=script_id,
            storyboard_dao=StoryboardDAO,
        )

    @router.post("/api/episodes/{episode_id}/export-script")
    async def export_script(
        episode_id: str,
        req: ExportScriptRequest,
        user_id: str = Depends(get_current_user),
    ):
        actual_project_id = await require_episode(episode_id, user_id, 'member')
        if req.project_id != actual_project_id:
            raise HTTPException(status_code=400, detail="project_id 与集所属项目不一致")
        try:
            return await export_script_service(
                episode_id,
                project_id=req.project_id,
                original_content=req.original_content,
                script_content=req.script_content,
                storyboard_items=req.storyboard_items,
                characters=req.characters,
                scenes=req.scenes,
                props=req.props,
                script_id=req.script_id,
                preserve_existing_storyboards=req.preserve_existing_storyboards,
                user_id=user_id,
                storyboard_dao=StoryboardDAO,
                episode_script_dao=EpisodeScriptDAO,
                asset_dao=AssetDAO,
            )
        except RuntimeError as exc:
            raise HTTPException(500, str(exc)) from exc

    @router.post("/api/episodes/{episode_id}/storyboard-items/reorder")
    async def reorder_storyboard_items(
        episode_id: str,
        data: ReorderRequest,
        user_id: str = Depends(get_current_user),
    ):
        await require_episode(episode_id, user_id, 'member')
        try:
            return await reorder_storyboard_items_service(
                episode_id,
                data.item_ids,
                storyboard_dao=StoryboardDAO,
            )
        except StoryboardReorderFailed as exc:
            raise HTTPException(status_code=500, detail="排序失败") from exc

    @router.post("/api/storyboard/mix-audio", response_model=MixAudioResponse)
    async def mix_storyboard_audio_endpoint(
        body: MixAudioRequest,
        user_id: str = Depends(get_current_user),
    ) -> MixAudioResponse:
        await require_item(body.item_id, user_id, 'member')
        try:
            result = await mix_storyboard_audio_service(
                item_id=body.item_id,
                dialogue_url=body.dialogue_url,
                narration_url=body.narration_url,
                sfx_url=body.sfx_url,
                dialogue_gain_db=body.dialogue_gain_db,
                narration_gain_db=body.narration_gain_db,
                sfx_gain_db=body.sfx_gain_db,
                user_id=user_id,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except RuntimeError as exc:
            msg = str(exc)
            if "ffmpeg not found" in msg:
                raise HTTPException(status_code=503, detail="ffmpeg unavailable on server") from exc
            raise HTTPException(status_code=500, detail=msg) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return MixAudioResponse(**result)

    @router.post("/api/episodes/{episode_id}/storyboard-items/batch")
    async def batch_create_storyboard_items(
        episode_id: str,
        data: BatchStoryboardCreate,
        user_id: str = Depends(get_current_user),
    ):
        await require_episode(episode_id, user_id, 'member')
        await require_script(episode_id, data.script_id)
        return await batch_create_storyboard_items_service(
            episode_id,
            items=data.items,
            script_id=data.script_id,
            storyboard_dao=StoryboardDAO,
        )

    @router.post("/api/episodes/{episode_id}/storyboard-items/sync")
    async def sync_storyboard_items(
        episode_id: str,
        data: SyncStoryboardItemsRequest,
        user_id: str = Depends(get_current_user),
    ):
        await require_episode(episode_id, user_id, 'member')
        await require_script(episode_id, data.script_id)
        return await sync_storyboard_items_service(
            episode_id,
            items=data.items,
            script_id=data.script_id,
            storyboard_dao=StoryboardDAO,
        )

    @router.post("/api/episodes/{episode_id}/extract-to-assets")
    async def extract_to_assets(
        episode_id: str,
        data: ExtractToAssetsRequest,
        user_id: str = Depends(get_current_user),
    ):
        await require_episode(episode_id, user_id, 'member')
        try:
            return await extract_to_assets_service(
                episode_id,
                characters=data.characters,
                scenes=data.scenes,
                props=data.props,
                script_id=data.script_id,
                user_id=user_id,
                episode_dao=EpisodeDAO,
                asset_dao=AssetDAO,
            )
        except EpisodeNotFound as exc:
            raise HTTPException(status_code=404, detail="集不存在") from exc

    return router
