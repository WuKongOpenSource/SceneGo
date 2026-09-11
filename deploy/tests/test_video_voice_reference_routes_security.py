from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from routers.video_voice_references import (
    VideoReferenceAudioExtract,
    VideoVoiceReferenceCreate,
    create_video_voice_references_router,
)
from services.generation_access_service import GenerationAccessDenied
from services.video_voice_reference_service import VideoVoiceReferenceError


def _router_with_denied_source(access_checks):
    async def current_user():
        return "user_1"

    async def allow_project(*args, **kwargs):
        return {"role": "member"}

    async def deny_source(*args, **kwargs):
        access_checks.append((args, kwargs))
        raise GenerationAccessDenied("denied")

    episode_dao = Mock()
    episode_dao.get_project_id = AsyncMock(return_value="proj_1")
    return create_video_voice_references_router(
        get_current_user_dependency=current_user,
        video_voice_reference_dao=Mock(),
        episode_dao=episode_dao,
        file_dao=Mock(),
        project_access_checker=allow_project,
        generation_access_checker=deny_source,
    )


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        (
            "/api/video-voice-references/from-video",
            VideoVoiceReferenceCreate(
                project_id="proj_1",
                episode_id="ep_1",
                character_name="角色",
                source_video_url="/storage/private/video.mp4",
            ),
        ),
        (
            "/api/video-voice-references/extract-audio",
            VideoReferenceAudioExtract(
                project_id="proj_1",
                episode_id="ep_1",
                source_video_url="/storage/private/video.mp4",
            ),
        ),
    ],
)
async def test_video_reference_routes_authorize_source_file_before_processing(path, payload):
    access_checks = []
    router = _router_with_denied_source(access_checks)
    endpoint = next(route.endpoint for route in router.routes if getattr(route, "path", None) == path)

    with pytest.raises(HTTPException) as exc:
        await endpoint(payload, user_id="user_1")

    assert exc.value.status_code == 404
    assert access_checks[0][0][2] == ["/storage/private/video.mp4"]


async def test_video_reference_route_does_not_reflect_internal_processing_error(monkeypatch):
    async def current_user():
        return "user_1"

    async def allow(*args, **kwargs):
        return {"role": "member"}

    async def fail_processing(**kwargs):
        raise VideoVoiceReferenceError("ffmpeg failed at C:\\private\\secret.mp4")

    episode_dao = Mock()
    episode_dao.get_project_id = AsyncMock(return_value="proj_1")
    monkeypatch.setattr(
        "routers.video_voice_references.extract_audio_reference_from_video",
        fail_processing,
    )
    router = create_video_voice_references_router(
        get_current_user_dependency=current_user,
        video_voice_reference_dao=Mock(),
        episode_dao=episode_dao,
        file_dao=Mock(),
        project_access_checker=allow,
        generation_access_checker=allow,
    )
    endpoint = next(
        route.endpoint
        for route in router.routes
        if getattr(route, "path", None) == "/api/video-voice-references/extract-audio"
    )
    payload = VideoReferenceAudioExtract(
        project_id="proj_1",
        episode_id="ep_1",
        source_video_url="/storage/source.mp4",
    )

    with pytest.raises(HTTPException) as exc:
        await endpoint(payload, user_id="user_1")

    assert exc.value.status_code == 500
    assert exc.value.detail == "视频参考音频提取失败"
    assert "private" not in exc.value.detail
