from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from routers.ai_proxy import create_ai_proxy_router
from routers.audio import create_audio_router
from schemas.generation import DoubaoImageRequest, GeminiImageRequest, GptImageRequest
from services.generation_access_service import GenerationAccessDenied


async def test_studio_image_generation_checks_episode_scope_before_provider_call():
    async def require_auth():
        return "user_1"

    async def deny_access(*args, **kwargs):
        raise GenerationAccessDenied("denied")

    router = create_ai_proxy_router(
        require_auth_dependency=require_auth,
        get_main_event_loop=lambda: None,
        get_redis_client=lambda: None,
        file_dao=Mock(),
        generation_access_checker=deny_access,
    )
    endpoint = next(
        route.endpoint
        for route in router.routes
        if getattr(route, "path", None) == "/api/gemini/image"
    )

    with pytest.raises(HTTPException) as exc:
        await endpoint(
            GeminiImageRequest(
                prompt="test",
                entity_type="episode",
                entity_id="ep_other",
                file_role="studio_image",
                project_id="proj_1",
                episode_id="ep_other",
            ),
            username="user_1",
        )

    assert exc.value.status_code == 404


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("/api/gemini/image", GeminiImageRequest(prompt="test", references=["/storage/private.png"])),
        ("/api/gpt-image/generate", GptImageRequest(prompt="test", references=["/storage/private.png"])),
        ("/api/materials/doubao", DoubaoImageRequest(prompt="test", references=["/storage/private.png"])),
    ],
)
async def test_all_online_image_routes_authorize_reference_ownership_before_provider_call(path, payload):
    async def require_auth():
        return "user_1"

    access_checks = []

    async def deny_access(*args, **kwargs):
        access_checks.append((args, kwargs))
        raise GenerationAccessDenied("denied")

    router = create_ai_proxy_router(
        require_auth_dependency=require_auth,
        get_main_event_loop=lambda: None,
        get_redis_client=lambda: None,
        file_dao=Mock(),
        generation_access_checker=deny_access,
    )
    endpoint = next(route.endpoint for route in router.routes if getattr(route, "path", None) == path)

    with pytest.raises(HTTPException) as exc:
        await endpoint(payload, username="user_1")

    assert exc.value.status_code == 404
    assert access_checks[0][0][2] == ["/storage/private.png"]


async def test_studio_tts_rejects_project_episode_mismatch_before_provider_call():
    async def get_current_user():
        return "user_1"

    async def allow_project(*args, **kwargs):
        return {"role": "member"}

    episode_dao = Mock()
    episode_dao.get_project_id = AsyncMock(return_value="proj_real")
    minimax_client = Mock()

    router = create_audio_router(
        get_current_user_dependency=get_current_user,
        audio_track_dao=Mock(),
        character_voice_dao=Mock(),
        episode_dao=episode_dao,
        provider_object_dao=Mock(),
        user_dao=Mock(),
        get_audio_provider_func=Mock(),
        audio_upload_dir="unused",
        require_minimax_client=lambda: minimax_client,
        task_service_module=Mock(),
        save_generated_file_to_db_provider=Mock(),
        logger=Mock(),
        project_access_checker=allow_project,
    )
    route = next(
        item
        for item in router.routes
        if getattr(item, "path", None) == "/api/minimax/tts/sync"
    )
    body_param = route.dependant.body_params[0]
    request_model = getattr(body_param, "type_", None) or body_param.field_info.annotation

    with pytest.raises(HTTPException) as exc:
        await route.endpoint(
            request_model(
                text="hello",
                voice_id="male-qn-qingse",
                entity_type="episode",
                entity_id="ep_1",
                file_role="studio_audio",
                project_id="proj_other",
                episode_id="ep_1",
            ),
            user_id="user_1",
        )

    assert exc.value.status_code == 404
    minimax_client.tts_sync.assert_not_called()
