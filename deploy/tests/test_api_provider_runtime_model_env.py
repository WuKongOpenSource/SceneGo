from __future__ import annotations

import threading
import json

import pytest

from external_api.video import minimax as minimax_video
from external_api.video import base as video_base
from external_api.video import seedance as seedance_video
from external_api.video import sora2 as sora2_video
from external_api.video import veo as veo_video
from external_api.video import wan2 as wan2_video
from services import (
    ai_proxy_gemini_text_service,
    ai_proxy_http_client,
    ai_proxy_minimax_text_service,
    ai_proxy_service,
    video_reverse_service,
)
from services.ai_proxy_types import GptImageReferenceInput
from services.api_provider_registry import (
    SEEDANCE_AGENT_PLAN_ENDPOINT,
    SEEDANCE_AGENT_PLAN_MODEL_MAP,
    SEEDANCE_DEFAULT_MODEL_MAP,
    DASHSCOPE_DEFAULT_MODEL_MAP,
    DOUBAO_IMAGE_DEFAULT_MODEL,
    DOUBAO_IMAGE_LEGACY_MODEL,
    MINIMAX_DEFAULT_VIDEO_MODEL,
    MINIMAX_M3_MODEL,
    MINIMAX_MUSIC_MODEL,
    MINIMAX_TTS_HD_MODEL,
    SORA2_DEFAULT_VIDEO_MODEL,
    VEO_DEFAULT_VIDEO_MODEL,
    get_deepseek_operation_model_env_key,
    get_endpoint_env_key,
    get_dashscope_sub_model_env_key,
    get_model_env_key,
    get_minimax_operation_model_env_key,
    get_provider_env_key,
    get_scoped_model_env_key,
    get_seedance_sub_model_env_key,
    get_seedance_operation_api_key_env_key,
    get_seedance_operation_endpoint_env_key,
    dashscope_vidu_reference_sub_model,
    dashscope_vidu_startend_sub_model,
    minimax_runtime_model_override,
    normalize_minimax_video_model,
    normalize_doubao_image_model,
    normalize_sora2_video_model,
    normalize_veo_video_model,
    sora2_runtime_model_override,
    veo_runtime_model_override,
)
from services.api_provider_runtime import (
    build_provider_runtime_status,
    resolve_dashscope_default_model_name,
    resolve_dashscope_model_name,
    resolve_provider,
    resolve_seedance_model_name,
)
def test_resolve_provider_uses_runtime_model_env(monkeypatch):
    env_key = get_provider_env_key("gemini-text")
    assert env_key
    model_env = get_model_env_key(env_key)

    monkeypatch.setenv(env_key, "test-key")
    monkeypatch.setenv(model_env, "gemini-runtime-model")

    config = resolve_provider("gemini-text")

    assert config.model_name == "gemini-runtime-model"
    assert config.model_env == model_env
    assert config.source["model"] == model_env


def test_runtime_status_matches_seedance_plan_health_to_resolved_model(monkeypatch):
    api_key_env = get_provider_env_key("seedance")
    plan_key_env = get_seedance_operation_api_key_env_key("agent_plan")
    plan_endpoint_env = get_seedance_operation_endpoint_env_key("agent_plan")
    assert api_key_env and plan_key_env and plan_endpoint_env

    monkeypatch.setenv(api_key_env, "test-seedance-key")
    monkeypatch.setenv(plan_key_env, "test-seedance-plan-key")
    monkeypatch.setenv(plan_endpoint_env, SEEDANCE_AGENT_PLAN_ENDPOINT)

    health = [{
        "provider": "seedance",
        "model_name": SEEDANCE_AGENT_PLAN_MODEL_MAP["agent_plan"],
        "status": "ok",
        "health": {
            "ok": True,
            "auth_ok": True,
            "status_code": 200,
            "error": None,
        },
    }]
    statuses = build_provider_runtime_status(provider_health=health)
    status = next(
        item
        for item in statuses
        if item["provider"] == "seedance"
        and item["model_name"] == SEEDANCE_AGENT_PLAN_MODEL_MAP["agent_plan"]
    )

    assert status["runtime_model_name"] == SEEDANCE_AGENT_PLAN_MODEL_MAP["agent_plan"]
    assert status["health_status"] == "ok"
    assert "health_error" not in status["issues"]


def test_minimax_sora2_and_veo_video_alias_helpers_live_in_registry():
    assert minimax_runtime_model_override(None) is None
    assert minimax_runtime_model_override(MINIMAX_DEFAULT_VIDEO_MODEL) is None
    assert normalize_minimax_video_model(None) == MINIMAX_DEFAULT_VIDEO_MODEL
    assert minimax_runtime_model_override("minimax-custom") == "minimax-custom"
    assert normalize_minimax_video_model("minimax-custom") == "minimax-custom"

    assert sora2_runtime_model_override(None) is None
    assert sora2_runtime_model_override(SORA2_DEFAULT_VIDEO_MODEL) is None
    assert sora2_runtime_model_override("sora-2") is None
    assert normalize_sora2_video_model("sora-2") == SORA2_DEFAULT_VIDEO_MODEL
    assert sora2_runtime_model_override("sora2-custom") == "sora2-custom"
    assert normalize_sora2_video_model("sora2-custom") == "sora2-custom"

    assert veo_runtime_model_override(None) is None
    assert veo_runtime_model_override(VEO_DEFAULT_VIDEO_MODEL) is None
    assert veo_runtime_model_override("veo-3.1") is None
    assert normalize_veo_video_model("veo-3") == VEO_DEFAULT_VIDEO_MODEL
    assert veo_runtime_model_override("veo-custom") == "veo-custom"
    assert normalize_veo_video_model("veo-custom") == "veo-custom"


def test_doubao_image_model_alias_helpers_live_in_registry():
    assert normalize_doubao_image_model(None) is None
    assert normalize_doubao_image_model("Doubao-Seedream-5.0-pro") == "doubao-seedream-5-0-pro-260628"
    assert normalize_doubao_image_model("seedream-5-0-pro") == "doubao-seedream-5-0-pro-260628"
    assert normalize_doubao_image_model("Seedream-4.0") == DOUBAO_IMAGE_LEGACY_MODEL
    assert normalize_doubao_image_model("custom-doubao-endpoint") == "custom-doubao-endpoint"


def test_dashscope_vidu_sub_model_helpers_live_in_registry():
    assert dashscope_vidu_reference_sub_model(None) == "vidu-reference-q3"
    assert dashscope_vidu_reference_sub_model("q3-mix") == "vidu-reference-q3-mix"
    assert dashscope_vidu_reference_sub_model("unknown") == "vidu-reference-q3"

    assert dashscope_vidu_startend_sub_model(None) == "vidu-startend-q3-turbo"
    assert dashscope_vidu_startend_sub_model("q3-pro") == "vidu-startend-q3-pro"
    assert dashscope_vidu_startend_sub_model("unknown") == "vidu-startend-q3-turbo"


def test_explicit_model_overrides_runtime_model_env(monkeypatch):
    env_key = get_provider_env_key("gemini-text")
    assert env_key
    model_env = get_model_env_key(env_key)

    monkeypatch.setenv(env_key, "test-key")
    monkeypatch.setenv(model_env, "gemini-runtime-model")

    config = resolve_provider("gemini-text", "gemini-request-model")

    assert config.model_name == "gemini-request-model"
    assert config.model_env == model_env
    assert config.source["model"] == "request"


def test_deepseek_frontend_operations_resolve_to_bound_v4_models(monkeypatch):
    env_key = get_provider_env_key("deepseek")
    assert env_key
    model_env = get_model_env_key(env_key)
    reasoner_env = get_deepseek_operation_model_env_key("deepseek-reasoner")
    chat_env = get_deepseek_operation_model_env_key("deepseek-chat")

    monkeypatch.setenv(env_key, "shared-deepseek-key")
    monkeypatch.setenv(model_env, "deepseek-reasoner")
    monkeypatch.setenv(reasoner_env, "deepseek-v4-pro")
    monkeypatch.setenv(chat_env, "deepseek-v4-flash")

    reasoner = resolve_provider("deepseek", "deepseek-reasoner")
    chat = resolve_provider("deepseek", "deepseek-chat")

    assert reasoner.api_key == chat.api_key == "shared-deepseek-key"
    assert reasoner.model_name == "deepseek-v4-pro"
    assert chat.model_name == "deepseek-v4-flash"
    assert reasoner.model_env == reasoner_env
    assert chat.model_env == chat_env
    assert reasoner.source["model"] == reasoner_env
    assert chat.source["model"] == chat_env


def test_deepseek_frontend_operations_resolve_scoped_studio_model_env(monkeypatch):
    env_key = get_provider_env_key("deepseek")
    assert env_key
    chat_env = get_deepseek_operation_model_env_key("deepseek-chat")
    chat_studio_env = get_scoped_model_env_key(chat_env, "studio")

    monkeypatch.setenv(env_key, "shared-deepseek-key")
    monkeypatch.setenv(chat_env, "deepseek-workflow-chat")
    monkeypatch.setenv(chat_studio_env, "deepseek-studio-chat")

    workflow = resolve_provider("deepseek", "deepseek-chat")
    studio = resolve_provider("deepseek", "deepseek-chat", usage_scope="studio")

    assert workflow.model_name == "deepseek-workflow-chat"
    assert studio.model_name == "deepseek-studio-chat"
    assert studio.model_env == chat_studio_env
    assert studio.source["model_scope"] == "studio"

    monkeypatch.delenv(chat_studio_env)
    studio_fallback = resolve_provider("deepseek", "deepseek-chat", usage_scope="studio")
    assert studio_fallback.model_name == "deepseek-workflow-chat"
    assert studio_fallback.model_env == chat_env


def test_minimax_text_operation_resolves_m3_without_using_video_primary(monkeypatch):
    env_key = get_provider_env_key("minimax")
    assert env_key
    model_env = get_model_env_key(env_key)
    m3_env = get_minimax_operation_model_env_key("minimax-m3")

    monkeypatch.setenv(env_key, "shared-minimax-plan-key")
    monkeypatch.setenv(model_env, MINIMAX_DEFAULT_VIDEO_MODEL)
    monkeypatch.setenv(m3_env, "MiniMax-M3-plan")

    text = resolve_provider("minimax", "minimax-m3")
    video = resolve_provider("minimax", MINIMAX_DEFAULT_VIDEO_MODEL)

    assert text.api_key == video.api_key == "shared-minimax-plan-key"
    assert text.model_name == "MiniMax-M3-plan"
    assert text.model_env == m3_env
    assert text.source["model"] == m3_env
    assert video.model_name == MINIMAX_DEFAULT_VIDEO_MODEL

    monkeypatch.delenv(m3_env)
    assert resolve_provider("minimax", "minimax-m3").model_name == MINIMAX_M3_MODEL


def test_minimax_speech_operation_resolves_scoped_runtime_model_env(monkeypatch):
    env_key = get_provider_env_key("minimax")
    assert env_key
    speech_env = get_minimax_operation_model_env_key("speech-hd")
    speech_studio_env = get_scoped_model_env_key(speech_env, "studio")

    monkeypatch.setenv(env_key, "shared-minimax-key")
    monkeypatch.setenv(speech_env, MINIMAX_TTS_HD_MODEL)
    monkeypatch.setenv(speech_studio_env, "speech-studio-hd")

    assert resolve_provider("minimax", "speech-hd").model_name == MINIMAX_TTS_HD_MODEL
    studio = resolve_provider("minimax", "speech-hd", usage_scope="studio")
    assert studio.model_name == "speech-studio-hd"
    assert studio.model_env == speech_studio_env


def test_minimax_music_operation_defaults_to_music_2_6_and_supports_override(monkeypatch):
    env_key = get_provider_env_key("minimax")
    assert env_key
    music_env = get_minimax_operation_model_env_key("music")

    monkeypatch.setenv(env_key, "shared-minimax-key")
    monkeypatch.delenv(music_env, raising=False)
    assert resolve_provider("minimax", "music").model_name == MINIMAX_MUSIC_MODEL

    monkeypatch.setenv(music_env, "music-01")
    configured = resolve_provider("minimax", "music")
    assert configured.model_name == "music-01"
    assert configured.model_env == music_env


def test_seedance_sub_models_resolve_scoped_runtime_model_env(monkeypatch):
    env_key = get_provider_env_key("seedance")
    assert env_key
    standard_env = get_seedance_sub_model_env_key("standard")
    standard_studio_env = get_scoped_model_env_key(standard_env, "studio")
    mini_env = get_seedance_sub_model_env_key("mini")

    monkeypatch.setenv(env_key, "seedance-key")
    monkeypatch.setenv(standard_env, "doubao-seedance-2-0-260128")
    monkeypatch.setenv(standard_studio_env, "doubao-seedance-2-0-studio")
    monkeypatch.setenv(mini_env, "doubao-seedance-2-0-mini-260615")

    assert resolve_seedance_model_name("standard") == "doubao-seedance-2-0-260128"
    assert resolve_seedance_model_name("standard", usage_scope="studio") == "doubao-seedance-2-0-studio"
    assert resolve_seedance_model_name("mini") == "doubao-seedance-2-0-mini-260615"


class _ImageResponse:
    status_code = 200
    text = ""

    def raise_for_status(self):
        return None

    def json(self):
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "inlineData": {
                                    "mimeType": "image/png",
                                    "data": "aW1hZ2U=",
                                }
                            }
                        ]
                    }
                }
            ]
        }


def test_parse_gemini_image_response_extracts_inline_images():
    images = ai_proxy_service.parse_gemini_image_response(
        {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"text": "ignored"},
                            {
                                "inlineData": {
                                    "mimeType": "image/jpeg",
                                    "data": "anBn",
                                }
                            },
                        ]
                    }
                }
            ]
        }
    )

    assert images == ["data:image/jpeg;base64,anBn"]


def test_parse_gemini_image_response_returns_empty_list_without_inline_data():
    assert (
        ai_proxy_service.parse_gemini_image_response(
            {"candidates": [{"content": {"parts": [{"text": "no image"}]}}]}
        )
        == []
    )


@pytest.mark.asyncio
async def test_gemini_image_uses_runtime_model_env_when_request_omits_model(monkeypatch):
    env_key = get_provider_env_key("gemini-image")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-image-key")
    monkeypatch.setenv(endpoint_env, "https://image-runtime.example.test/v1beta")
    monkeypatch.setenv(model_env, "gemini-runtime-image-model")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _ImageResponse()

    monkeypatch.setattr(ai_proxy_http_client.requests, "post", fake_post)

    images, model = await ai_proxy_service.generate_gemini_images(
        parts=[{"text": "draw"}],
        requested_model=None,
        aspect_ratio="16:9",
        image_size="2K",
    )

    assert images == ["data:image/png;base64,aW1hZ2U="]
    assert model == "gemini-runtime-image-model"
    assert calls[0]["url"] == "https://image-runtime.example.test/v1beta/models/gemini-runtime-image-model:generateContent"
    assert calls[0]["json"]["generationConfig"]["imageConfig"]["aspectRatio"] == "16:9"


@pytest.mark.asyncio
async def test_gemini_image_explicit_request_model_overrides_runtime_model(monkeypatch):
    env_key = get_provider_env_key("gemini-image")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-image-key")
    monkeypatch.setenv(endpoint_env, "https://image-runtime.example.test/v1beta")
    monkeypatch.setenv(model_env, "gemini-runtime-image-model")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _ImageResponse()

    monkeypatch.setattr(ai_proxy_http_client.requests, "post", fake_post)

    images, model = await ai_proxy_service.generate_gemini_images(
        parts=[{"text": "draw"}],
        requested_model="gemini-3-pro-image-preview",
        aspect_ratio="1:1",
        image_size="4K",
    )

    assert images == ["data:image/png;base64,aW1hZ2U="]
    assert model == "gemini-3.1-flash-image-preview"
    assert calls[0]["url"] == "https://image-runtime.example.test/v1beta/models/gemini-3.1-flash-image-preview:generateContent"
    assert calls[0]["json"]["generationConfig"]["imageConfig"]["imageSize"] == "4K"


class _ChatResponse:
    status_code = 200
    text = ""

    def raise_for_status(self):
        return None

    def json(self):
        return {
            "choices": [
                {
                    "message": {
                        "content": '{"description":"shot frame","camera_description":"eye level","motion_description":"slow push"}',
                    }
                }
            ]
        }


class _TextResponse:
    status_code = 200
    text = ""

    def raise_for_status(self):
        return None

    def json(self):
        return {
            "choices": [
                {
                    "message": {
                        "content": "runtime text ok",
                    }
                }
            ]
        }


class _DeepseekResponse:
    status_code = 200
    text = ""

    def json(self):
        return {"choices": [{"message": {"content": "deepseek ok"}}]}


class _DeepseekStreamResponse:
    status_code = 200
    text = ""

    def __init__(self):
        self.closed = False

    def iter_lines(self, decode_unicode=True):
        return iter(
            [
                'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}',
                'data: {"choices":[{"delta":{"content":"stream ok"}}]}',
                "data: [DONE]",
            ]
        )

    def close(self):
        self.closed = True


class _AnthropicStreamResponse(_DeepseekStreamResponse):
    def iter_lines(self, decode_unicode=True):
        return iter(
            [
                'event: message_start',
                'data: {"type":"message_start","message":{"id":"msg_test"}}',
                'event: content_block_delta',
                'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"stream ok"}}',
                'event: message_stop',
                'data: {"type":"message_stop"}',
            ]
        )


class _DoubaoResponse:
    status_code = 200
    text = ""

    def json(self):
        return {"data": [{"b64_json": "ZG91YmFv"}]}


def test_parse_doubao_image_response_extracts_base64_and_urls():
    images = ai_proxy_service.parse_doubao_image_response(
        {
            "data": [
                {"b64_json": "ZG91YmFvLWltYWdl"},
                {"url": "https://cdn.example.test/doubao.png"},
            ]
        }
    )

    assert images == [
        "data:image/png;base64,ZG91YmFvLWltYWdl",
        "https://cdn.example.test/doubao.png",
    ]


def test_parse_doubao_image_response_returns_empty_list_without_images():
    assert ai_proxy_service.parse_doubao_image_response(
        {"data": [{"ignored": True}]}
    ) == []


class _OpenAIImageResponse:
    status_code = 200
    text = ""

    def json(self):
        return {"data": [{"b64_json": "Z3B0LWltYWdl"}]}


def test_parse_openai_image_response_extracts_base64_and_urls():
    images = ai_proxy_service.parse_openai_image_response(
        {
            "data": [
                {"b64_json": "YmFzZTY0LWltYWdl"},
                {"url": "https://cdn.example.test/image.png"},
                {"ignored": True},
            ]
        }
    )

    assert images == [
        "data:image/png;base64,YmFzZTY0LWltYWdl",
        "https://cdn.example.test/image.png",
    ]


def test_parse_openai_image_response_returns_empty_list_without_images():
    assert ai_proxy_service.parse_openai_image_response(
        {"data": [{"ignored": True}]}
    ) == []


class _MinimaxTaskResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"task_id": "minimax-task-1"}


class _MinimaxNestedTaskResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"data": {"task_id": "minimax-nested-task-1"}, "base_resp": {"status_code": 0}}


class _MinimaxBusinessErrorResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "base_resp": {
                "status_code": 1008,
                "status_msg": "insufficient balance",
            },
            "trace_id": "trace-minimax-1",
        }


class _Sora2TaskResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"id": "sora2-video-1"}


class _VeoTaskResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"id": "veo-video-1"}


class _SeedanceTaskResponse:
    ok = True
    status_code = 200
    text = ""

    def raise_for_status(self):
        return None

    def json(self):
        return {"id": "seedance-task-1"}


class _Wan26TaskResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"output": {"task_id": "wan26-task-1", "task_status": "PENDING"}}


@pytest.mark.asyncio
async def test_doubao_image_uses_runtime_model_env_when_request_omits_model(monkeypatch):
    env_key = get_provider_env_key("doubao")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-ark-key")
    monkeypatch.setenv(endpoint_env, "https://doubao-runtime.example.test/api/v3/images/generations")
    monkeypatch.setenv(model_env, "Doubao-Seedream-5.0-pro")

    def fake_post(url, **kwargs):
        kwargs["json"] = json.loads(kwargs["data"].getvalue())
        calls.append({"url": url, **kwargs})
        return _DoubaoResponse()

    monkeypatch.setattr(ai_proxy_http_client.requests, "post", fake_post)

    images = await ai_proxy_service.generate_doubao_images(
        prompt="draw",
        reference_inputs=[],
        size="2K",
        sequential="disabled",
        count=1,
    )

    assert images == ["data:image/png;base64,ZG91YmFv"]
    assert calls[0]["url"] == "https://doubao-runtime.example.test/api/v3/images/generations"
    assert calls[0]["json"]["model"] == "doubao-seedream-5-0-pro-260628"


@pytest.mark.asyncio
async def test_doubao_image_explicit_model_overrides_runtime_model(monkeypatch):
    env_key = get_provider_env_key("doubao")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-ark-key")
    monkeypatch.setenv(endpoint_env, "https://doubao-runtime.example.test/api/v3/images/generations")
    monkeypatch.setenv(model_env, "doubao-runtime-image-model")

    def fake_post(url, **kwargs):
        kwargs["json"] = json.loads(kwargs["data"].getvalue())
        calls.append({"url": url, **kwargs})
        return _DoubaoResponse()

    monkeypatch.setattr(ai_proxy_http_client.requests, "post", fake_post)

    images = await ai_proxy_service.generate_doubao_images(
        prompt="draw",
        reference_inputs=[],
        size="2K",
        sequential="disabled",
        count=1,
        model="doubao-explicit-image-model",
    )

    assert images == ["data:image/png;base64,ZG91YmFv"]
    assert calls[0]["url"] == "https://doubao-runtime.example.test/api/v3/images/generations"
    assert calls[0]["json"]["model"] == "doubao-explicit-image-model"


@pytest.mark.asyncio
async def test_gpt_image_generation_uses_runtime_endpoint(monkeypatch):
    env_key = get_provider_env_key("laozhang-gpt-image")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-gpt-image-key")
    monkeypatch.setenv(endpoint_env, "https://gpt-image-runtime.example.test/v1")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _OpenAIImageResponse()

    monkeypatch.setattr(ai_proxy_http_client.requests, "post", fake_post)

    images, model, tier = await ai_proxy_service.generate_gpt_images(
        tier="vip",
        prompt="draw",
        references=[],
        n=2,
        size="1024x1024",
        quality="high",
    )

    assert images == ["data:image/png;base64,Z3B0LWltYWdl"]
    assert model == "gpt-image-2-vip"
    assert tier == "vip"
    assert calls[0]["url"] == "https://gpt-image-runtime.example.test/v1/images/generations"
    assert calls[0]["headers"]["Authorization"] == "Bearer test-gpt-image-key"
    assert calls[0]["json"]["model"] == "gpt-image-2-vip"
    assert calls[0]["json"]["size"] == "1024x1024"


@pytest.mark.asyncio
async def test_gpt_image_edit_uses_runtime_endpoint(monkeypatch):
    env_key = get_provider_env_key("laozhang-sora2")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-official-gpt-image-key")
    monkeypatch.setenv(endpoint_env, "https://official-gpt-image-runtime.example.test/v1")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _OpenAIImageResponse()

    monkeypatch.setattr(ai_proxy_http_client.requests, "post", fake_post)

    images, model, tier = await ai_proxy_service.generate_gpt_images(
        tier="official",
        prompt="edit",
        references=[
            GptImageReferenceInput(
                filename="reference.png",
                content=b"image-bytes",
                mime_type="image/png",
            )
        ],
        n=1,
        size="auto",
        quality="auto",
    )

    assert images == ["data:image/png;base64,Z3B0LWltYWdl"]
    assert model == "gpt-image-2"
    assert tier == "official"
    assert calls[0]["url"] == "https://official-gpt-image-runtime.example.test/v1/images/edits"
    assert calls[0]["headers"]["Authorization"] == "Bearer test-official-gpt-image-key"
    assert calls[0]["data"]["model"] == "gpt-image-2"
    assert calls[0]["files"][0][0] == "image[]"
    assert calls[0]["files"][0][1][0] == "reference.png"
    assert calls[0]["files"][0][1][2] == "image/png"


def test_minimax_video_uses_runtime_model_when_worker_passes_legacy_default(monkeypatch):
    env_key = get_provider_env_key("minimax")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-minimax-key")
    monkeypatch.setenv(endpoint_env, "https://minimax-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "minimax-runtime-video-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _MinimaxTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = minimax_video.MinimaxClient()
    result = client.generate_video(
        first_frame_image="https://cdn.example.test/frame.png",
        prompt="move gently",
        model=minimax_video.DEFAULT_MINIMAX_VIDEO_MODEL,
    )

    assert result == {"task_id": "minimax-task-1"}
    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://minimax-runtime.example.test/v1/video_generation"
    assert calls[0]["json"]["model"] == "minimax-runtime-video-model"


def test_minimax_video_explicit_non_default_model_overrides_runtime_model(monkeypatch):
    env_key = get_provider_env_key("minimax")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-minimax-key")
    monkeypatch.setenv(endpoint_env, "https://minimax-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "minimax-runtime-video-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _MinimaxTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = minimax_video.MinimaxClient()
    client.generate_video(
        first_frame_image="https://cdn.example.test/frame.png",
        prompt="move gently",
        model="minimax-explicit-video-model",
    )

    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://minimax-runtime.example.test/v1/video_generation"
    assert calls[0]["json"]["model"] == "minimax-explicit-video-model"


def test_minimax_video_rejects_unsupported_duration_before_provider_call(monkeypatch):
    env_key = get_provider_env_key("minimax")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-minimax-key")
    monkeypatch.setenv(endpoint_env, "https://minimax-runtime.example.test/v1")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _MinimaxNestedTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = minimax_video.MinimaxClient()
    with pytest.raises(ValueError, match="6 秒或 10 秒"):
        client.generate_video(
            first_frame_image="https://cdn.example.test/frame.png",
            prompt="move gently",
            duration=3,
        )

    assert calls == []


def test_minimax_video_enforces_supported_resolution_duration_pair(monkeypatch):
    env_key = get_provider_env_key("minimax")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-minimax-key")
    monkeypatch.setenv(endpoint_env, "https://minimax-runtime.example.test/v1")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _MinimaxTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = minimax_video.MinimaxClient()
    with pytest.raises(ValueError, match="1080P 仅支持 6 秒"):
        client.generate_video(
            first_frame_image="https://cdn.example.test/frame.png",
            prompt="move gently",
            duration=10,
            resolution="1080P",
            prompt_optimizer=False,
        )

    assert calls == []


def test_minimax_video_business_error_is_actionable(monkeypatch):
    env_key = get_provider_env_key("minimax")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)

    monkeypatch.setenv(env_key, "test-minimax-key")
    monkeypatch.setenv(endpoint_env, "https://minimax-runtime.example.test/v1")

    def fake_request(method, url, **kwargs):
        return _MinimaxBusinessErrorResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = minimax_video.MinimaxClient()
    with pytest.raises(RuntimeError) as exc:
        client.generate_video(
            first_frame_image="https://cdn.example.test/frame.png",
            prompt="move gently",
        )

    message = str(exc.value)
    assert "MiniMax create failed" in message
    assert "status_code=1008" in message
    assert "insufficient balance" in message
    assert "trace-minimax-1" in message


def test_minimax_video_ignores_runtime_audio_model(monkeypatch):
    env_key = get_provider_env_key("minimax")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-minimax-key")
    monkeypatch.setenv(endpoint_env, "https://minimax-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "speech-2.8-hd")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _MinimaxTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = minimax_video.MinimaxClient()
    client.generate_video(
        first_frame_image="https://cdn.example.test/frame.png",
        prompt="move gently",
    )

    assert calls[0]["json"]["model"] == MINIMAX_DEFAULT_VIDEO_MODEL


def test_sora2_video_uses_runtime_model_env_when_request_omits_model(monkeypatch):
    env_key = get_provider_env_key("sora2")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-sora2-key")
    monkeypatch.setenv(endpoint_env, "https://sora2-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "sora2-runtime-video-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _Sora2TaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = sora2_video.Sora2Client()
    result = client.create_video_task(prompt="move gently")

    assert result == {"id": "sora2-video-1"}
    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://sora2-runtime.example.test/v1/videos"
    assert calls[0]["json"]["model"] == "sora2-runtime-video-model"


def test_sora2_video_explicit_non_default_model_overrides_runtime_model(monkeypatch):
    env_key = get_provider_env_key("sora2")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-sora2-key")
    monkeypatch.setenv(endpoint_env, "https://sora2-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "sora2-runtime-video-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _Sora2TaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = sora2_video.Sora2Client()
    client.create_video_task(
        prompt="move gently",
        model="sora2-explicit-video-model",
    )

    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://sora2-runtime.example.test/v1/videos"
    assert calls[0]["json"]["model"] == "sora2-explicit-video-model"


def test_sora2_video_legacy_model_env_maps_to_callable_default(monkeypatch):
    env_key = get_provider_env_key("sora2")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-sora2-key")
    monkeypatch.setenv(endpoint_env, "https://sora2-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "sora-2")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _Sora2TaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = sora2_video.Sora2Client()
    client.create_video_task(prompt="move gently")

    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://sora2-runtime.example.test/v1/videos"
    assert calls[0]["json"]["model"] == sora2_video.DEFAULT_SORA2_VIDEO_MODEL


def test_sora2_image_video_uses_shared_multipart_helper(monkeypatch, tmp_path):
    env_key = get_provider_env_key("sora2")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    image_path = tmp_path / "frame.png"
    image_path.write_bytes(b"fake-png")
    calls = []

    monkeypatch.setenv(env_key, "test-sora2-key")
    monkeypatch.setenv(endpoint_env, "https://sora2-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "sora2-runtime-video-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _Sora2TaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = sora2_video.Sora2Client()
    result = client.create_video_task(prompt="move gently", image_path=str(image_path))

    assert result == {"id": "sora2-video-1"}
    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://sora2-runtime.example.test/v1/videos"
    assert calls[0]["headers"]["Authorization"] == "Bearer test-sora2-key"
    assert calls[0]["data"]["model"] == "sora2-runtime-video-model"
    assert calls[0]["data"]["prompt"] == "move gently"
    assert calls[0]["files"]["input_reference"][0] == "image.png"
    assert calls[0]["files"]["input_reference"][2] == "image/png"


def test_veo_video_uses_runtime_model_env_when_request_omits_model(monkeypatch):
    env_key = get_provider_env_key("veo")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-veo-key")
    monkeypatch.setenv(endpoint_env, "https://veo-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "veo-runtime-video-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _VeoTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = veo_video.VeoClient()
    result = client.create_video_task(prompt="move gently")

    assert result == {"id": "veo-video-1"}
    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://veo-runtime.example.test/v1/chat/completions"
    assert calls[0]["json"]["model"] == "veo-runtime-video-model"


def test_veo_video_explicit_non_default_model_overrides_runtime_model(monkeypatch):
    env_key = get_provider_env_key("veo")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-veo-key")
    monkeypatch.setenv(endpoint_env, "https://veo-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "veo-runtime-video-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _VeoTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = veo_video.VeoClient()
    client.create_video_task(
        prompt="move gently",
        model="veo-explicit-video-model",
    )

    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://veo-runtime.example.test/v1/chat/completions"
    assert calls[0]["json"]["model"] == "veo-explicit-video-model"


def test_veo_video_legacy_model_env_maps_to_callable_default(monkeypatch):
    env_key = get_provider_env_key("veo")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-veo-key")
    monkeypatch.setenv(endpoint_env, "https://veo-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "veo-3.1")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _VeoTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = veo_video.VeoClient()
    client.create_video_task(prompt="move gently")

    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://veo-runtime.example.test/v1/chat/completions"
    assert calls[0]["json"]["model"] == veo_video.DEFAULT_VEO_VIDEO_MODEL


def test_seedance_video_uses_standard_sub_model_runtime_env(monkeypatch):
    env_key = get_provider_env_key("seedance")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    standard_env = get_seedance_sub_model_env_key("standard")
    standard_key_env = get_seedance_operation_api_key_env_key("standard")
    standard_endpoint_env = get_seedance_operation_endpoint_env_key("standard")
    calls = []

    monkeypatch.setenv(env_key, "test-seedance-key")
    monkeypatch.setenv(endpoint_env, "https://seedance-runtime.example.test/tasks")
    monkeypatch.setenv(standard_key_env, "test-seedance-standard-key")
    monkeypatch.setenv(standard_endpoint_env, "https://seedance-runtime.example.test/tasks")
    monkeypatch.setenv(standard_env, "seedance-standard-runtime-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _SeedanceTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = seedance_video.SeedanceClient()
    task_id = client.create_video_task("standard", [{"type": "text", "text": "move gently"}])

    assert task_id == "seedance-task-1"
    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://seedance-runtime.example.test/tasks"
    assert calls[0]["json"]["model"] == "seedance-standard-runtime-model"


def test_seedance_video_uses_fast_sub_model_runtime_env(monkeypatch):
    env_key = get_provider_env_key("seedance")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    fast_env = get_seedance_sub_model_env_key("fast")
    fast_key_env = get_seedance_operation_api_key_env_key("fast")
    fast_endpoint_env = get_seedance_operation_endpoint_env_key("fast")
    calls = []

    monkeypatch.setenv(env_key, "test-seedance-key")
    monkeypatch.setenv(endpoint_env, "https://seedance-runtime.example.test/tasks")
    monkeypatch.setenv(fast_key_env, "test-seedance-fast-key")
    monkeypatch.setenv(fast_endpoint_env, "https://seedance-runtime.example.test/tasks")
    monkeypatch.setenv(fast_env, "seedance-fast-runtime-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _SeedanceTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = seedance_video.SeedanceClient()
    task_id = client.create_video_task("fast", [{"type": "text", "text": "move gently"}])

    assert task_id == "seedance-task-1"
    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://seedance-runtime.example.test/tasks"
    assert calls[0]["json"]["model"] == "seedance-fast-runtime-model"


def test_seedance_video_uses_mini_sub_model_runtime_env(monkeypatch):
    env_key = get_provider_env_key("seedance")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    mini_env = get_seedance_sub_model_env_key("mini")
    mini_key_env = get_seedance_operation_api_key_env_key("mini")
    mini_endpoint_env = get_seedance_operation_endpoint_env_key("mini")
    calls = []

    monkeypatch.setenv(env_key, "test-seedance-key")
    monkeypatch.setenv(endpoint_env, "https://seedance-runtime.example.test/tasks")
    monkeypatch.setenv(mini_key_env, "test-seedance-mini-key")
    monkeypatch.setenv(mini_endpoint_env, "https://seedance-runtime.example.test/tasks")
    monkeypatch.setenv(mini_env, "seedance-mini-runtime-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _SeedanceTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = seedance_video.SeedanceClient()
    task_id = client.create_video_task("mini", [{"type": "text", "text": "move gently"}])

    assert task_id == "seedance-task-1"
    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://seedance-runtime.example.test/tasks"
    assert calls[0]["json"]["model"] == "seedance-mini-runtime-model"


def test_seedance_video_uses_callable_default_when_runtime_model_missing(monkeypatch):
    env_key = get_provider_env_key("seedance")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    standard_key_env = get_seedance_operation_api_key_env_key("standard")
    standard_endpoint_env = get_seedance_operation_endpoint_env_key("standard")
    calls = []

    monkeypatch.setenv(env_key, "test-seedance-key")
    monkeypatch.setenv(endpoint_env, "https://seedance-runtime.example.test/tasks")
    monkeypatch.setenv(standard_key_env, "test-seedance-standard-key")
    monkeypatch.setenv(standard_endpoint_env, "https://seedance-runtime.example.test/tasks")
    monkeypatch.delenv(model_env, raising=False)
    monkeypatch.delenv(get_seedance_sub_model_env_key("standard"), raising=False)
    monkeypatch.delenv(get_seedance_sub_model_env_key("fast"), raising=False)
    monkeypatch.delenv(get_seedance_sub_model_env_key("mini"), raising=False)

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _SeedanceTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = seedance_video.SeedanceClient()
    client.create_video_task("standard", [{"type": "text", "text": "move gently"}])

    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://seedance-runtime.example.test/tasks"
    assert calls[0]["json"]["model"] == SEEDANCE_DEFAULT_MODEL_MAP["standard"]


def test_seedance_agent_plan_expands_endpoint_and_uses_plan_model(monkeypatch):
    env_key = get_provider_env_key("seedance")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    plan_env = get_seedance_sub_model_env_key("agent_plan")
    plan_key_env = get_seedance_operation_api_key_env_key("agent_plan")
    plan_endpoint_env = get_seedance_operation_endpoint_env_key("agent_plan")
    calls = []

    monkeypatch.setenv(env_key, "test-agent-plan-key")
    monkeypatch.setenv(endpoint_env, "https://ark.cn-beijing.volces.com/api/plan/")
    monkeypatch.setenv(plan_key_env, "test-agent-plan-key")
    monkeypatch.setenv(plan_endpoint_env, "https://ark.cn-beijing.volces.com/api/plan/")
    monkeypatch.setenv(plan_env, SEEDANCE_AGENT_PLAN_MODEL_MAP["agent_plan"])

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _SeedanceTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = seedance_video.SeedanceClient()
    task_id = client.create_video_task("agent_plan", [{"type": "text", "text": "move gently"}])
    client.query_task(task_id)

    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == SEEDANCE_AGENT_PLAN_ENDPOINT
    assert calls[0]["json"]["model"] == SEEDANCE_AGENT_PLAN_MODEL_MAP["agent_plan"]
    assert calls[1]["method"] == "GET"
    assert calls[1]["url"] == f"{SEEDANCE_AGENT_PLAN_ENDPOINT}/{task_id}"


def test_wan26_video_uses_runtime_sub_model_env(monkeypatch):
    env_key = get_provider_env_key("dashscope")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    wan26_env = get_dashscope_sub_model_env_key("wan26")
    calls = []

    monkeypatch.setenv(env_key, "test-dashscope-key")
    monkeypatch.setenv(
        endpoint_env,
        "https://dashscope-runtime.example.test/api/v1/services/aigc/video-generation/video-synthesis",
    )
    monkeypatch.setenv(wan26_env, "wan2.6-runtime-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _Wan26TaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = wan2_video.Wan26Client()
    result = client.create_video_task(prompt="move gently", img_url="https://cdn.example.test/frame.png")

    assert result["output"]["task_id"] == "wan26-task-1"
    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://dashscope-runtime.example.test/api/v1/services/aigc/video-generation/video-synthesis"
    assert calls[0]["json"]["model"] == "wan2.6-runtime-model"


def test_wan26_video_uses_callable_default_when_runtime_model_missing(monkeypatch):
    env_key = get_provider_env_key("dashscope")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-dashscope-key")
    monkeypatch.setenv(
        endpoint_env,
        "https://dashscope-runtime.example.test/api/v1/services/aigc/video-generation/video-synthesis",
    )
    monkeypatch.delenv(model_env, raising=False)
    monkeypatch.delenv(get_dashscope_sub_model_env_key("wan26"), raising=False)

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _Wan26TaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = wan2_video.Wan26Client()
    client.create_video_task(prompt="move gently", img_url="https://cdn.example.test/frame.png")

    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://dashscope-runtime.example.test/api/v1/services/aigc/video-generation/video-synthesis"
    assert calls[0]["json"]["model"] == DASHSCOPE_DEFAULT_MODEL_MAP["wan26"]


def test_dashscope_kling_ignores_unrelated_generic_model_env(monkeypatch):
    env_key = get_provider_env_key("dashscope")
    assert env_key
    model_env = get_model_env_key(env_key)

    monkeypatch.setenv(model_env, "wan2.6-runtime-i2v")
    monkeypatch.delenv(get_dashscope_sub_model_env_key("kling-standard"), raising=False)

    assert resolve_dashscope_model_name("kling-standard") == DASHSCOPE_DEFAULT_MODEL_MAP["kling-standard"]


def test_dashscope_vidu_ignores_unrelated_generic_model_env(monkeypatch):
    env_key = get_provider_env_key("dashscope")
    assert env_key
    model_env = get_model_env_key(env_key)

    monkeypatch.setenv(model_env, DASHSCOPE_DEFAULT_MODEL_MAP["happyhorse"])
    monkeypatch.delenv(get_dashscope_sub_model_env_key("vidu-reference-q3"), raising=False)

    assert resolve_dashscope_model_name("vidu-reference-q3") == DASHSCOPE_DEFAULT_MODEL_MAP["vidu-reference-q3"]


def test_dashscope_default_model_name_resolves_through_sub_model_runtime_env(monkeypatch):
    vidu_env = get_dashscope_sub_model_env_key("vidu-reference-q3")
    monkeypatch.setenv(vidu_env, "vidu-reference-runtime-model")

    assert (
        resolve_dashscope_default_model_name(DASHSCOPE_DEFAULT_MODEL_MAP["vidu-reference-q3"])
        == "vidu-reference-runtime-model"
    )
    assert resolve_dashscope_default_model_name("custom-dashscope-model") == "custom-dashscope-model"


def test_deepseek_generate_text_uses_runtime_model_env_when_request_omits_model(monkeypatch):
    env_key = get_provider_env_key("deepseek")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-deepseek-key")
    monkeypatch.setenv(endpoint_env, "https://deepseek-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "deepseek-runtime-model")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _DeepseekResponse()

    monkeypatch.setattr(ai_proxy_http_client.requests, "post", fake_post)

    result = ai_proxy_service.generate_deepseek_text(prompt="hello")

    assert result == "deepseek ok"
    assert calls[0]["url"] == "https://deepseek-runtime.example.test/v1/chat/completions"
    assert calls[0]["json"]["model"] == "deepseek-runtime-model"
    assert calls[0]["json"]["messages"] == [
        {"role": "system", "content": ai_proxy_service.DEEPSEEK_SYSTEM_PROMPT},
        {"role": "user", "content": "hello"},
    ]
    assert calls[0]["json"]["stream"] is False


def test_deepseek_generate_text_explicit_model_overrides_runtime_model(monkeypatch):
    env_key = get_provider_env_key("deepseek")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-deepseek-key")
    monkeypatch.setenv(endpoint_env, "https://deepseek-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "deepseek-runtime-model")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _DeepseekResponse()

    monkeypatch.setattr(ai_proxy_http_client.requests, "post", fake_post)

    result = ai_proxy_service.generate_deepseek_text(
        prompt="hello",
        response_format="json",
        model="deepseek-chat",
    )

    assert result == "deepseek ok"
    assert calls[0]["url"] == "https://deepseek-runtime.example.test/v1/chat/completions"
    assert calls[0]["json"]["model"] == "deepseek-v4-flash"
    assert calls[0]["json"]["thinking"] == {"type": "disabled"}
    assert calls[0]["json"]["response_format"] == {"type": "json_object"}


def test_deepseek_stream_uses_shared_runtime_request(monkeypatch):
    env_key = get_provider_env_key("deepseek")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []
    completed = []
    response = _DeepseekStreamResponse()

    monkeypatch.setenv(env_key, "test-deepseek-key")
    monkeypatch.setenv(endpoint_env, "https://deepseek-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "deepseek-stream-runtime-model")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return response

    monkeypatch.setattr(ai_proxy_http_client.requests, "post", fake_post)

    events = list(ai_proxy_service.stream_deepseek_chat(prompt="hello", on_complete=completed.append))

    assert calls[0]["url"] == "https://deepseek-runtime.example.test/v1/chat/completions"
    assert calls[0]["json"]["model"] == "deepseek-stream-runtime-model"
    assert calls[0]["json"]["stream"] is True
    assert calls[0]["stream"] is True
    assert calls[0]["headers"]["Authorization"] == "Bearer test-deepseek-key"
    assert any('"type": "reasoning"' in event for event in events)
    assert any('"content": "stream ok"' in event for event in events)
    assert events[-1] == "data: [DONE]\n\n"
    assert completed == ["stream ok"]
    assert response.closed is True


def test_deepseek_stream_reports_empty_result_as_failure(monkeypatch):
    env_key = get_provider_env_key("deepseek")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    failures = []
    response = _DeepseekStreamResponse()
    response.iter_lines = lambda decode_unicode=True: iter(["data: [DONE]"])

    monkeypatch.setenv(env_key, "test-deepseek-key")
    monkeypatch.setenv(endpoint_env, "https://deepseek-runtime.example.test/v1")
    monkeypatch.setattr(ai_proxy_http_client.requests, "post", lambda *args, **kwargs: response)

    events = list(ai_proxy_service.stream_deepseek_chat(prompt="hello", on_error=failures.append))

    assert events[-1] == "data: [DONE]\n\n"
    assert failures == ["DeepSeek 返回空内容"]
    assert response.closed is True


def test_minimax_m3_stream_uses_token_plan_compatible_runtime_request(monkeypatch):
    env_key = get_provider_env_key("minimax")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    m3_env = get_minimax_operation_model_env_key("minimax-m3")
    calls = []
    completed = []
    response = _AnthropicStreamResponse()

    monkeypatch.setenv(env_key, "test-minimax-plan-key")
    monkeypatch.setenv(endpoint_env, "https://api.minimaxi.com/v1")
    monkeypatch.setenv(m3_env, "MiniMax-M3")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return response

    monkeypatch.setattr(ai_proxy_http_client.requests, "post", fake_post)

    events = list(
        ai_proxy_service.stream_minimax_chat(
            prompt="hello",
            model="minimax-m3",
            on_complete=completed.append,
        )
    )

    assert calls[0]["url"] == "https://api.minimaxi.com/anthropic/v1/messages"
    assert calls[0]["headers"]["X-Api-Key"] == "test-minimax-plan-key"
    assert calls[0]["headers"]["Anthropic-Version"] == "2023-06-01"
    assert calls[0]["json"]["model"] == "MiniMax-M3"
    assert calls[0]["json"]["thinking"] == {"type": "disabled"}
    assert calls[0]["json"]["max_tokens"] == 16384
    assert calls[0]["json"]["system"] == ai_proxy_service.MINIMAX_SYSTEM_PROMPT
    assert calls[0]["json"]["messages"] == [{"role": "user", "content": "hello"}]
    assert calls[0]["json"]["stream"] is True
    assert any('"content": "stream ok"' in event for event in events)
    assert events[-1] == "data: [DONE]\n\n"
    assert completed == ["stream ok"]
    assert response.closed is True


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://api.minimaxi.com/v1",
        "https://api.minimaxi.com/anthropic",
        "https://api.minimaxi.com/anthropic/v1",
        "https://api.minimaxi.com/anthropic/v1/messages",
    ],
)
def test_minimax_m3_anthropic_endpoint_normalization(endpoint):
    assert ai_proxy_minimax_text_service.minimax_anthropic_messages_url(endpoint) == (
        "https://api.minimaxi.com/anthropic/v1/messages"
    )


def test_minimax_m3_stream_sends_keepalive_while_waiting_for_first_upstream_byte(monkeypatch):
    env_key = get_provider_env_key("minimax")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    m3_env = get_minimax_operation_model_env_key("minimax-m3")
    request_started = threading.Event()
    release_request = threading.Event()
    response = _AnthropicStreamResponse()

    monkeypatch.setenv(env_key, "test-minimax-plan-key")
    monkeypatch.setenv(endpoint_env, "https://api.minimaxi.com/v1")
    monkeypatch.setenv(m3_env, "MiniMax-M3")
    monkeypatch.setattr(ai_proxy_minimax_text_service, "MINIMAX_KEEPALIVE_SECONDS", 0.01)

    def fake_post(*args, **kwargs):
        request_started.set()
        assert release_request.wait(timeout=1)
        return response

    monkeypatch.setattr(ai_proxy_http_client.requests, "post", fake_post)
    stream = ai_proxy_service.stream_minimax_chat(prompt="hello", model="minimax-m3")

    assert next(stream) == ": connected\n\n"
    assert request_started.wait(timeout=0.5)
    assert next(stream) == ": keepalive\n\n"
    release_request.set()
    remaining = list(stream)

    assert any('"content": "stream ok"' in event for event in remaining)
    assert remaining[-1] == "data: [DONE]\n\n"
    assert response.closed is True


def test_minimax_m3_stream_does_not_complete_after_a_partial_upstream_failure(monkeypatch):
    env_key = get_provider_env_key("minimax")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    m3_env = get_minimax_operation_model_env_key("minimax-m3")
    completed = []
    failures = []
    response = _AnthropicStreamResponse()

    def broken_lines(decode_unicode=True):
        yield 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}'
        raise RuntimeError("upstream disconnected")

    response.iter_lines = broken_lines
    monkeypatch.setenv(env_key, "test-minimax-plan-key")
    monkeypatch.setenv(endpoint_env, "https://api.minimaxi.com/v1")
    monkeypatch.setenv(m3_env, "MiniMax-M3")
    monkeypatch.setattr(ai_proxy_http_client.requests, "post", lambda *args, **kwargs: response)

    events = list(ai_proxy_service.stream_minimax_chat(
        prompt="hello",
        model="minimax-m3",
        on_complete=completed.append,
        on_error=failures.append,
    ))

    assert any('"content": "partial"' in event for event in events)
    assert any('"type": "error"' in event for event in events)
    assert completed == []
    assert failures == ["MiniMax 流式读取失败: upstream disconnected"]
    assert response.closed is True


def test_gemini_text_stream_uses_shared_runtime_request(monkeypatch):
    env_key = get_provider_env_key("gemini-text")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []
    completed = []
    response = _DeepseekStreamResponse()

    monkeypatch.setenv(env_key, "test-gemini-key")
    monkeypatch.setenv(endpoint_env, "https://text-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "gemini-stream-runtime-model")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return response

    monkeypatch.setattr(ai_proxy_http_client.requests, "post", fake_post)

    events = list(
        ai_proxy_service.stream_gemini_text(
            prompt="hello",
            system_prompt="system",
            temperature=0.4,
            on_complete=completed.append,
        )
    )

    assert calls[0]["url"] == "https://text-runtime.example.test/v1/chat/completions"
    assert calls[0]["headers"]["Authorization"] == "Bearer test-gemini-key"
    assert calls[0]["json"]["model"] == "gemini-stream-runtime-model"
    assert calls[0]["json"]["stream"] is True
    assert calls[0]["json"]["messages"] == [
        {"role": "system", "content": "system"},
        {"role": "user", "content": "hello"},
    ]
    assert any('"content": "stream ok"' in event for event in events)
    assert events[-1] == "data: [DONE]\n\n"
    assert completed == ["stream ok"]
    assert response.closed is True


@pytest.mark.asyncio
async def test_gemini_text_stream_resolver_preserves_provider_failover(monkeypatch):
    env_key = get_provider_env_key("deepseek")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    monkeypatch.setenv(env_key, "fallback-deepseek-key")
    monkeypatch.setenv(endpoint_env, "https://fallback.example.test/v1")
    fallback_config = resolve_provider("deepseek", "deepseek-chat")

    async def fake_resolve(provider, model=None, usage_scope=None):
        assert provider == "gemini-text"
        assert usage_scope is None
        return fallback_config, {
            "active": True,
            "requested_provider": "gemini-text",
            "selected_provider": "deepseek",
        }

    monkeypatch.setattr(
        ai_proxy_gemini_text_service,
        "resolve_ai_proxy_provider",
        fake_resolve,
    )

    resolved = await ai_proxy_service.resolve_gemini_stream_config()

    assert resolved.provider == "deepseek"
    assert resolved.api_key == "fallback-deepseek-key"
    assert resolved.endpoint == "https://fallback.example.test/v1"


@pytest.mark.asyncio
async def test_gemini_text_result_uses_shared_runtime_chat_completion(monkeypatch):
    env_key = get_provider_env_key("gemini-text")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-text-key")
    monkeypatch.setenv(endpoint_env, "https://text-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "gemini-shared-runtime-model")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _TextResponse()

    monkeypatch.setattr(ai_proxy_http_client.requests, "post", fake_post)

    result = await ai_proxy_service.generate_gemini_text_result(
        prompt="hello",
        system_prompt="system",
        temperature=0.4,
    )

    assert result.content == "runtime text ok"
    assert result.model_name == "gemini-shared-runtime-model"
    assert calls[0]["url"] == "https://text-runtime.example.test/v1/chat/completions"
    assert calls[0]["json"]["model"] == "gemini-shared-runtime-model"
    assert calls[0]["json"]["temperature"] == 0.4
    assert calls[0]["json"]["messages"] == [
        {"role": "system", "content": "system"},
        {"role": "user", "content": "hello"},
    ]


@pytest.mark.asyncio
async def test_gemini_chat_result_uses_shared_runtime_chat_completion(monkeypatch):
    env_key = get_provider_env_key("gemini-text")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []
    messages = [{"role": "user", "content": [{"type": "text", "text": "describe"}]}]

    monkeypatch.setenv(env_key, "test-text-key")
    monkeypatch.setenv(endpoint_env, "https://chat-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "gemini-chat-runtime-model")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _TextResponse()

    monkeypatch.setattr(ai_proxy_http_client.requests, "post", fake_post)

    result = await ai_proxy_service.generate_gemini_chat_result(
        messages=messages,
        temperature=0.6,
        allow_failover=False,
        label="Gemini shared chat",
    )

    assert result.content == "runtime text ok"
    assert result.model_name == "gemini-chat-runtime-model"
    assert calls[0]["url"] == "https://chat-runtime.example.test/v1/chat/completions"
    assert calls[0]["json"] == {
        "model": "gemini-chat-runtime-model",
        "messages": messages,
        "temperature": 0.6,
    }


@pytest.mark.asyncio
async def test_video_reverse_uses_runtime_gemini_text_model(monkeypatch, tmp_path):
    env_key = get_provider_env_key("gemini-text")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    frame = tmp_path / "frame.jpg"
    frame.write_bytes(b"fake-jpeg")
    calls = []

    monkeypatch.setenv(env_key, "test-text-key")
    monkeypatch.setenv(endpoint_env, "https://text-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "gemini-video-reverse-runtime-model")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _ChatResponse()

    monkeypatch.setattr("requests.post", fake_post)

    result = await video_reverse_service.analyze_segment_frames([str(frame)])

    assert result["description"] == "shot frame"
    assert result["script_text"] == "shot frame"
    assert result["storyboard_description"] == "shot frame"
    assert result["shot_design"] == "shot frame"
    assert calls[0]["url"] == "https://text-runtime.example.test/v1/chat/completions"
    assert calls[0]["json"]["model"] == "gemini-video-reverse-runtime-model"
    assert calls[0]["json"]["temperature"] == 0.3
    assert calls[0]["json"]["messages"][0]["content"][0]["type"] == "text"
    assert calls[0]["json"]["messages"][0]["content"][1]["type"] == "image_url"
