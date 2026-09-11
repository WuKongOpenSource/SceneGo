from unittest.mock import AsyncMock, Mock, patch


def test_gemini_tts_is_absent_from_current_provider_surfaces():
    from services.api_provider_registry import (
        get_api_model_presets,
        get_api_provider_catalog,
        get_provider_default_endpoint,
        get_provider_env_key,
    )

    assert get_provider_env_key("gemini-tts") is None
    assert get_provider_default_endpoint("gemini-tts") == ""
    assert all(item["provider"] != "gemini-tts" for item in get_api_provider_catalog())
    assert all(item["provider"] != "gemini-tts" for item in get_api_model_presets())


async def test_startup_seed_deletes_existing_gemini_tts_config():
    from services import api_config_runtime_loader as loader

    rows = [
        {
            "config_id": "apicfg_gpt_vip",
            "provider": "laozhang-gpt-image",
            "model_name": "gpt-image-2-vip",
        },
        {
            "config_id": "apicfg_gpt_official",
            "provider": "laozhang-sora2",
            "model_name": "gpt-image-2",
        },
        {
            "config_id": "apicfg_gemini_tts",
            "provider": "gemini-tts",
            "model_name": "gemini-3.1-flash-tts-preview",
        },
    ]

    with patch.object(loader.ApiConfigDAO, "list_all", AsyncMock(return_value=rows)), \
         patch.object(loader.ApiConfigDAO, "delete", AsyncMock(return_value=True)) as delete, \
         patch.object(loader.ApiConfigDAO, "create", AsyncMock()) as create:
        result = await loader.seed_default_api_providers()

    assert result == {"success": True, "created": 0, "upgraded": 0, "retired": 1}
    delete.assert_awaited_once_with("apicfg_gemini_tts")
    create.assert_not_awaited()


async def test_generic_speech_route_uses_minimax(monkeypatch):
    from routers.audio import create_audio_router

    async def get_current_user():
        return "user_1"

    provider = Mock()
    provider.generate_speech = AsyncMock(
        return_value={"audio_url": "/storage/audio/speech.mp3", "duration_ms": 1000}
    )
    get_audio_provider = Mock(return_value=provider)
    require_minimax_client = Mock(return_value=Mock(api_key="test-placeholder-credential"))
    persist = AsyncMock(
        return_value={"audio_url": "/storage/audio/speech.mp3", "duration_ms": 1000}
    )
    monkeypatch.setattr("routers.audio.attach_local_generated_audio_file", persist)

    router = create_audio_router(
        get_current_user_dependency=get_current_user,
        audio_track_dao=Mock(),
        character_voice_dao=Mock(),
        episode_dao=Mock(),
        provider_object_dao=Mock(),
        user_dao=Mock(),
        get_audio_provider_func=get_audio_provider,
        audio_upload_dir="unused",
        require_minimax_client=require_minimax_client,
        task_service_module=Mock(),
        save_generated_file_to_db_provider=Mock(),
        logger=Mock(),
    )
    route = next(
        item for item in router.routes
        if getattr(item, "path", None) == "/api/audio/generate-speech"
    )
    body_param = route.dependant.body_params[0]
    request_model = getattr(body_param, "type_", None) or body_param.field_info.annotation

    result = await route.endpoint(
        request_model(text="你好", persona="narrator", emotion="neutral"),
        user_id="user_1",
    )

    assert result["success"] is True
    require_minimax_client.assert_called_once_with()
    get_audio_provider.assert_called_once_with("minimax")
    provider.generate_speech.assert_awaited_once_with(
        "你好",
        persona="narrator",
        emotion="neutral",
    )
    assert persist.await_args.kwargs["source"] == "minimax"
    assert persist.await_args.kwargs["media_source"] == "generated_audio_minimax_speech"
