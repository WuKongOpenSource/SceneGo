import json

from services.api_config_health_service import (
    ProviderHealthNotFound,
    _has_chat_content,
    _headers_for_generation,
    _minimax_error_from_payload,
    _real_generation_request,
    _real_generation_response_ok,
    api_config_health_urls,
    test_api_config_real_generation as run_api_config_real_generation,
)
from services.api_provider_registry import DOUBAO_IMAGE_AGENT_PLAN_MODEL

import pytest


def test_chat_generation_accepts_deepseek_reasoning_content() -> None:
    payload = {
        "choices": [
            {
                "message": {
                    "content": "",
                    "reasoning_content": "The requested answer is ok.",
                }
            }
        ]
    }

    assert _has_chat_content(payload) is True


def test_chat_generation_rejects_empty_message() -> None:
    payload = {
        "choices": [
            {"message": {"content": "", "reasoning_content": ""}}
        ]
    }

    assert _has_chat_content(payload) is False


def test_deepseek_reasoner_generation_test_allows_reasoning_budget() -> None:
    url, body, output_type = _real_generation_request(
        "deepseek",
        {
            "endpoint": "https://api.deepseek.com",
            "model_name": "deepseek-reasoner",
        },
    )

    assert url == "https://api.deepseek.com/chat/completions"
    assert body["model"] == "deepseek-v4-pro"
    assert body["thinking"] == {"type": "enabled"}
    assert body["max_tokens"] == 64
    assert body["stream"] is False
    assert output_type == "text"


def test_deepseek_chat_generation_test_migrates_legacy_model_alias() -> None:
    _, body, output_type = _real_generation_request(
        "deepseek",
        {
            "endpoint": "https://api.deepseek.com",
            "model_name": "deepseek-chat",
        },
    )

    assert body["model"] == "deepseek-v4-flash"
    assert body["thinking"] == {"type": "disabled"}
    assert body["max_tokens"] == 32
    assert output_type == "text"


def test_gemini_text_real_generation_uses_stable_probe_prompt() -> None:
    url, body, output_type = _real_generation_request(
        "gemini-text",
        {
            "endpoint": "https://api.laozhang.ai/v1",
            "model_name": "gemini-2.5-flash",
        },
    )

    assert url == "https://api.laozhang.ai/v1/chat/completions"
    assert body["model"] == "gemini-2.5-flash"
    assert body["messages"] == [{"role": "user", "content": "Please reply with the word OK only."}]
    assert body["stream"] is False
    assert body["max_tokens"] == 32
    assert output_type == "text"


def test_minimax_m3_real_generation_uses_low_cost_text_probe() -> None:
    url, body, output_type = _real_generation_request(
        "minimax",
        {
            "endpoint": "https://api.minimaxi.com/v1",
            "model_name": "MiniMax-Hailuo-2.3",
            "model_bindings": [
                {
                    "operation": "video-standard",
                    "label": "金丹 (Hailuo 2.3)",
                    "model_name": "MiniMax-Hailuo-2.3",
                },
                {
                    "operation": "minimax-m3",
                    "label": "练气 (MiniMax M3 文本)",
                    "model_name": "MiniMax-M3",
                },
            ],
            "category": "text",
        },
    )

    assert url == "https://api.minimaxi.com/anthropic/v1/messages"
    assert body["model"] == "MiniMax-M3"
    assert body["thinking"] == {"type": "disabled"}
    assert body["max_tokens"] == 32
    assert body["messages"] == [{"role": "user", "content": "Please reply with the word OK only."}]
    assert body["stream"] is False
    assert output_type == "text"


def test_minimax_real_generation_defaults_to_text_binding_when_category_is_omitted() -> None:
    _, body, output_type = _real_generation_request(
        "minimax",
        {
            "endpoint": "https://api.minimaxi.com/v1",
            "model_name": "MiniMax-Hailuo-2.3",
            "model_bindings": [
                {
                    "operation": "video-standard",
                    "label": "金丹 (Hailuo 2.3)",
                    "model_name": "MiniMax-Hailuo-2.3",
                },
                {
                    "operation": "minimax-m3",
                    "label": "练气 (MiniMax M3 文本)",
                    "model_name": "MiniMax-M3",
                },
            ],
        },
    )

    assert body["model"] == "MiniMax-M3"
    assert body["thinking"] == {"type": "disabled"}
    assert output_type == "text"


def test_minimax_text_real_generation_normalizes_legacy_json_string_bindings() -> None:
    _, body, output_type = _real_generation_request(
        "minimax",
        {
            "endpoint": "https://api.minimaxi.com/v1",
            "model_name": "MiniMax-Hailuo-2.3",
            "model_bindings": json.dumps(
                [
                    {
                        "operation": "video-standard",
                        "label": "金丹 (Hailuo 2.3)",
                        "model_name": "MiniMax-Hailuo-2.3",
                    },
                    {
                        "operation": "speech-hd",
                        "label": "语音生成 (Speech 2.8 HD)",
                        "model_name": "speech-2.8-hd",
                    },
                ],
                ensure_ascii=False,
            ),
            "category": "video",
            "_test_category": "text",
        },
    )

    assert body["model"] == "MiniMax-M3"
    assert body["thinking"] == {"type": "disabled"}
    assert output_type == "text"


def test_doubao_real_generation_uses_minimum_valid_image_payload() -> None:
    _, body, output_type = _real_generation_request(
        "doubao",
        {
            "endpoint": "https://ark.cn-beijing.volces.com/api/v3/images/generations",
            "model_name": "doubao-seedream-5-0-pro-260628",
        },
    )

    assert body["size"] == "1920x1920"
    assert body["response_format"] == "url"
    assert body["watermark"] is False
    assert output_type == "image"


def test_doubao_agent_plan_real_generation_uses_plan_endpoint_and_min_size() -> None:
    url, body, output_type = _real_generation_request(
        "doubao",
        {
            "endpoint": "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks",
            "model_name": "doubao-seedream-5.0-lite",
        },
    )

    assert url == "https://ark.cn-beijing.volces.com/api/plan/v3/images/generations"
    assert body["size"] == "2048x2048"
    assert body["model"] == DOUBAO_IMAGE_AGENT_PLAN_MODEL
    assert body["prompt"] == "A simple blue square icon on a white background."
    assert "content" not in body
    assert body["response_format"] == "url"
    assert body["watermark"] is False
    assert output_type == "image"


def test_doubao_agent_plan_real_generation_normalizes_legacy_model_alias() -> None:
    _, body, output_type = _real_generation_request(
        "doubao",
        {
            "endpoint": "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks",
            "model_name": "doubao-seedream-5-0",
        },
    )

    assert body["model"] == DOUBAO_IMAGE_AGENT_PLAN_MODEL
    assert output_type == "image"


def test_doubao_agent_plan_real_generation_expands_short_endpoint() -> None:
    url, body, _ = _real_generation_request(
        "doubao",
        {
            "endpoint": "https://ark.cn-beijing.volces.com/api/plan",
            "model_name": "doubao-seedream-5.0-lite",
        },
    )

    assert url == "https://ark.cn-beijing.volces.com/api/plan/v3/images/generations"
    assert body["model"] == DOUBAO_IMAGE_AGENT_PLAN_MODEL
    assert body["size"] == "2048x2048"


@pytest.mark.asyncio
async def test_doubao_agent_plan_real_generation_reports_effective_model_name() -> None:
    class FakeResponse:
        status = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def text(self):
            return '{"data":[{"url":"https://cdn.example.test/seedream.png"}]}'

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def post(self, *args, **kwargs):
            return FakeResponse()

    result = await run_api_config_real_generation(
        {
            "provider": "doubao",
            "endpoint": "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks",
            "model_name": "doubao-seedream-5.0-lite",
        },
        "test-key",
        session_factory=lambda **_kwargs: FakeSession(),
    )

    assert result["test"]["ok"] is True
    assert result["test"]["model_name"] == DOUBAO_IMAGE_AGENT_PLAN_MODEL
    assert result["test"]["url"] == "https://ark.cn-beijing.volces.com/api/plan/v3/images/generations"


def test_gpt_image_real_generation_uses_lowest_explicit_cost_profile() -> None:
    _, body, output_type = _real_generation_request(
        "laozhang-gpt-image",
        {
            "endpoint": "https://api.laozhang.ai/v1",
            "model_name": "gpt-image-2-vip",
        },
    )

    assert body["n"] == 1
    assert body["size"] == "1024x1024"
    assert body["quality"] == "low"
    assert output_type == "image"


def test_gemini_31_image_real_generation_uses_512_resolution() -> None:
    _, body, output_type = _real_generation_request(
        "gemini-image",
        {
            "endpoint": "https://generativelanguage.googleapis.com/v1beta",
            "model_name": "gemini-3.1-flash-image-preview",
        },
    )

    image_config = body["generationConfig"]["imageConfig"]
    assert image_config == {"aspectRatio": "1:1", "imageSize": "512"}
    assert output_type == "image"


def test_minimax_audio_real_generation_uses_tts_sync_and_group_id() -> None:
    url, body, output_type = _real_generation_request(
        "minimax",
        {
            "endpoint": "https://api.minimaxi.com/v1",
            "model_name": "MiniMax-Hailuo-02",
            "category": "audio",
            "request_template": {"group_id": "group-1"},
            "model_bindings": [
                {
                    "operation": "tts-hd",
                    "label": "语音生成 (Speech 2.8 HD)",
                    "model_name": "speech-2.8-hd",
                },
            ],
        },
    )

    assert url == "https://api.minimaxi.com/v1/t2a_v2?GroupId=group-1"
    assert body["model"] == "speech-2.8-hd"
    assert body["text"] == "OK."
    assert body["voice_setting"]["voice_id"] == "male-qn-qingse"
    assert body["voice_setting"]["vol"] == 1.0
    assert body["audio_setting"]["channel"] == 1
    assert "output_format" not in body
    assert output_type == "audio"


def test_minimax_token_plan_audio_real_generation_omits_legacy_group_id() -> None:
    url, body, output_type = _real_generation_request(
        "minimax",
        {
            "endpoint": "https://api.minimaxi.com/v1",
            "model_name": "speech-2.8-hd",
            "category": "audio",
            "request_template": {
                "group_id": "admin",
                "provider_access_mode": "domestic_token_plan",
            },
        },
    )

    assert url == "https://api.minimaxi.com/v1/t2a_v2"
    assert body["model"] == "speech-2.8-hd"
    assert output_type == "audio"


def test_minimax_video_real_generation_does_not_create_billable_task() -> None:
    with pytest.raises(ProviderHealthNotFound):
        _real_generation_request(
            "minimax",
            {
                "endpoint": "https://api.minimaxi.com/v1",
                "model_name": "MiniMax-Hailuo-2.3",
                "category": "video",
            },
        )


def test_minimax_audio_generation_response_detection() -> None:
    assert _real_generation_response_ok(
        "audio",
        {"data": {"audio": "494433"}, "base_resp": {"status_code": 0}},
    )


def test_generation_headers_replace_stale_authorization() -> None:
    headers = _headers_for_generation(
        "minimax",
        "https://api.minimaxi.com/v1",
        "fresh-key",
        {"Authorization": "", "X-Custom": "1"},
    )

    assert headers["Authorization"] == "Bearer fresh-key"
    assert headers["X-Custom"] == "1"
    assert "authorization" not in {key.lower(): key for key in headers if key != "Authorization"}


def test_minimax_anthropic_generation_headers_use_x_api_key() -> None:
    headers = _headers_for_generation(
        "minimax",
        "https://api.minimaxi.com/anthropic/v1/messages",
        "fresh-key",
        {"Authorization": "stale", "X-Api-Key": "stale"},
    )

    assert headers["X-Api-Key"] == "fresh-key"
    assert headers["Anthropic-Version"] == "2023-06-01"
    assert "authorization" not in {key.lower() for key in headers}


def test_minimax_anthropic_generation_response_detection() -> None:
    assert _real_generation_response_ok(
        "text",
        {"content": [{"type": "text", "text": "OK"}]},
    )
    assert not _real_generation_response_ok(
        "text",
        {"content": [{"type": "thinking", "thinking": "OK"}]},
    )


@pytest.mark.asyncio
async def test_minimax_real_generation_posts_anthropic_request_and_accepts_text() -> None:
    calls = []

    class FakeResponse:
        status = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def text(self):
            return '{"content":[{"type":"text","text":"OK"}]}'

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def post(self, *args, **kwargs):
            calls.append((args, kwargs))
            return FakeResponse()

    result = await run_api_config_real_generation(
        {
            "provider": "minimax",
            "endpoint": "https://api.minimaxi.com/v1",
            "model_name": "MiniMax-M3",
            "category": "text",
        },
        "test-key",
        session_factory=lambda **_kwargs: FakeSession(),
    )

    assert result["test"]["ok"] is True
    assert result["test"]["url"] == "https://api.minimaxi.com/anthropic/v1/messages"
    assert calls[0][1]["headers"]["X-Api-Key"] == "test-key"
    assert calls[0][1]["json"]["model"] == "MiniMax-M3"
    assert calls[0][1]["json"]["stream"] is False


def test_minimax_base_resp_error_is_actionable_for_token_plan() -> None:
    error = _minimax_error_from_payload(
        {
            "base_resp": {
                "status_code": 1004,
                "status_msg": "login fail: Please carry the API secret key in the 'Authorization' field",
            }
        }
    )

    assert "MiniMax status_code=1004" in error
    assert "Authorization" in error
    assert "Token Plan" in error
    assert "Subscription Key" in error


def test_minimax_video_2056_mentions_token_plan_video_limit() -> None:
    error = _minimax_error_from_payload(
        {
            "base_resp": {
                "status_code": 2056,
                "status_msg": "已达到 Token Plan 用量上限",
            }
        },
        "video_task",
    )

    assert "MiniMax status_code=2056" in error
    assert "Token Plan Plus does not include MiniMax video generation" in error


def test_video_real_generation_does_not_create_billable_task() -> None:
    with pytest.raises(ProviderHealthNotFound):
        _real_generation_request(
            "seedance",
            {
                "endpoint": "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
                "model_name": "doubao-seedance-2-0-260128",
            },
        )


def test_seedance_agent_plan_health_uses_plan_v3_routes() -> None:
    urls = api_config_health_urls(
        {
            "provider": "seedance",
            "endpoint": "https://ark.cn-beijing.volces.com/api/plan/",
            "model_name": "doubao-seedance-2-0-260128",
        }
    )

    assert urls[0] == "https://ark.cn-beijing.volces.com/api/plan/v3/models"
    assert "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks" in urls
    assert all("/api/plan/" in url for url in urls)
