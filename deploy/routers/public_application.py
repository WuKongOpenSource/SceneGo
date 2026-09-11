"""Business-route composition for the source-only online-provider edition.

The private application composition also registers local execution, node, and
workflow routes.  This module intentionally composes only project/data routes
and provider-backed audio submission.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException

import jwt_auth
from audio_provider import AUDIO_UPLOAD_DIR, get_audio_provider
from dao.provider_objects import ProviderObjectDAO
from dao.creative.content_workflow import ContentWorkflowDAO
from dao_asset import AssetDAO
from dao_audio_track import AudioTrackDAO
from dao_canvas import CanvasBoardDAO, CanvasConnectionDAO, CanvasNodeDAO
from dao_character_voice import CharacterVoiceDAO
from dao_content import FileDAO, ProjectDAO, ProjectMemberDAO, TextContentDAO, VersionDAO
from dao_entity_file import EntityFileDAO
from dao_episode import EpisodeDAO
from dao_episode_script import EpisodeScriptDAO
from dao_episode_script_conversation import EpisodeScriptConversationDAO
from dao_episode_script_segment import EpisodeScriptSegmentDAO
from dao_notification import NotificationDAO
from dao_organization import OrganizationMemberDAO
from dao_storyboard import StoryboardDAO
from dao_task import ActivityLogDAO, TaskDAO
from dao_timeline import TimelineDAO
from dao_user import UserDAO
from dao_video_segment import VideoSegmentDAO
from dao_video_voice_reference import VideoVoiceReferenceDAO
from file_optimization import FileDeduplicationService, FileOptimizationService
from file_service import save_generated_file_to_db
from routers.assets import create_assets_router
from routers.audio import create_audio_router
from routers.auth_legacy import create_auth_legacy_router
from routers.canvas import create_canvas_router
from routers.content_versions import create_content_versions_router
from routers.content_workflow import create_content_workflow_router
from routers.entity_files import create_entity_files_router
from routers.episode_video import create_episode_video_router
from routers.episodes import create_episodes_router
from routers.legacy_files import create_legacy_files_router
from routers.project_admin import create_project_admin_router
from routers.project_core import create_project_core_router
from routers.script_timeline import create_script_timeline_router
from routers.storyboard import create_storyboard_router
from routers.storyboard_quality import create_storyboard_quality_router
from routers.task_notifications import create_task_notifications_router
from routers.video_voice_references import create_video_voice_references_router
from services.request_auth_service import get_current_media_user, get_current_user

try:
    from external_api.audio.minimax_audio import get_minimax_audio_client
except ImportError:
    get_minimax_audio_client = None


def _require_minimax_client():
    if get_minimax_audio_client is None:
        raise HTTPException(status_code=501, detail="MiniMax 音频模块不可用")
    client = get_minimax_audio_client()
    refresh = getattr(client, "_refresh_runtime_config", None)
    if callable(refresh):
        refresh()
    if not getattr(client, "api_key", None):
        raise HTTPException(status_code=503, detail="请先在管理后台配置并启用 MiniMax API")
    return client


def create_public_application_router(
    *,
    online_task_service: Any,
    get_redis_client: Any,
    logger: logging.Logger,
) -> APIRouter:
    router = APIRouter()

    router.include_router(
        create_audio_router(
            get_current_user_dependency=get_current_user,
            audio_track_dao=AudioTrackDAO,
            character_voice_dao=CharacterVoiceDAO,
            episode_dao=EpisodeDAO,
            provider_object_dao=ProviderObjectDAO,
            user_dao=UserDAO,
            get_audio_provider_func=get_audio_provider,
            audio_upload_dir=AUDIO_UPLOAD_DIR,
            require_minimax_client=_require_minimax_client,
            task_service_module=online_task_service,
            save_generated_file_to_db_provider=lambda: save_generated_file_to_db,
            logger=logger,
            file_dao=FileDAO,
        )
    )
    router.include_router(
        create_script_timeline_router(
            get_current_user_dependency=get_current_user,
            episode_script_dao=EpisodeScriptDAO,
            episode_script_segment_dao=EpisodeScriptSegmentDAO,
            episode_script_conversation_dao=EpisodeScriptConversationDAO,
            timeline_dao=TimelineDAO,
        )
    )
    router.include_router(
        create_canvas_router(
            get_current_user_dependency=get_current_user,
            project_member_dao=ProjectMemberDAO,
            canvas_board_dao=CanvasBoardDAO,
            canvas_node_dao=CanvasNodeDAO,
            canvas_connection_dao=CanvasConnectionDAO,
        )
    )
    router.include_router(
        create_task_notifications_router(
            get_current_user_dependency=get_current_user,
            task_dao=TaskDAO,
            notification_dao=NotificationDAO,
            get_task_queue=online_task_service.get_queue,
        )
    )
    router.include_router(
        create_project_admin_router(
            get_current_user_dependency=get_current_user,
            user_dao=UserDAO,
            project_dao=ProjectDAO,
            project_member_dao=ProjectMemberDAO,
        )
    )
    router.include_router(
        create_content_versions_router(
            get_current_user_dependency=get_current_user,
            project_dao=ProjectDAO,
            version_dao=VersionDAO,
            file_dao=FileDAO,
            text_content_dao=TextContentDAO,
            activity_log_dao=ActivityLogDAO,
        )
    )
    router.include_router(
        create_episodes_router(
            get_current_user_dependency=get_current_user,
            episode_dao=EpisodeDAO,
            episode_script_dao=EpisodeScriptDAO,
        )
    )
    router.include_router(
        create_episode_video_router(
            get_current_user_dependency=get_current_user,
            video_segment_dao=VideoSegmentDAO,
            episode_dao=EpisodeDAO,
        )
    )
    router.include_router(
        create_content_workflow_router(
            get_current_user_dependency=get_current_user,
            content_workflow_dao=ContentWorkflowDAO,
            episode_dao=EpisodeDAO,
        )
    )
    router.include_router(
        create_video_voice_references_router(
            get_current_user_dependency=get_current_user,
            video_voice_reference_dao=VideoVoiceReferenceDAO,
            episode_dao=EpisodeDAO,
            file_dao=FileDAO,
        )
    )
    router.include_router(
        create_storyboard_router(
            get_current_user_dependency=get_current_user,
            storyboard_dao=StoryboardDAO,
            episode_script_dao=EpisodeScriptDAO,
            asset_dao=AssetDAO,
            episode_dao=EpisodeDAO,
            logger=logger,
        )
    )
    router.include_router(
        create_storyboard_quality_router(
            get_current_user_dependency=get_current_user,
            file_dao=FileDAO,
            storyboard_dao=StoryboardDAO,
            episode_dao=EpisodeDAO,
        )
    )
    router.include_router(
        create_assets_router(
            get_current_user_dependency=get_current_user,
            asset_dao=AssetDAO,
            entity_file_dao=EntityFileDAO,
            episode_dao=EpisodeDAO,
            logger=logger,
        )
    )
    router.include_router(
        create_entity_files_router(
            get_current_user_dependency=get_current_user,
            get_media_user_dependency=get_current_media_user,
            file_dao=FileDAO,
            entity_file_dao=EntityFileDAO,
            episode_dao=EpisodeDAO,
            storyboard_dao=StoryboardDAO,
            asset_dao=AssetDAO,
            video_segment_dao=VideoSegmentDAO,
            user_dao=UserDAO,
            save_generated_file_to_db_provider=lambda: save_generated_file_to_db,
            logger=logger,
        )
    )
    router.include_router(
        create_legacy_files_router(
            get_current_user_dependency=get_current_user,
            user_dao=UserDAO,
            version_dao=VersionDAO,
            file_dao=FileDAO,
            activity_log_dao=ActivityLogDAO,
            file_optimization_service=FileOptimizationService,
            file_deduplication_service=FileDeduplicationService,
            jwt_auth_module=jwt_auth,
            logger=logger,
        )
    )
    router.include_router(
        create_auth_legacy_router(
            get_current_user_dependency=get_current_user,
            user_dao=UserDAO,
            activity_log_dao=ActivityLogDAO,
            create_session_token=jwt_auth.create_token,
            get_redis_client=get_redis_client,
        )
    )
    router.include_router(
        create_project_core_router(
            get_current_user_dependency=get_current_user,
            project_dao=ProjectDAO,
            version_dao=VersionDAO,
            project_member_dao=ProjectMemberDAO,
            user_dao=UserDAO,
            activity_log_dao=ActivityLogDAO,
            organization_member_dao=OrganizationMemberDAO,
        )
    )
    return router
