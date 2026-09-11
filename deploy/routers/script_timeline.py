"""Script, script segment, and timeline route handlers."""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from services.project_access_service import ProjectAccessDenied, require_project_access
from services.script_timeline_service import (
    ScriptFileCreateFailed,
    ScriptFileNotFound,
    ScriptSaveFailed,
    TimelineTrackCreateFailed,
    TimelineTrackNotFound,
    batch_save_script_segments as batch_save_script_segments_service,
    create_script_file,
    create_timeline_track as create_timeline_track_service,
    delete_script_file,
    delete_script_segments as delete_script_segments_service,
    get_primary_script,
    list_script_segments as list_script_segments_service,
    list_scripts as list_scripts_service,
    list_timeline_tracks,
    update_primary_script,
    update_script_file,
    update_timeline_track as update_timeline_track_service,
)
from services.script_conversation_service import (
    ScriptConversationError,
    ScriptConversationItemNotFound,
    append_script_message,
    confirm_script_version,
    create_script_version,
    get_script_conversation,
    merge_script_version_metadata,
    revise_script_message,
    reject_script_version,
    select_script_version,
)


def create_script_timeline_router(
    *,
    get_current_user_dependency: Any,
    episode_script_dao: Any,
    episode_script_segment_dao: Any,
    episode_script_conversation_dao: Any,
    timeline_dao: Any,
    episode_dao: Any = None,
    project_access_checker: Any = require_project_access,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    EpisodeScriptDAO = episode_script_dao
    EpisodeScriptSegmentDAO = episode_script_segment_dao
    EpisodeScriptConversationDAO = episode_script_conversation_dao
    TimelineDAO = timeline_dao
    if episode_dao is None:
        from dao_episode import EpisodeDAO as DefaultEpisodeDAO
        episode_dao = DefaultEpisodeDAO
    EpisodeDAO = episode_dao

    async def require_episode(episode_id: str, identity: str, role: str) -> None:
        project_id = await EpisodeDAO.get_project_id(episode_id)
        if not project_id:
            raise HTTPException(status_code=404, detail="集不存在")
        try:
            await project_access_checker(project_id, identity, role)
        except ProjectAccessDenied as exc:
            raise HTTPException(status_code=404, detail="集不存在") from exc

    async def require_track(track_id: str, identity: str) -> None:
        track = await TimelineDAO.get_by_id(track_id)
        if not track:
            raise HTTPException(status_code=404, detail="时间轴轨道不存在")
        await require_episode(track['episode_id'], identity, 'member')

    async def require_script(episode_id: str, script_id: str, identity: str) -> None:
        await require_episode(episode_id, identity, 'member')
        script = await EpisodeScriptDAO.get_by_id(script_id)
        if not script or str(script.get('episode_id') or '') != episode_id:
            raise HTTPException(status_code=404, detail="剧本文件不存在")


    class ScriptUpdate(BaseModel):
        original_content: Optional[str] = None
        adapted_script: Optional[str] = None
        metadata: Optional[dict] = None
        file_name: Optional[str] = None


    class ScriptCreate(BaseModel):
        file_name: str = '未命名文件'
        original_content: str = ''
        adapted_script: str = ''
        sort_order: Optional[int] = None
        metadata: Optional[dict] = None
        source_type: Optional[str] = None
        source_id: Optional[str] = None


    class ScriptMessageCreate(BaseModel):
        model_config = ConfigDict(protected_namespaces=())

        role: str
        content: str = ''
        status: str = 'completed'
        model_alias: Optional[str] = None
        provider: Optional[str] = None
        model_name: Optional[str] = None
        reply_to_message_id: Optional[str] = None
        request_id: Optional[str] = None
        metadata: Optional[dict] = None


    class ScriptMessageUpdate(BaseModel):
        content: Optional[str] = None
        status: Optional[str] = None
        metadata: Optional[dict] = None


    class ScriptVersionCreate(BaseModel):
        model_config = ConfigDict(protected_namespaces=())

        message_id: Optional[str] = None
        base_version_id: Optional[str] = None
        content: str
        storyboard_items: list = Field(default_factory=list)
        source: str = 'ai'
        status: str = 'ready'
        model_alias: Optional[str] = None
        provider: Optional[str] = None
        model_name: Optional[str] = None
        metadata: Optional[dict] = None
        set_current: bool = True


    class ScriptVersionMetadataUpdate(BaseModel):
        metadata: dict = Field(default_factory=dict)




    class ScriptSegmentBatchBody(BaseModel):
        script_id: Optional[str] = None
        segments: list = []


    @router.get("/api/episodes/{episode_id}/script-segments")
    async def list_script_segments(episode_id: str, script_id: Optional[str] = None,
                                   user_id: str = Depends(get_current_user)):
        await require_episode(episode_id, user_id, 'readonly')
        return await list_script_segments_service(
            episode_id,
            script_id,
            episode_script_segment_dao=EpisodeScriptSegmentDAO,
        )


    @router.put("/api/episodes/{episode_id}/script-segments/batch")
    async def batch_save_script_segments(episode_id: str, data: ScriptSegmentBatchBody,
                                         user_id: str = Depends(get_current_user)):
        await require_episode(episode_id, user_id, 'member')
        return await batch_save_script_segments_service(
            episode_id,
            data.script_id,
            data.segments,
            episode_script_segment_dao=EpisodeScriptSegmentDAO,
        )


    @router.delete("/api/episodes/{episode_id}/script-segments")
    async def delete_script_segments(episode_id: str, script_id: Optional[str] = None,
                                     user_id: str = Depends(get_current_user)):
        await require_episode(episode_id, user_id, 'member')
        return await delete_script_segments_service(
            episode_id,
            script_id,
            episode_script_segment_dao=EpisodeScriptSegmentDAO,
        )


    @router.get("/api/episodes/{episode_id}/script")
    async def get_script(episode_id: str, user_id: str = Depends(get_current_user)):
        await require_episode(episode_id, user_id, 'readonly')
        return await get_primary_script(episode_id, episode_script_dao=EpisodeScriptDAO)


    @router.put("/api/episodes/{episode_id}/script")
    async def update_script(episode_id: str, data: ScriptUpdate, user_id: str = Depends(get_current_user)):
        await require_episode(episode_id, user_id, 'member')
        try:
            return await update_primary_script(
                episode_id,
                original_content=data.original_content,
                adapted_script=data.adapted_script,
                metadata=data.metadata,
                episode_script_dao=EpisodeScriptDAO,
                source_type=data.source_type,
                source_id=data.source_id,
            )
        except ScriptSaveFailed as exc:
            raise HTTPException(status_code=500, detail="保存剧本失败") from exc




    @router.get("/api/episodes/{episode_id}/scripts")
    async def list_scripts(episode_id: str, user_id: str = Depends(get_current_user)):
        await require_episode(episode_id, user_id, 'readonly')
        return await list_scripts_service(episode_id, episode_script_dao=EpisodeScriptDAO)


    @router.post("/api/episodes/{episode_id}/scripts")
    async def create_script(episode_id: str, data: ScriptCreate, user_id: str = Depends(get_current_user)):
        await require_episode(episode_id, user_id, 'member')
        try:
            return await create_script_file(
                episode_id,
                file_name=data.file_name,
                original_content=data.original_content,
                adapted_script=data.adapted_script,
                sort_order=data.sort_order,
                metadata=data.metadata,
                source_type=data.source_type,
                source_id=data.source_id,
                episode_script_dao=EpisodeScriptDAO,
            )
        except ScriptFileCreateFailed as exc:
            raise HTTPException(status_code=500, detail="创建剧本文件失败") from exc


    @router.put("/api/episodes/{episode_id}/scripts/{script_id}")
    async def update_script_by_id(episode_id: str, script_id: str, data: ScriptUpdate, user_id: str = Depends(get_current_user)):
        await require_script(episode_id, script_id, user_id)
        try:
            return await update_script_file(
                script_id,
                file_name=data.file_name,
                original_content=data.original_content,
                adapted_script=data.adapted_script,
                metadata=data.metadata,
                episode_script_dao=EpisodeScriptDAO,
            )
        except ScriptFileNotFound as exc:
            raise HTTPException(status_code=404, detail="剧本文件不存在") from exc


    @router.delete("/api/episodes/{episode_id}/scripts/{script_id}")
    async def delete_script_by_id(episode_id: str, script_id: str, user_id: str = Depends(get_current_user)):
        await require_script(episode_id, script_id, user_id)
        try:
            return await delete_script_file(script_id, episode_script_dao=EpisodeScriptDAO)
        except ScriptFileNotFound as exc:
            raise HTTPException(status_code=404, detail="剧本文件不存在") from exc



    @router.get("/api/episodes/{episode_id}/scripts/{script_id}/conversation")
    async def get_conversation(episode_id: str, script_id: str,
                               user_id: str = Depends(get_current_user)):
        await require_script(episode_id, script_id, user_id)
        script = await EpisodeScriptDAO.get_by_id(script_id)
        return await get_script_conversation(
            dict(script),
            conversation_dao=EpisodeScriptConversationDAO,
        )


    @router.post("/api/episodes/{episode_id}/scripts/{script_id}/messages")
    async def create_message(episode_id: str, script_id: str, data: ScriptMessageCreate,
                             user_id: str = Depends(get_current_user)):
        await require_script(episode_id, script_id, user_id)
        try:
            return await append_script_message(
                episode_id=episode_id,
                script_id=script_id,
                role=data.role,
                content=data.content,
                status=data.status,
                model_alias=data.model_alias,
                provider=data.provider,
                model_name=data.model_name,
                reply_to_message_id=data.reply_to_message_id,
                request_id=data.request_id,
                metadata=data.metadata,
                conversation_dao=EpisodeScriptConversationDAO,
            )
        except ScriptConversationError as exc:
            raise HTTPException(status_code=500, detail="保存剧本对话失败") from exc


    @router.patch("/api/episodes/{episode_id}/scripts/{script_id}/messages/{message_id}")
    async def update_message(episode_id: str, script_id: str, message_id: str,
                             data: ScriptMessageUpdate,
                             user_id: str = Depends(get_current_user)):
        await require_script(episode_id, script_id, user_id)
        try:
            return await revise_script_message(
                script_id=script_id,
                message_id=message_id,
                content=data.content,
                status=data.status,
                metadata=data.metadata,
                conversation_dao=EpisodeScriptConversationDAO,
            )
        except ScriptConversationItemNotFound as exc:
            raise HTTPException(status_code=404, detail="剧本对话消息不存在") from exc


    @router.post("/api/episodes/{episode_id}/scripts/{script_id}/versions")
    async def create_version(episode_id: str, script_id: str, data: ScriptVersionCreate,
                             user_id: str = Depends(get_current_user)):
        await require_script(episode_id, script_id, user_id)
        try:
            return await create_script_version(
                episode_id=episode_id,
                script_id=script_id,
                message_id=data.message_id,
                base_version_id=data.base_version_id,
                content=data.content,
                storyboard_items=data.storyboard_items,
                source=data.source,
                status=data.status,
                model_alias=data.model_alias,
                provider=data.provider,
                model_name=data.model_name,
                metadata=data.metadata,
                set_current=data.set_current,
                conversation_dao=EpisodeScriptConversationDAO,
                user_id=user_id,
            )
        except ScriptConversationError as exc:
            raise HTTPException(status_code=500, detail="保存分镜脚本版本失败") from exc


    @router.put("/api/episodes/{episode_id}/scripts/{script_id}/versions/{version_id}/select")
    async def select_version(episode_id: str, script_id: str, version_id: str,
                             user_id: str = Depends(get_current_user)):
        await require_script(episode_id, script_id, user_id)
        try:
            return await select_script_version(
                script_id=script_id,
                version_id=version_id,
                conversation_dao=EpisodeScriptConversationDAO,
            )
        except ScriptConversationItemNotFound as exc:
            raise HTTPException(status_code=404, detail="分镜脚本版本不存在") from exc


    @router.put("/api/episodes/{episode_id}/scripts/{script_id}/versions/{version_id}/confirm")
    async def confirm_version(episode_id: str, script_id: str, version_id: str,
                              user_id: str = Depends(get_current_user)):
        await require_script(episode_id, script_id, user_id)
        try:
            from dao.creative.content_workflow import ContentWorkflowDAO

            return await confirm_script_version(
                episode_id=episode_id,
                script_id=script_id,
                version_id=version_id,
                user_id=user_id,
                conversation_dao=EpisodeScriptConversationDAO,
                content_workflow_dao=ContentWorkflowDAO,
            )
        except ScriptConversationItemNotFound as exc:
            raise HTTPException(status_code=404, detail="待确认的剧本版本不存在") from exc


    @router.put("/api/episodes/{episode_id}/scripts/{script_id}/versions/{version_id}/reject")
    async def reject_version(episode_id: str, script_id: str, version_id: str,
                             user_id: str = Depends(get_current_user)):
        await require_script(episode_id, script_id, user_id)
        try:
            return await reject_script_version(
                script_id=script_id,
                version_id=version_id,
                user_id=user_id,
                conversation_dao=EpisodeScriptConversationDAO,
            )
        except ScriptConversationItemNotFound as exc:
            raise HTTPException(status_code=404, detail="待确认的剧本版本不存在") from exc


    @router.patch("/api/episodes/{episode_id}/scripts/{script_id}/versions/{version_id}/metadata")
    async def update_version_metadata(
        episode_id: str,
        script_id: str,
        version_id: str,
        data: ScriptVersionMetadataUpdate,
        user_id: str = Depends(get_current_user),
    ):
        await require_script(episode_id, script_id, user_id)
        try:
            return await merge_script_version_metadata(
                script_id=script_id,
                version_id=version_id,
                metadata=data.metadata,
                conversation_dao=EpisodeScriptConversationDAO,
            )
        except ScriptConversationItemNotFound as exc:
            raise HTTPException(status_code=404, detail="分镜脚本版本不存在") from exc




    class TimelineTrackCreate(BaseModel):
        track_type: str
        track_name: str = ''
        sort_order: int = 0
        items: Optional[list] = None

    class TimelineTrackUpdate(BaseModel):
        track_name: Optional[str] = None
        sort_order: Optional[int] = None
        items: Optional[list] = None


    @router.get("/api/episodes/{episode_id}/timeline-tracks")
    async def get_timeline_tracks(episode_id: str, user_id: str = Depends(get_current_user)):
        await require_episode(episode_id, user_id, 'readonly')
        return await list_timeline_tracks(episode_id, timeline_dao=TimelineDAO)


    @router.post("/api/episodes/{episode_id}/timeline-tracks")
    async def create_timeline_track(episode_id: str, data: TimelineTrackCreate, user_id: str = Depends(get_current_user)):
        await require_episode(episode_id, user_id, 'member')
        try:
            return await create_timeline_track_service(
                episode_id,
                track_type=data.track_type,
                track_name=data.track_name,
                sort_order=data.sort_order,
                items=data.items,
                timeline_dao=TimelineDAO,
            )
        except TimelineTrackCreateFailed as exc:
            raise HTTPException(status_code=500, detail="创建时间轴轨道失败") from exc


    @router.put("/api/timeline-tracks/{track_id}")
    async def update_timeline_track(track_id: str, data: TimelineTrackUpdate, user_id: str = Depends(get_current_user)):
        await require_track(track_id, user_id)
        try:
            return await update_timeline_track_service(
                track_id,
                data.dict(exclude_none=True),
                timeline_dao=TimelineDAO,
            )
        except TimelineTrackNotFound as exc:
            raise HTTPException(status_code=404, detail="时间轴轨道不存在") from exc




    return router
