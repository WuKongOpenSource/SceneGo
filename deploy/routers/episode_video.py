"""Episode video segment and composition route handlers."""

from typing import Any, Optional
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from services.project_access_service import require_project_access
from services.project_access_service import resolve_user_id
from services.compose_error_service import public_compose_error
from dao.creative.enhance_export import EnhanceExportDAO
from services.enhance_media_duration_service import selected_video_duration
from services.episode_video_service import (
    EpisodeNotFound,
    VideoSegmentCreateFailed,
    VideoSegmentNotFound,
    create_video_segment as create_video_segment_service,
    delete_video_segment as delete_video_segment_service,
    get_episode_compose_status,
    get_video_takes,
    list_video_segments,
    preflight_episode_compose,
    require_episode_access,
    require_video_segment_access,
    start_episode_compose,
    update_video_segment as update_video_segment_service,
)


class VideoSegmentCreate(BaseModel):
    sort_order: int = 0
    storyboard_item_id: Optional[str] = None
    generation_mode: str = "i2v"
    model: str = ""
    input_params: Optional[dict] = None


class VideoSegmentUpdate(BaseModel):
    sort_order: Optional[int] = None
    generation_mode: Optional[str] = None
    model: Optional[str] = None
    video_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    duration_ms: Optional[int] = None
    task_id: Optional[str] = None
    status: Optional[str] = None
    input_params: Optional[dict] = None


def create_episode_video_router(
    *,
    get_current_user_dependency: Any,
    video_segment_dao: Any,
    episode_dao: Any,
    project_access_checker: Any = require_project_access,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    VideoSegmentDAO = video_segment_dao
    EpisodeDAO = episode_dao

    async def require_episode(episode_id: str, identity: str, role: str) -> None:
        try:
            await require_episode_access(
                episode_id,
                identity,
                role,
                episode_dao=EpisodeDAO,
                project_access_checker=project_access_checker,
            )
        except EpisodeNotFound as exc:
            raise HTTPException(status_code=404, detail="剧集不存在") from exc

    async def require_segment(segment_id: str, identity: str) -> None:
        try:
            await require_video_segment_access(
                segment_id,
                identity,
                video_segment_dao=VideoSegmentDAO,
                episode_dao=EpisodeDAO,
                project_access_checker=project_access_checker,
            )
        except VideoSegmentNotFound as exc:
            raise HTTPException(status_code=404, detail="视频段不存在")
        except EpisodeNotFound as exc:
            raise HTTPException(status_code=404, detail="剧集不存在") from exc

    @router.get("/api/episodes/{episode_id}/video-segments")
    async def get_video_segments(episode_id: str, user_id: str = Depends(get_current_user)):
        await require_episode(episode_id, user_id, 'readonly')
        return await list_video_segments(episode_id, video_segment_dao=VideoSegmentDAO)

    @router.get("/api/episodes/{episode_id}/video-takes")
    async def video_takes_endpoint(episode_id: str, user_id: str = Depends(get_current_user)):
        """Return all generated video takes grouped by storyboard item for composition selection."""
        await require_episode(episode_id, user_id, 'readonly')
        return await get_video_takes(episode_id)

    @router.post("/api/episodes/{episode_id}/export-enhance")
    async def export_enhance(episode_id: str, user_id: str = Depends(get_current_user)):
        await require_episode(episode_id, user_id, 'member')
        identity = await resolve_user_id(user_id)
        if not identity:
            raise HTTPException(404, '用户不存在')
        try:
            return await EnhanceExportDAO.export(episode_id, identity, resolve_duration=selected_video_duration)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @router.post("/api/episodes/{episode_id}/compose")
    async def compose_episode_endpoint(episode_id: str, request: Request, user_id: str = Depends(get_current_user)):
        """Start async episode composition; frontend polls `/compose/status`."""
        await require_episode(episode_id, user_id, 'member')
        selections = None
        audio_mode = "video_original"
        timeline = None
        subtitles = None
        subtitle_style = None
        try:
            body = await request.json()
            selections = (body or {}).get("selections")
            audio_mode = (body or {}).get("audio_mode") or "video_original"
            timeline = (body or {}).get("timeline")
            subtitles = (body or {}).get("subtitles")
            subtitle_style = (body or {}).get("subtitle_style")
        except Exception:
            selections = None
            audio_mode = "video_original"
            timeline = None
            subtitles = None
            subtitle_style = None

        try:
            return await start_episode_compose(
                episode_id,
                user_id,
                selections,
                audio_mode,
                timeline,
                subtitles,
                subtitle_style,
                episode_dao=EpisodeDAO,
            )
        except EpisodeNotFound as exc:
            raise HTTPException(status_code=404, detail="剧集不存在") from exc

    @router.post("/api/episodes/{episode_id}/compose/preflight")
    async def compose_preflight_endpoint(episode_id: str, request: Request, user_id: str = Depends(get_current_user)):
        """Validate source identity and duration without creating a compose job."""
        await require_episode(episode_id, user_id, 'member')
        try:
            body = await request.json()
            timeline = (body or {}).get("timeline")
            return await preflight_episode_compose(
                episode_id,
                timeline,
                episode_dao=EpisodeDAO,
            )
        except EpisodeNotFound as exc:
            raise HTTPException(status_code=404, detail="剧集不存在") from exc
        except (RuntimeError, OSError) as exc:
            logging.getLogger(__name__).exception('compose preflight failed episode=%s', episode_id)
            raise HTTPException(status_code=422, detail=public_compose_error(exc)) from exc

    @router.get("/api/episodes/{episode_id}/compose/status")
    async def compose_status_endpoint(episode_id: str, user_id: str = Depends(get_current_user)):
        """Return episode composition status."""
        await require_episode(episode_id, user_id, 'readonly')
        return get_episode_compose_status(episode_id)

    @router.post("/api/episodes/{episode_id}/video-segments")
    async def create_video_segment(episode_id: str, data: VideoSegmentCreate, user_id: str = Depends(get_current_user)):
        await require_episode(episode_id, user_id, 'member')
        try:
            return await create_video_segment_service(
                episode_id,
                sort_order=data.sort_order,
                storyboard_item_id=data.storyboard_item_id,
                generation_mode=data.generation_mode,
                model=data.model,
                input_params=data.input_params,
                video_segment_dao=VideoSegmentDAO,
            )
        except VideoSegmentCreateFailed as exc:
            raise HTTPException(status_code=500, detail="创建视频片段失败") from exc

    @router.put("/api/video-segments/{segment_id}")
    async def update_video_segment(segment_id: str, data: VideoSegmentUpdate, user_id: str = Depends(get_current_user)):
        await require_segment(segment_id, user_id)
        try:
            return await update_video_segment_service(
                segment_id,
                data.dict(exclude_none=True),
                video_segment_dao=VideoSegmentDAO,
            )
        except VideoSegmentNotFound as exc:
            raise HTTPException(status_code=404, detail="视频片段不存在") from exc

    @router.delete("/api/video-segments/{segment_id}")
    async def delete_video_segment(segment_id: str, user_id: str = Depends(get_current_user)):
        await require_segment(segment_id, user_id)
        try:
            return await delete_video_segment_service(segment_id, video_segment_dao=VideoSegmentDAO)
        except VideoSegmentNotFound as exc:
            raise HTTPException(status_code=404, detail="视频段不存在") from exc

    return router
