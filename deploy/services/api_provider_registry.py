"""Central registry for external API provider configuration.

This module is intentionally data-only. Runtime callers should import from here
instead of duplicating provider -> environment-variable and preset-model lists.
It is the first step toward a unified API management surface.
"""
from __future__ import annotations

from copy import deepcopy
import json
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit, urlunsplit

from services.api_provider_endpoints import derive_models_health_urls
from utils.config_helpers import _config_get


MODEL_USAGE_SCOPE_WORKFLOW = "workflow"
MODEL_USAGE_SCOPE_STUDIO = "studio"
MODEL_USAGE_SCOPES = (MODEL_USAGE_SCOPE_WORKFLOW, MODEL_USAGE_SCOPE_STUDIO)
MODEL_USAGE_SCOPE_LABELS: Dict[str, str] = {
    MODEL_USAGE_SCOPE_WORKFLOW: "流程化制作",
    MODEL_USAGE_SCOPE_STUDIO: "自由创作",
}

PROVIDER_ENV_MAP: Dict[str, str] = {
    "gemini-text": "GEMINI_TEXT_API_KEY",
    "gemini-image": "GEMINI_IMAGE_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "doubao": "ARK_API_KEY",
    "minimax": "MINIMAX_API_KEY",
    "sora2": "SORA2_API_KEY",
    "veo": "VEO_API_KEY",
    "dashscope": "DASHSCOPE_API_KEY",
    "seedance": "SEEDANCE_API_KEY",
    "laozhang-gpt-image": "GPT_IMAGE_API_KEY",
    "laozhang-sora2": "SORA2_GPT_IMAGE_API_KEY",
}

PROVIDER_EXTRA_ENV_MAP: Dict[str, Dict[str, str]] = {
    "doubao": {
        "account_binding": "ARK_ACCOUNT_BINDING",
    },
    "seedance": {
        "account_binding": "SEEDANCE_ACCOUNT_BINDING",
    },
    "minimax": {
        "group_id": "MINIMAX_GROUP_ID",
        "provider_access_mode": "MINIMAX_PROVIDER_ACCESS_MODE",
    },
}

PROVIDER_EXTRA_FIELD_CATALOG: Dict[str, List[Dict[str, Any]]] = {
    "doubao": [
        {
            "field": "account_binding",
            "label": "火山账号绑定标识",
            "target": "request_template",
            "input_type": "text",
            "placeholder": "例如 volcengine-main",
            "help": "同一火山账号下的 Plan 与按量付费 Key 请填写相同标识，用于可信原图校验；不会发送给模型。",
        },
    ],
    "seedance": [
        {
            "field": "account_binding",
            "label": "火山账号绑定标识",
            "target": "request_template",
            "input_type": "text",
            "placeholder": "例如 volcengine-main",
            "help": "同一火山账号下的 Plan 与按量付费 Key 请填写相同标识，用于可信原图校验；不会发送给模型。",
        },
    ],
    "minimax": [
        {
            "field": "group_id",
            "label": "MiniMax Group ID",
            "target": "request_template",
            "input_type": "text",
            "placeholder": "MiniMax console GroupId",
            "help": "Used by MiniMax TTS, voice design, and voice clone. Hot-reloads into MINIMAX_GROUP_ID.",
            "aliases": ["minimax_group_id"],
        },
        {
            "field": "provider_access_mode",
            "label": "MiniMax Access Mode",
            "target": "request_template",
            "input_type": "text",
            "placeholder": "standard / token_plan",
            "help": "Token Plan keys omit the legacy GroupId query parameter.",
            "aliases": ["minimax_provider_access_mode"],
        },
    ],
}

VENDOR_CREDENTIAL_LINKS: Dict[str, Dict[str, str]] = {
    "deepseek": {
        "docs_url": "https://api-docs.deepseek.com/api/deepseek-api",
        "console_url": "https://platform.deepseek.com/api_keys",
    },
    "google": {
        "docs_url": "https://ai.google.dev/gemini-api/docs/api-key",
        "console_url": "https://aistudio.google.com/app/apikey",
    },
    "volcengine": {
        "docs_url": "https://www.volcengine.com/docs/82379/",
        "console_url": "https://console.volcengine.com/ark",
    },
    "alibaba": {
        "docs_url": "https://www.alibabacloud.com/help/en/model-studio/first-api-call-to-qwen",
        "console_url": "https://bailian.console.aliyun.com/",
    },
    "minimax": {
        "docs_url": "https://platform.minimaxi.com/docs/api-reference/api-overview",
        "console_url": "https://platform.minimaxi.com/console/personal-info",
    },
    "laozhang": {
        "docs_url": "https://docs.laozhang.ai/en/getting-started",
        "console_url": "https://api2.laozhang.ai/",
    },
}

PROVIDER_KEY_HELP: Dict[str, str] = {
    "deepseek": "Create a DeepSeek platform API key and paste it as DEEPSEEK_API_KEY.",
    "gemini-text": "Create a Google AI Studio API key and paste it as GEMINI_TEXT_API_KEY.",
    "gemini-image": "Create a Google AI Studio API key and paste it as GEMINI_IMAGE_API_KEY.",
    "doubao": "Create a Volcengine Ark API key and paste it as ARK_API_KEY.",
    "seedance": (
        "Create a Volcengine Ark pay-as-you-go or Agent Plan API key, select the matching "
        "Seedance channel, and paste it as SEEDANCE_API_KEY; ARK_API_KEY remains a fallback."
    ),
    "dashscope": "Create an Alibaba Cloud Model Studio / DashScope API key and paste it as DASHSCOPE_API_KEY.",
    "minimax": (
        "Create a MiniMax pay-as-you-go or Token Plan API key and paste it as "
        "MINIMAX_API_KEY. Select token_plan for a Token Plan key; Group ID is "
        "configured separately only when needed."
    ),
    "sora2": "Create a LaoZhang API token and paste it as SORA2_API_KEY.",
    "veo": "Create a LaoZhang API token and paste it as VEO_API_KEY; SORA2_API_KEY remains a fallback.",
    "laozhang-gpt-image": "Create a LaoZhang API token and paste it as GPT_IMAGE_API_KEY.",
    "laozhang-sora2": "Create a LaoZhang API token and paste it as SORA2_GPT_IMAGE_API_KEY.",
}


DOUBAO_IMAGE_PAYG_MODEL = "doubao-seedream-5-0-lite-260128"
DOUBAO_IMAGE_AGENT_PLAN_MODEL = "doubao-seedream-5.0-lite"
DOUBAO_IMAGE_DEFAULT_MODEL = DOUBAO_IMAGE_PAYG_MODEL
DOUBAO_IMAGE_LEGACY_MODEL = "doubao-seedream-4-0-250828"
DOUBAO_IMAGE_MODEL_ALIASES: Dict[str, str] = {
    "doubao-seedream-5.0-pro": "doubao-seedream-5-0-pro-260628",
    "doubao-seedream-5-0-pro": "doubao-seedream-5-0-pro-260628",
    "doubao-seedream-5-0-pro-260628": "doubao-seedream-5-0-pro-260628",
    "seedream-5.0-pro": "doubao-seedream-5-0-pro-260628",
    "seedream-5-0-pro": "doubao-seedream-5-0-pro-260628",
    "doubao-seedream-5.0": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "doubao-seedream-5-0": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "doubao-seedream-5-0-260128": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "seedream-5.0": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "seedream-5-0": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "seedream-5-0-260128": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "doubao-seedream-4.0": DOUBAO_IMAGE_LEGACY_MODEL,
    "doubao-seedream-4-0": DOUBAO_IMAGE_LEGACY_MODEL,
    "doubao-seedream-4-0-250828": DOUBAO_IMAGE_LEGACY_MODEL,
    "seedream-4.0": DOUBAO_IMAGE_LEGACY_MODEL,
    "seedream-4-0": DOUBAO_IMAGE_LEGACY_MODEL,
    "doubao-seedream-5.0-lite": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "doubao-seedream-5-0-lite": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "doubao-seedream-5-0-lite-260128": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "seedream-5.0-lite": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "seedream-5-0-lite": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "seedream-5-0-lite-260128": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
}

DOUBAO_IMAGE_STANDARD_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT = "https://ark.cn-beijing.volces.com/api/plan/v3/images/generations"
DOUBAO_IMAGE_MODEL_BINDING_OPTIONS: List[Dict[str, str]] = [
    {
        "operation": "generate",
        "label": "Doubao-Seedream-5.0-lite · 参考图生图模型",
        "model_name": DOUBAO_IMAGE_DEFAULT_MODEL,
    },
]
DOUBAO_IMAGE_ACCESS_MODES: List[Dict[str, Any]] = [
    {
        "mode": "standard",
        "label": "按量付费",
        "endpoint": DOUBAO_IMAGE_STANDARD_ENDPOINT,
        "console_url": "https://console.volcengine.com/ark/region:ark+cn-beijing/apikey",
        "model_map": {"generate": DOUBAO_IMAGE_PAYG_MODEL},
    },
    {
        "mode": "agent_plan",
        "label": "Agent Plan",
        "endpoint": DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT,
        "console_url": "https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan",
        "model_map": {"generate": DOUBAO_IMAGE_AGENT_PLAN_MODEL},
    },
]


SEEDANCE_DEFAULT_MODEL_MAP: Dict[str, str] = {
    "standard": "doubao-seedance-2-0-260128",
    "fast": "doubao-seedance-2-0-fast-260128",
    "mini": "doubao-seedance-2-0-mini-260615",
}

SEEDANCE_AGENT_PLAN_MODEL_MAP: Dict[str, str] = {
    "agent_plan": "doubao-seedance-1.5-pro",
    "standard": "doubao-seedance-1.5-pro",
    "fast": "doubao-seedance-1.5-pro",
    "mini": "doubao-seedance-1.5-pro",
}
SEEDANCE_LEGACY_AGENT_PLAN_MODELS = frozenset(
    {"doubao-seedance-2.0", "doubao-seedance-2.0-fast", "doubao-seedance-2.0-mini"}
)

SEEDANCE_STANDARD_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"
SEEDANCE_AGENT_PLAN_ENDPOINT = "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks"

SEEDANCE_ACCESS_MODES: List[Dict[str, Any]] = [
    {
        "mode": "standard",
        "label": "按量付费",
        "endpoint": SEEDANCE_STANDARD_ENDPOINT,
        "console_url": "https://console.volcengine.com/ark/region:ark+cn-beijing/apikey",
        "model_map": deepcopy(SEEDANCE_DEFAULT_MODEL_MAP),
    },
    {
        "mode": "agent_plan",
        "label": "Agent Plan",
        "endpoint": SEEDANCE_AGENT_PLAN_ENDPOINT,
        "console_url": "https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan",
        "model_map": deepcopy(SEEDANCE_AGENT_PLAN_MODEL_MAP),
    },
]

SEEDANCE_SUB_MODEL_ENV_MAP: Dict[str, str] = {
    "agent_plan": "SEEDANCE_MODEL_AGENT_PLAN",
    "standard": "SEEDANCE_MODEL_STANDARD",
    "fast": "SEEDANCE_MODEL_FAST",
    "mini": "SEEDANCE_MODEL_MINI",
}

SEEDANCE_OPERATION_API_KEY_ENV_MAP: Dict[str, str] = {
    operation: f"SEEDANCE_{operation.upper()}_API_KEY"
    for operation in SEEDANCE_SUB_MODEL_ENV_MAP
}
SEEDANCE_OPERATION_ENDPOINT_ENV_MAP: Dict[str, str] = {
    operation: f"SEEDANCE_{operation.upper()}_ENDPOINT"
    for operation in SEEDANCE_SUB_MODEL_ENV_MAP
}

ARK_OFFICIAL_HOST = "ark.cn-beijing.volces.com"

MINIMAX_DEFAULT_VIDEO_MODEL = "MiniMax-Hailuo-2.3"
MINIMAX_DEFAULT_PROVIDER_MODEL = MINIMAX_DEFAULT_VIDEO_MODEL
MINIMAX_FAST_VIDEO_MODEL = "MiniMax-Hailuo-2.3-Fast"
MINIMAX_LEGACY_VIDEO_MODELS = frozenset({"MiniMax-Hailuo-02"})
MINIMAX_TTS_HD_MODEL = "speech-2.8-hd"
MINIMAX_TTS_TURBO_MODEL = "speech-2.8-turbo"
MINIMAX_MUSIC_OPERATION = "music"
MINIMAX_MUSIC_MODEL = "music-2.6"
MINIMAX_M3_OPERATION = "minimax-m3"
MINIMAX_M3_MODEL = "MiniMax-M3"
MINIMAX_OPERATION_MODEL_ENV_MAP: Dict[str, str] = {
    MINIMAX_M3_OPERATION: "MINIMAX_MODEL_M3",
    MINIMAX_MUSIC_OPERATION: "MINIMAX_MODEL_MUSIC",
    "speech-hd": "MINIMAX_MODEL_SPEECH_HD",
    "speech-turbo": "MINIMAX_MODEL_SPEECH_TURBO",
}
MINIMAX_DOMESTIC_ENDPOINT = "https://api.minimaxi.com/v1"
MINIMAX_INTERNATIONAL_ENDPOINT = "https://api.minimax.io/v1"
MINIMAX_ACCESS_MODES: List[Dict[str, Any]] = [
    {
        "mode": "domestic",
        "label": "国内站",
        "endpoint": MINIMAX_DOMESTIC_ENDPOINT,
        "console_url": "https://platform.minimaxi.com/console/personal-info",
        "docs_url": "https://platform.minimaxi.com/docs/api-reference/api-overview",
        "description": "使用 MiniMax 国内站创建的按量或 Token Plan API Key。",
    },
    {
        "mode": "international",
        "label": "国际站",
        "endpoint": MINIMAX_INTERNATIONAL_ENDPOINT,
        "console_url": "https://platform.minimax.io/",
        "docs_url": "https://platform.minimax.io/docs/guides/quickstart-preparation",
        "description": "使用 MiniMax 国际站创建的 API Key；国际 Key 不能用于国内 Endpoint。",
    },
]
GOOGLE_GENERATIVE_LANGUAGE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta"
SORA2_DEFAULT_VIDEO_MODEL = "sora_video2-landscape-15s"
SORA2_LEGACY_VIDEO_MODELS = frozenset({"sora-2"})
VEO_DEFAULT_VIDEO_MODEL = "veo-3.1-landscape-fast-fl"
VEO_LEGACY_VIDEO_MODELS = frozenset({"veo-3", "veo-3.1"})

DASHSCOPE_DEFAULT_MODEL_MAP: Dict[str, str] = {
    "wan26": "wan2.6-i2v",
    "kling-standard": "kling/kling-v3-video-generation",
    "kling-omni": "kling/kling-v3-omni-video-generation",
    "vidu-reference-q3-mix": "vidu/viduq3-mix_reference2video",
    "vidu-reference-q3": "vidu/viduq3_reference2video",
    "vidu-reference-q3-turbo": "vidu/viduq3-turbo_reference2video",
    "vidu-reference-q2-pro": "vidu/viduq2-pro_reference2video",
    "vidu-reference-q2": "vidu/viduq2_reference2video",
    "vidu-startend-q3-pro": "vidu/viduq3-pro_start-end2video",
    "vidu-startend-q3-turbo": "vidu/viduq3-turbo_start-end2video",
    "vidu-startend-q2-pro": "vidu/viduq2-pro_start-end2video",
    "vidu-startend-q2-turbo": "vidu/viduq2-turbo_start-end2video",
    "happyhorse": "happyhorse-1.0-r2v",
}

DASHSCOPE_VIDU_REFERENCE_SUB_MODEL_MAP: Dict[str, str] = {
    "q3-mix": "vidu-reference-q3-mix",
    "q3": "vidu-reference-q3",
    "q3-turbo": "vidu-reference-q3-turbo",
    "q2-pro": "vidu-reference-q2-pro",
    "q2": "vidu-reference-q2",
}

DASHSCOPE_VIDU_STARTEND_SUB_MODEL_MAP: Dict[str, str] = {
    "q3-pro": "vidu-startend-q3-pro",
    "q3-turbo": "vidu-startend-q3-turbo",
    "q2-pro": "vidu-startend-q2-pro",
    "q2-turbo": "vidu-startend-q2-turbo",
}

DASHSCOPE_SUB_MODEL_ENV_MAP: Dict[str, str] = {
    "wan26": "DASHSCOPE_MODEL_WAN26",
    "kling-standard": "DASHSCOPE_MODEL_KLING_STANDARD",
    "kling-omni": "DASHSCOPE_MODEL_KLING_OMNI",
    "vidu-reference-q3-mix": "DASHSCOPE_MODEL_VIDU_REFERENCE_Q3_MIX",
    "vidu-reference-q3": "DASHSCOPE_MODEL_VIDU_REFERENCE_Q3",
    "vidu-reference-q3-turbo": "DASHSCOPE_MODEL_VIDU_REFERENCE_Q3_TURBO",
    "vidu-reference-q2-pro": "DASHSCOPE_MODEL_VIDU_REFERENCE_Q2_PRO",
    "vidu-reference-q2": "DASHSCOPE_MODEL_VIDU_REFERENCE_Q2",
    "vidu-startend-q3-pro": "DASHSCOPE_MODEL_VIDU_STARTEND_Q3_PRO",
    "vidu-startend-q3-turbo": "DASHSCOPE_MODEL_VIDU_STARTEND_Q3_TURBO",
    "vidu-startend-q2-pro": "DASHSCOPE_MODEL_VIDU_STARTEND_Q2_PRO",
    "vidu-startend-q2-turbo": "DASHSCOPE_MODEL_VIDU_STARTEND_Q2_TURBO",
    "happyhorse": "DASHSCOPE_MODEL_HAPPYHORSE",
}

DEEPSEEK_DEFAULT_MODEL_MAP: Dict[str, str] = {
    "deepseek-reasoner": "deepseek-v4-pro",
    "deepseek-chat": "deepseek-v4-flash",
}

DEEPSEEK_OPERATION_MODEL_ENV_MAP: Dict[str, str] = {
    "deepseek-reasoner": "DEEPSEEK_MODEL_REASONER",
    "deepseek-chat": "DEEPSEEK_MODEL_CHAT",
}

DEEPSEEK_MODEL_BINDING_OPTIONS: List[Dict[str, str]] = [
    {
        "operation": "deepseek-reasoner",
        "label": "DeepSeek Reasoner",
        "model_name": DEEPSEEK_DEFAULT_MODEL_MAP["deepseek-reasoner"],
    },
    {
        "operation": "deepseek-chat",
        "label": "DeepSeek Chat",
        "model_name": DEEPSEEK_DEFAULT_MODEL_MAP["deepseek-chat"],
    },
]


SEEDANCE_MODEL_BINDING_OPTIONS: List[Dict[str, str]] = [
    {
        "operation": "agent_plan",
        "label": "Seedance 1.5 Pro · Agent Plan 首尾帧视频模型",
        "model_name": SEEDANCE_AGENT_PLAN_MODEL_MAP["agent_plan"],
    },
    {
        "operation": "standard",
        "label": "Seedance 2.0 · 多模态标准视频模型",
        "model_name": SEEDANCE_DEFAULT_MODEL_MAP["standard"],
    },
    {
        "operation": "fast",
        "label": "Seedance 2.0 Fast · 多模态快速视频模型",
        "model_name": SEEDANCE_DEFAULT_MODEL_MAP["fast"],
    },
    {
        "operation": "mini",
        "label": "Seedance 2.0 Mini · 多模态简化视频模型",
        "model_name": SEEDANCE_DEFAULT_MODEL_MAP["mini"],
    },
]

DASHSCOPE_MODEL_BINDING_LABELS: Dict[str, str] = {
    "wan26": "Wan 2.6 · 镜头叙事视频模型",
    "kling-standard": "Kling V3 · 全能音画视频模型",
    "kling-omni": "Kling V3 · 全能音画视频模型",
    "vidu-reference-q3-mix": "Vidu Q3 · 多参考视频模型",
    "vidu-reference-q3": "Vidu Q3 · 多参考视频模型",
    "vidu-reference-q3-turbo": "Vidu Q3 · 多参考视频模型",
    "vidu-reference-q2-pro": "Vidu Q3 · 多参考视频模型",
    "vidu-reference-q2": "Vidu Q3 · 多参考视频模型",
    "vidu-startend-q3-pro": "Vidu Q3 · 多参考视频模型",
    "vidu-startend-q3-turbo": "Vidu Q3 · 多参考视频模型",
    "vidu-startend-q2-pro": "Vidu Q3 · 多参考视频模型",
    "vidu-startend-q2-turbo": "Vidu Q3 · 多参考视频模型",
    "happyhorse": "HappyHorse 1.0 · 角色一致性视频模型",
}

DASHSCOPE_MODEL_BINDING_OPTIONS: List[Dict[str, str]] = [
    {
        "operation": operation,
        "label": DASHSCOPE_MODEL_BINDING_LABELS[operation],
        "model_name": model_name,
    }
    for operation, model_name in DASHSCOPE_DEFAULT_MODEL_MAP.items()
]

MINIMAX_MODEL_BINDING_OPTIONS: List[Dict[str, str]] = [
    {
        "operation": "video-standard",
        "label": "MiniMax Hailuo 2.3 · 首尾帧标准视频模型",
        "model_name": MINIMAX_DEFAULT_VIDEO_MODEL,
    },
    {
        "operation": "video-fast",
        "label": "MiniMax Hailuo 2.3 Fast",
        "model_name": MINIMAX_FAST_VIDEO_MODEL,
    },
    {
        "operation": "speech-hd",
        "label": "语音生成 (Speech 2.8 HD)",
        "model_name": MINIMAX_TTS_HD_MODEL,
    },
    {
        "operation": "speech-turbo",
        "label": "语音生成 (Speech 2.8 Turbo)",
        "model_name": MINIMAX_TTS_TURBO_MODEL,
    },
    {
        "operation": MINIMAX_MUSIC_OPERATION,
        "label": "音乐生成 (Music 2.6)",
        "model_name": MINIMAX_MUSIC_MODEL,
    },
    {
        "operation": MINIMAX_M3_OPERATION,
        "label": "MiniMax M3 文本",
        "model_name": MINIMAX_M3_MODEL,
    },
]


# Public model presentation is owned by the backend binding catalogue. The
# frontend key is stable application identity; provider model ids stay separate
# so wording changes cannot accidentally alter runtime routing.
VIDEO_PUBLIC_MODEL_BINDINGS: Dict[tuple[str, str], Dict[str, str]] = {
    ("seedance", "agent_plan"): {
        "front_model_key": "Seedance15",
        "default_display_name": "Seedance 1.5 Pro",
        "default_description": "首尾帧视频模型",
    },
    ("seedance", "standard"): {
        "front_model_key": "Seedance2",
        "default_display_name": "Seedance 2.0",
        "default_description": "多模态标准视频模型",
    },
    ("seedance", "fast"): {
        "front_model_key": "Seedance2Fast",
        "default_display_name": "Seedance 2.0 Fast",
        "default_description": "多模态快速视频模型",
    },
    ("seedance", "mini"): {
        "front_model_key": "Seedance2Mini",
        "default_display_name": "Seedance 2.0 Mini",
        "default_description": "多模态简化视频模型",
    },
    ("minimax", "video-standard"): {
        "front_model_key": "MINI",
        "default_display_name": "MiniMax Hailuo 2.3",
        "default_description": "首尾帧标准视频模型",
    },
    ("minimax", "video-fast"): {
        "front_model_key": "MINI",
        "default_display_name": "MiniMax Hailuo 2.3 Fast",
        "default_description": "快速视频模型",
    },
    ("dashscope", "wan26"): {
        "front_model_key": "大能",
        "default_display_name": "Wan 2.6",
        "default_description": "镜头叙事视频模型",
    },
    ("dashscope", "kling-standard"): {
        "front_model_key": "Kling",
        "default_display_name": "Kling V3",
        "default_description": "全能音画视频模型",
    },
    ("dashscope", "kling-omni"): {
        "front_model_key": "Kling",
        "default_display_name": "Kling V3 Omni",
        "default_description": "多参考音画视频模型",
    },
    **{
        ("dashscope", operation): {
            "front_model_key": "Vidu",
            "default_display_name": "Vidu Q3",
            "default_description": "多参考视频模型",
        }
        for operation in DASHSCOPE_DEFAULT_MODEL_MAP
        if operation.startswith("vidu-")
    },
    ("dashscope", "happyhorse"): {
        "front_model_key": "HappyHorse",
        "default_display_name": "HappyHorse 1.0",
        "default_description": "角色一致性视频模型",
    },
    ("sora2", SORA2_DEFAULT_VIDEO_MODEL.lower()): {
        "front_model_key": "Sora2",
        "default_display_name": "Sora 2",
        "default_description": "长镜头视频模型",
    },
    ("veo", VEO_DEFAULT_VIDEO_MODEL.lower()): {
        "front_model_key": "Veo",
        "default_display_name": "Veo 3.1 Fast",
        "default_description": "高质量快速视频模型",
    },
}


def _split_public_binding_label(label: str, model_name: str) -> tuple[str, str]:
    value = str(label or "").strip()
    if " · " in value:
        name, description = value.split(" · ", 1)
        return name.strip(), description.strip()
    return value or str(model_name or "").strip(), ""


def model_binding_public_defaults(
    provider: str,
    operation: str,
    *,
    label: str = "",
    model_name: str = "",
) -> Dict[str, str]:
    """Return immutable default wording and stable frontend identity."""
    provider_id = normalize_provider(provider)
    operation_id = str(operation or "").strip().lower()
    configured = VIDEO_PUBLIC_MODEL_BINDINGS.get((provider_id, operation_id))
    if configured:
        return dict(configured)
    default_name, default_description = _split_public_binding_label(label, model_name)
    return {
        "front_model_key": "",
        "default_display_name": default_name,
        "default_description": default_description,
    }


def normalize_model_usage_scope(scope: Optional[str]) -> str:
    normalized = (scope or MODEL_USAGE_SCOPE_WORKFLOW).strip().lower()
    aliases = {
        "flow": MODEL_USAGE_SCOPE_WORKFLOW,
        "workflow-production": MODEL_USAGE_SCOPE_WORKFLOW,
        "workflow_production": MODEL_USAGE_SCOPE_WORKFLOW,
        "pipeline": MODEL_USAGE_SCOPE_WORKFLOW,
        "free": MODEL_USAGE_SCOPE_STUDIO,
        "free-creation": MODEL_USAGE_SCOPE_STUDIO,
        "free_creation": MODEL_USAGE_SCOPE_STUDIO,
        "canvas": MODEL_USAGE_SCOPE_STUDIO,
        "ostory-studio": MODEL_USAGE_SCOPE_STUDIO,
        "ostory_studio": MODEL_USAGE_SCOPE_STUDIO,
    }
    normalized = aliases.get(normalized, normalized)
    return normalized if normalized in MODEL_USAGE_SCOPES else MODEL_USAGE_SCOPE_WORKFLOW


def get_scoped_model_env_key(env_key: Optional[str], scope: Optional[str]) -> Optional[str]:
    """Return the env key that stores a model override for one usage scope."""
    if not env_key:
        return None
    normalized_scope = normalize_model_usage_scope(scope)
    if normalized_scope == MODEL_USAGE_SCOPE_WORKFLOW:
        return env_key
    return f"{env_key}_{normalized_scope.upper()}"


def scoped_model_env_candidates(env_key: Optional[str], scope: Optional[str]) -> List[str]:
    if not env_key:
        return []
    scoped = get_scoped_model_env_key(env_key, scope)
    if scoped and scoped != env_key:
        return [scoped, env_key]
    return [env_key]


def provider_billing_channel(
    provider: str,
    endpoint: Optional[str],
    request_template: Any = None,
) -> str:
    """Classify one credential card without coupling billing to its provider.

    Plan and metered credentials are independent runtime channels.  Explicit
    request metadata takes precedence, while Ark Plan endpoints remain
    recognizable for existing cards that predate the billing-mode field.
    """
    template = request_template
    if isinstance(template, str):
        try:
            template = json.loads(template) if template.strip() else {}
        except json.JSONDecodeError:
            template = {}
    if not isinstance(template, dict):
        template = {}

    values = [
        template.get("billing_mode"),
        template.get("billingMode"),
        template.get("provider_access_mode"),
        template.get("providerAccessMode"),
        template.get("access_mode"),
        template.get("accessMode"),
    ]
    for value in values:
        normalized = re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())
        if "plan" in normalized or "subscription" in normalized:
            return "plan"
        if normalized in {"payg", "payasyougo", "ondemand", "metered", "standard"}:
            return "payg"

    value = _with_default_https_for_host(str(endpoint or "").strip(), ARK_OFFICIAL_HOST)
    try:
        path = urlsplit(value).path.rstrip("/").lower()
    except ValueError:
        path = value.rstrip("/").lower()
    if path == "/api/plan" or path.startswith("/api/plan/"):
        return "plan"
    return "payg"


def _provider_operation_env_prefix(provider: str, operation: str) -> str:
    provider_token = re.sub(r"[^A-Z0-9]+", "_", normalize_provider(provider).upper()).strip("_")
    operation_token = re.sub(r"[^A-Z0-9]+", "_", str(operation or "default").upper()).strip("_")
    return f"{provider_token}_{operation_token}"


def get_provider_operation_api_key_env_key(provider: str, operation: str) -> str:
    return f"{_provider_operation_env_prefix(provider, operation)}_API_KEY"


def get_provider_operation_endpoint_env_key(provider: str, operation: str) -> str:
    return f"{_provider_operation_env_prefix(provider, operation)}_ENDPOINT"


def get_provider_operation_extra_env_key(provider: str, operation: str, field: str) -> str:
    field_token = re.sub(r"[^A-Z0-9]+", "_", str(field or "").upper()).strip("_")
    return f"{_provider_operation_env_prefix(provider, operation)}_{field_token}"


def _with_model_usage_scope(option: Dict[str, Any], scope: str) -> Dict[str, Any]:
    normalized_scope = normalize_model_usage_scope(scope)
    return {
        **option,
        "scope": normalized_scope,
        "scope_label": MODEL_USAGE_SCOPE_LABELS[normalized_scope],
    }


def expand_model_binding_scope_options(options: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        _with_model_usage_scope(option, scope)
        for scope in MODEL_USAGE_SCOPES
        for option in options
    ]


def normalize_seedance_sub_model(sub_model: Optional[str]) -> str:
    normalized = (sub_model or "standard").strip().lower()
    if normalized not in SEEDANCE_SUB_MODEL_ENV_MAP:
        raise ValueError(f"Unsupported Seedance sub_model: {sub_model}")
    return normalized


def get_seedance_sub_model_env_key(sub_model: Optional[str]) -> str:
    return SEEDANCE_SUB_MODEL_ENV_MAP[normalize_seedance_sub_model(sub_model)]


def get_seedance_operation_api_key_env_key(sub_model: Optional[str]) -> str:
    return SEEDANCE_OPERATION_API_KEY_ENV_MAP[normalize_seedance_sub_model(sub_model)]


def get_seedance_operation_endpoint_env_key(sub_model: Optional[str]) -> str:
    return SEEDANCE_OPERATION_ENDPOINT_ENV_MAP[normalize_seedance_sub_model(sub_model)]


def normalize_deepseek_model_name(model_name: Optional[str]) -> str:
    value = str(model_name or "").strip()
    return DEEPSEEK_DEFAULT_MODEL_MAP.get(value.lower(), value)


def get_deepseek_operation_model_env_key(operation: Optional[str]) -> str:
    normalized = str(operation or "").strip().lower()
    if normalized not in DEEPSEEK_OPERATION_MODEL_ENV_MAP:
        raise ValueError(f"Unsupported DeepSeek operation: {operation}")
    return DEEPSEEK_OPERATION_MODEL_ENV_MAP[normalized]


def get_minimax_operation_model_env_key(operation: Optional[str]) -> str:
    normalized = str(operation or "").strip().lower()
    if normalized not in MINIMAX_OPERATION_MODEL_ENV_MAP:
        raise ValueError(f"Unsupported MiniMax operation: {operation}")
    return MINIMAX_OPERATION_MODEL_ENV_MAP[normalized]


def is_seedance_fast_model(model_name: Optional[str]) -> bool:
    return "fast" in (model_name or "").strip().lower()


def is_seedance_mini_model(model_name: Optional[str]) -> bool:
    return "mini" in (model_name or "").strip().lower()


def doubao_image_access_mode(endpoint: Optional[str]) -> str:
    """Identify the Ark billing surface from a Doubao image endpoint."""
    value = _with_default_https_for_host(str(endpoint or "").strip(), ARK_OFFICIAL_HOST)
    try:
        path = urlsplit(value).path.rstrip("/").lower()
    except ValueError:
        path = value.rstrip("/").lower()
    return "agent_plan" if path == "/api/plan" or path.startswith("/api/plan/") else "standard"


def _with_default_https_for_host(value: str, host: str) -> str:
    """Allow admins to paste official API hosts without the URL scheme."""
    trimmed = (value or "").strip()
    if "://" in trimmed:
        return trimmed
    normalized = trimmed.lower()
    if normalized == host or normalized.startswith(f"{host}/"):
        return f"https://{trimmed}"
    return trimmed


def normalize_doubao_image_endpoint(endpoint: Optional[str]) -> str:
    """Expand official Ark base URLs to the matching image-generation endpoint."""
    value = _with_default_https_for_host(str(endpoint or "").strip(), ARK_OFFICIAL_HOST).rstrip("/")
    if not value:
        return value
    try:
        parsed = urlsplit(value)
    except ValueError:
        return value
    if parsed.netloc.lower() != "ark.cn-beijing.volces.com":
        return value

    path = parsed.path.rstrip("/").lower()
    if path in {"/api/plan", "/api/plan/v3"}:
        target_path = "/api/plan/v3/images/generations"
    elif path in {"/api", "/api/v3"}:
        target_path = "/api/v3/images/generations"
    elif path in {
        "/api/plan/v3/contents/generations/tasks",
        "/api/plan/v3/images/generations",
        "/api/v3/images/generations",
    }:
        target_path = "/api/plan/v3/images/generations" if path.startswith("/api/plan/") else parsed.path.rstrip("/")
    else:
        return value
    return urlunsplit((parsed.scheme or "https", parsed.netloc, target_path, "", ""))


def normalize_doubao_image_model_for_endpoint(
    model_name: Optional[str],
    endpoint: Optional[str],
) -> str:
    """Use the Agent Plan Seedream model while preserving pay-as-you-go choices."""
    value = normalize_doubao_image_model(model_name) or ""
    if doubao_image_access_mode(endpoint) == "agent_plan":
        known_models = {
            DOUBAO_IMAGE_DEFAULT_MODEL.lower(),
            DOUBAO_IMAGE_PAYG_MODEL.lower(),
            DOUBAO_IMAGE_AGENT_PLAN_MODEL.lower(),
            *(item.lower() for item in DOUBAO_IMAGE_MODEL_ALIASES.values()),
        }
        if not value or value.lower() in known_models:
            return DOUBAO_IMAGE_AGENT_PLAN_MODEL
    elif value.lower() == DOUBAO_IMAGE_AGENT_PLAN_MODEL.lower():
        return DOUBAO_IMAGE_PAYG_MODEL
    return value or DOUBAO_IMAGE_DEFAULT_MODEL


def seedance_access_mode(endpoint: Optional[str]) -> str:
    """Identify the Ark billing surface from a Seedance endpoint."""
    value = _with_default_https_for_host(str(endpoint or "").strip(), ARK_OFFICIAL_HOST)
    try:
        path = urlsplit(value).path.rstrip("/").lower()
    except ValueError:
        path = value.rstrip("/").lower()
    return "agent_plan" if path == "/api/plan" or path.startswith("/api/plan/") else "standard"


def normalize_seedance_endpoint(endpoint: Optional[str]) -> str:
    """Expand Ark base URLs to the native Seedance task endpoint.

    Custom gateways are intentionally left untouched. Only the official Ark
    host is normalized so an admin can still configure a compatible proxy.
    """
    value = _with_default_https_for_host(str(endpoint or "").strip(), ARK_OFFICIAL_HOST).rstrip("/")
    if not value:
        return value
    try:
        parsed = urlsplit(value)
    except ValueError:
        return value
    if parsed.netloc.lower() != "ark.cn-beijing.volces.com":
        return value

    path = parsed.path.rstrip("/").lower()
    if path in {"/api/plan", "/api/plan/v3"}:
        target_path = "/api/plan/v3/contents/generations/tasks"
    elif path in {"/api", "/api/v3"}:
        target_path = "/api/v3/contents/generations/tasks"
    elif path in {
        "/api/plan/v3/contents/generations/tasks",
        "/api/v3/contents/generations/tasks",
    }:
        target_path = parsed.path.rstrip("/")
    else:
        return value
    return urlunsplit((parsed.scheme or "https", parsed.netloc, target_path, "", ""))


def seedance_model_map_for_endpoint(endpoint: Optional[str]) -> Dict[str, str]:
    if seedance_access_mode(endpoint) == "agent_plan":
        return SEEDANCE_AGENT_PLAN_MODEL_MAP
    return SEEDANCE_DEFAULT_MODEL_MAP


def normalize_seedance_model_for_endpoint(
    model_name: Optional[str],
    endpoint: Optional[str],
    sub_model: Optional[str] = None,
) -> str:
    """Translate built-in Seedance model IDs between pay-as-you-go and Plan."""
    value = str(model_name or "").strip()
    operation = normalize_seedance_sub_model(
        sub_model
        or (
            "mini"
            if is_seedance_mini_model(value)
            else ("fast" if is_seedance_fast_model(value) else "standard")
        )
    )
    known_models = {
        item.lower()
        for model_map in (SEEDANCE_DEFAULT_MODEL_MAP, SEEDANCE_AGENT_PLAN_MODEL_MAP)
        for item in model_map.values()
    }
    known_models.update(item.lower() for item in SEEDANCE_LEGACY_AGENT_PLAN_MODELS)
    if not value or value.lower() in known_models:
        if operation == "agent_plan":
            return SEEDANCE_AGENT_PLAN_MODEL_MAP["agent_plan"]
        return seedance_model_map_for_endpoint(endpoint).get(
            operation,
            SEEDANCE_DEFAULT_MODEL_MAP[operation],
        )
    return value


def normalize_dashscope_sub_model(sub_model: Optional[str]) -> str:
    normalized = (sub_model or "wan26").strip().lower()
    if normalized not in DASHSCOPE_SUB_MODEL_ENV_MAP:
        raise ValueError(f"Unsupported DashScope sub_model: {sub_model}")
    return normalized


def get_dashscope_sub_model_env_key(sub_model: Optional[str]) -> str:
    return DASHSCOPE_SUB_MODEL_ENV_MAP[normalize_dashscope_sub_model(sub_model)]


def dashscope_vidu_reference_sub_model(value: Optional[str]) -> str:
    variant = (value or "q3").strip().lower()
    return DASHSCOPE_VIDU_REFERENCE_SUB_MODEL_MAP.get(variant, "vidu-reference-q3")


def dashscope_vidu_startend_sub_model(value: Optional[str]) -> str:
    variant = (value or "q3-turbo").strip().lower()
    return DASHSCOPE_VIDU_STARTEND_SUB_MODEL_MAP.get(variant, "vidu-startend-q3-turbo")


def is_dashscope_wan26_model(model_name: Optional[str]) -> bool:
    return (model_name or "").strip().lower().startswith("wan2.6")


def is_dashscope_kling_standard_model(model_name: Optional[str]) -> bool:
    normalized = (model_name or "").strip().lower()
    return "kling-v3-video-generation" in normalized and "omni" not in normalized


def is_dashscope_kling_omni_model(model_name: Optional[str]) -> bool:
    return "kling-v3-omni-video-generation" in (model_name or "").strip().lower()


def dashscope_model_matches_sub_model(sub_model: str, model_name: Optional[str]) -> bool:
    normalized_sub_model = normalize_dashscope_sub_model(sub_model)
    normalized_model = (model_name or "").strip().lower()
    default_model = DASHSCOPE_DEFAULT_MODEL_MAP.get(normalized_sub_model, "").lower()
    if normalized_model and normalized_model == default_model:
        return True
    if normalized_sub_model == "wan26":
        return is_dashscope_wan26_model(model_name)
    if normalized_sub_model == "kling-standard":
        return is_dashscope_kling_standard_model(model_name)
    if normalized_sub_model == "kling-omni":
        return is_dashscope_kling_omni_model(model_name)
    return False


def dashscope_sub_model_for_model(model_name: Optional[str]) -> Optional[str]:
    normalized_model = (model_name or "").strip().lower()
    if not normalized_model:
        return None
    for sub_model, default_model in DASHSCOPE_DEFAULT_MODEL_MAP.items():
        if normalized_model == default_model.lower():
            return sub_model
    if is_dashscope_wan26_model(model_name):
        return "wan26"
    if is_dashscope_kling_omni_model(model_name):
        return "kling-omni"
    if is_dashscope_kling_standard_model(model_name):
        return "kling-standard"
    return None


DEFAULT_PROVIDER_PROXY_MODE = "direct"
DEFAULT_PROVIDER_SUPPORTS_PROXY = True
DEFAULT_PROVIDER_FALLBACK_ENV: List[str] = []

PROVIDER_FALLBACK_ENV_OVERRIDES: Dict[str, List[str]] = {
    "seedance": ["ARK_API_KEY"],
    "veo": ["SORA2_API_KEY"],
}


PROVIDER_CATALOG: Dict[str, dict] = {
    "deepseek": {
        "label": "DeepSeek",
        "vendor": "deepseek",
        "capabilities": ["text"],
        "notes": "Text/chat provider used by script and reasoning flows.",
    },
    "gemini-text": {
        "label": "Gemini Text",
        "vendor": "google",
        "capabilities": ["text"],
        "fallback": [
            {
                "provider": "deepseek",
                "model_name": DEEPSEEK_DEFAULT_MODEL_MAP["deepseek-reasoner"],
                "when": ["missing_key", "health_error"],
            }
        ],
        "notes": "Google Gemini text generation.",
    },
    "gemini-image": {
        "label": "Gemini Image",
        "vendor": "google",
        "capabilities": ["image"],
        "notes": "Google Gemini image generation.",
    },
    "doubao": {
        "label": "Volcengine Ark / Doubao",
        "vendor": "volcengine",
        "capabilities": ["image"],
        "notes": "Ark-compatible image generation provider, including Agent Plan.",
        "access_modes": DOUBAO_IMAGE_ACCESS_MODES,
    },
    "seedance": {
        "label": "Seedance 2.0",
        "vendor": "volcengine",
        "capabilities": ["video"],
        "notes": "Volcengine Ark Seedance video generation, including Agent Plan.",
        "access_modes": SEEDANCE_ACCESS_MODES,
    },
    "dashscope": {
        "label": "DashScope / Model Studio",
        "vendor": "alibaba",
        "capabilities": ["video"],
        "notes": "Wan2.6, Kling, Vidu, and HappyHorse share this key.",
    },
    "minimax": {
        "label": "MiniMax / Hailuo",
        "vendor": "minimax",
        "capabilities": ["video", "audio", "text"],
        "notes": "MiniMax M3 text generation plus video, TTS, voice design, and voice clone.",
        "access_modes": MINIMAX_ACCESS_MODES,
    },
    "sora2": {
        "label": "Sora2 Gateway",
        "vendor": "laozhang",
        "capabilities": ["video"],
        "notes": "Laozhang Sora2-compatible video gateway.",
    },
    "veo": {
        "label": "Veo Gateway",
        "vendor": "laozhang",
        "capabilities": ["video"],
        "notes": "Laozhang Veo-compatible video gateway.",
    },
    "laozhang-gpt-image": {
        "label": "GPT Image VIP Gateway",
        "vendor": "laozhang",
        "capabilities": ["image"],
        "notes": "Default/VIP GPT Image token group.",
    },
    "laozhang-sora2": {
        "label": "GPT Image Official Gateway",
        "vendor": "laozhang",
        "capabilities": ["image"],
        "notes": "Official GPT Image token group.",
    },
}


DEFAULT_PROVIDER_HEALTH_CHECK: Dict[str, Any] = {
    "method": "GET",
    "path": "/models",
    "billable": False,
}

PROVIDER_HEALTH_CHECK_OVERRIDES: Dict[str, Dict[str, Any]] = {
    "dashscope": {
        "path": "/compatible-mode/v1/models",
    },
}

for _provider_id, _provider_meta in PROVIDER_CATALOG.items():
    _provider_meta.setdefault("required_env", [PROVIDER_ENV_MAP[_provider_id]])
    _provider_meta.setdefault(
        "fallback_env",
        list(PROVIDER_FALLBACK_ENV_OVERRIDES.get(_provider_id, DEFAULT_PROVIDER_FALLBACK_ENV)),
    )
    _provider_meta.setdefault("default_proxy_mode", DEFAULT_PROVIDER_PROXY_MODE)
    _provider_meta.setdefault("supports_proxy", DEFAULT_PROVIDER_SUPPORTS_PROXY)
    _health_check = deepcopy(DEFAULT_PROVIDER_HEALTH_CHECK)
    _health_check.update(PROVIDER_HEALTH_CHECK_OVERRIDES.get(_provider_id, {}))
    _provider_meta.setdefault("health_check", _health_check)
    _credential_links = deepcopy(VENDOR_CREDENTIAL_LINKS.get(_provider_meta.get("vendor", ""), {}))
    if _provider_id in PROVIDER_KEY_HELP:
        _credential_links["key_help"] = PROVIDER_KEY_HELP[_provider_id]
    for _link_key, _link_value in _credential_links.items():
        _provider_meta.setdefault(_link_key, _link_value)


PROVIDER_DEFAULT_ENDPOINTS: Dict[str, str] = {
    "gemini-text": "https://api.laozhang.ai/v1",
    "deepseek": "https://api.deepseek.com",
    "gemini-image": "https://api.laozhang.ai/v1beta",
    "doubao": DOUBAO_IMAGE_STANDARD_ENDPOINT,
    "minimax": MINIMAX_DOMESTIC_ENDPOINT,
    "sora2": "https://api.laozhang.ai/v1",
    "veo": "https://api.laozhang.ai/v1",
    "dashscope": "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
    "seedance": SEEDANCE_STANDARD_ENDPOINT,
    "laozhang-gpt-image": "https://api.laozhang.ai/v1",
    "laozhang-sora2": "https://api.laozhang.ai/v1",
}

PROVIDER_API_PATHS: Dict[str, Dict[str, str]] = {
    "deepseek": {
        "chat_completions": "chat/completions",
    },
    "gemini-text": {
        "chat_completions": "chat/completions",
        "generate_content": "models/{model}:generateContent",
    },
    "gemini-image": {
        "generate_content": "models/{model}:generateContent",
    },
    "doubao": {
        "image_generations": "images/generations",
        "content_generation_tasks": "contents/generations/tasks",
        "task": "{task_id}",
    },
    "minimax": {
        "chat_completions": "chat/completions",
        "video_generation": "video_generation",
        "query_video_generation": "query/video_generation",
        "files_retrieve": "files/retrieve",
        "files_upload": "files/upload",
        "files_delete": "files/delete",
        "voice_design": "voice_design",
        "voice_clone": "voice_clone",
        "get_voice": "get_voice",
        "delete_voice": "delete_voice",
        "tts_sync": "t2a_v2",
        "tts_async": "t2a_async_v2",
        "tts_query": "query/t2a_async_query_v2",
        "music_generation": "music_generation",
        "lyrics_generation": "lyrics_generation",
    },
    "sora2": {
        "videos": "videos",
        "video": "videos/{video_id}",
        "video_content": "videos/{video_id}/content",
    },
    "veo": {
        "chat_completions": "chat/completions",
        "video": "videos/{video_id}",
        "video_content": "videos/{video_id}/content",
    },
    "seedance": {
        "task": "{task_id}",
    },
    "laozhang-gpt-image": {
        "image_edits": "images/edits",
        "image_generations": "images/generations",
    },
    "laozhang-sora2": {
        "image_edits": "images/edits",
        "image_generations": "images/generations",
    },
}


API_MODEL_PRESETS: List[dict] = [
    {
        "name": "Gemini 2.5 Flash (文本)",
        "provider": "gemini-text",
        "model_name": "gemini-2.5-flash",
    },
    {
        "name": "DeepSeek Reasoner",
        "provider": "deepseek",
        "operation": "deepseek-reasoner",
        "model_name": DEEPSEEK_DEFAULT_MODEL_MAP["deepseek-reasoner"],
    },
    {
        "name": "DeepSeek Chat",
        "provider": "deepseek",
        "operation": "deepseek-chat",
        "model_name": DEEPSEEK_DEFAULT_MODEL_MAP["deepseek-chat"],
    },
    {
        "name": "Gemini 2.5 Flash Image",
        "provider": "gemini-image",
        "operation": "gemini-2.5-flash-image",
        "operation_label": "Gemini 2.5 Flash Image",
        "model_name": "gemini-2.5-flash-image",
    },
    {
        "name": "Gemini 3.1 Flash Image Preview",
        "provider": "gemini-image",
        "operation": "gemini-3-pro-image-preview",
        "operation_label": "Gemini 3.1 Flash Image Preview",
        "model_name": "gemini-3.1-flash-image-preview",
    },
    {
        "name": "Doubao Seedream 5.0 Lite",
        "provider": "doubao",
        "model_name": DOUBAO_IMAGE_DEFAULT_MODEL,
    },
    {
        "name": "Doubao SeedDream 5.0 Pro",
        "provider": "doubao",
        "model_name": "doubao-seedream-5-0-pro-260628",
    },
    {
        "name": "MiniMax Hailuo 2.3",
        "provider": "minimax",
        "model_name": MINIMAX_DEFAULT_VIDEO_MODEL,
        "operation": "video-standard",
        "operation_label": "MiniMax Hailuo 2.3",
    },
    {
        "name": "MiniMax Hailuo 2.3 Fast",
        "provider": "minimax",
        "model_name": MINIMAX_FAST_VIDEO_MODEL,
        "operation": "video-fast",
        "operation_label": "MiniMax Hailuo 2.3 Fast",
    },
    {
        "name": "MiniMax Speech 2.8 HD",
        "provider": "minimax",
        "model_name": MINIMAX_TTS_HD_MODEL,
        "operation": "speech-hd",
        "operation_label": "语音生成 (Speech 2.8 HD)",
        "category": "audio",
    },
    {
        "name": "MiniMax Speech 2.8 Turbo",
        "provider": "minimax",
        "model_name": MINIMAX_TTS_TURBO_MODEL,
        "operation": "speech-turbo",
        "operation_label": "语音生成 (Speech 2.8 Turbo)",
        "category": "audio",
    },
    {
        "name": "MiniMax Music 2.6",
        "provider": "minimax",
        "model_name": MINIMAX_MUSIC_MODEL,
        "operation": MINIMAX_MUSIC_OPERATION,
        "operation_label": "音乐生成 (Music 2.6)",
        "category": "audio",
    },
    {
        "name": "MiniMax M3",
        "provider": "minimax",
        "model_name": MINIMAX_M3_MODEL,
        "operation": MINIMAX_M3_OPERATION,
        "operation_label": "MiniMax M3 文本",
        "category": "text",
    },
    {
        "name": "Sora2",
        "provider": "sora2",
        "model_name": SORA2_DEFAULT_VIDEO_MODEL,
    },
    {
        "name": "Veo",
        "provider": "veo",
        "model_name": VEO_DEFAULT_VIDEO_MODEL,
    },
    {
        "name": "Wan 2.6 I2V (DashScope)",
        "provider": "dashscope",
        "model_name": DASHSCOPE_DEFAULT_MODEL_MAP["wan26"],
    },
    {
        "name": "阿里云百炼共享 API · Kling V3",
        "provider": "dashscope",
        "model_name": "kling/kling-v3-video-generation",
    },
    {
        "name": "阿里云百炼共享 API · Vidu Q3",
        "provider": "dashscope",
        "model_name": "vidu/viduq3-turbo_reference2video",
    },
    {
        "name": "阿里云百炼共享 API · HappyHorse 1.0",
        "provider": "dashscope",
        "model_name": "happyhorse-1.0-r2v",
    },
    {
        "name": "Doubao Seedance 1.5 Pro · Agent Plan",
        "provider": "seedance",
        "model_name": "doubao-seedance-1.5-pro",
    },
    {
        "name": "Doubao Seedance 2.0 Standard",
        "provider": "seedance",
        "model_name": "doubao-seedance-2-0-260128",
    },
    {
        "name": "Doubao Seedance 2.0 Fast",
        "provider": "seedance",
        "model_name": "doubao-seedance-2-0-fast-260128",
    },
    {
        "name": "Doubao Seedance 2.0 Mini",
        "provider": "seedance",
        "model_name": "doubao-seedance-2-0-mini-260615",
    },
    {
        "name": "laozhang GPT Image (VIP)",
        "provider": "laozhang-gpt-image",
        "model_name": "gpt-image-2-vip",
    },
    {
        "name": "laozhang GPT Image (Official)",
        "provider": "laozhang-sora2",
        "model_name": "gpt-image-2",
    },
]


GEMINI_IMAGE_MODEL_ALIASES: Dict[str, str] = {
    "gemini-3-pro-image-preview": "gemini-3.1-flash-image-preview",
    "nanobanana": "gemini-3.1-flash-image-preview",
}


GPT_IMAGE_TIERS: Dict[str, dict] = {
    "vip": {
        "provider": "laozhang-gpt-image",
        "model": "gpt-image-2-vip",
        "key_hint": "GPT_IMAGE_API_KEY (laozhang default group)",
    },
    "official": {
        "provider": "laozhang-sora2",
        "model": "gpt-image-2",
        "key_hint": "SORA2_GPT_IMAGE_API_KEY (laozhang Sora2Official group)",
    },
}


def normalize_gemini_image_model(model: Optional[str]) -> Optional[str]:
    requested = (model or "").strip()
    if not requested:
        return None
    return GEMINI_IMAGE_MODEL_ALIASES.get(requested, requested)


def normalize_doubao_image_model(model: Optional[str]) -> Optional[str]:
    requested = (model or "").strip()
    if not requested:
        return None
    return DOUBAO_IMAGE_MODEL_ALIASES.get(requested.lower(), requested)


def _runtime_model_override(
    model: Optional[str],
    *,
    default_model: str,
    legacy_models: frozenset[str],
) -> Optional[str]:
    normalized = (model or "").strip()
    if not normalized or normalized == default_model or normalized in legacy_models:
        return None
    return normalized


def _normalize_video_model(
    model: Optional[str],
    *,
    default_model: str,
    legacy_models: frozenset[str],
) -> str:
    normalized = (model or "").strip()
    if not normalized or normalized in legacy_models:
        return default_model
    return normalized


def minimax_runtime_model_override(model: Optional[str]) -> Optional[str]:
    """Treat MiniMax empty/default names as fallback so runtime config can win."""
    return _runtime_model_override(
        model,
        default_model=MINIMAX_DEFAULT_VIDEO_MODEL,
        legacy_models=MINIMAX_LEGACY_VIDEO_MODELS,
    )


def normalize_minimax_video_model(model: Optional[str]) -> str:
    return _normalize_video_model(
        model,
        default_model=MINIMAX_DEFAULT_VIDEO_MODEL,
        legacy_models=MINIMAX_LEGACY_VIDEO_MODELS,
    )


def sora2_runtime_model_override(model: Optional[str]) -> Optional[str]:
    """Treat legacy/default Sora2 names as fallback so runtime config can win."""
    return _runtime_model_override(
        model,
        default_model=SORA2_DEFAULT_VIDEO_MODEL,
        legacy_models=SORA2_LEGACY_VIDEO_MODELS,
    )


def normalize_sora2_video_model(model: Optional[str]) -> str:
    return _normalize_video_model(
        model,
        default_model=SORA2_DEFAULT_VIDEO_MODEL,
        legacy_models=SORA2_LEGACY_VIDEO_MODELS,
    )


def veo_runtime_model_override(model: Optional[str]) -> Optional[str]:
    """Treat legacy/default Veo names as fallback so runtime config can win."""
    return _runtime_model_override(
        model,
        default_model=VEO_DEFAULT_VIDEO_MODEL,
        legacy_models=VEO_LEGACY_VIDEO_MODELS,
    )


def normalize_veo_video_model(model: Optional[str]) -> str:
    return _normalize_video_model(
        model,
        default_model=VEO_DEFAULT_VIDEO_MODEL,
        legacy_models=VEO_LEGACY_VIDEO_MODELS,
    )


def normalize_provider(provider: str) -> str:
    return (provider or "").strip().lower()


def get_provider_env_key(provider: str) -> str | None:
    return PROVIDER_ENV_MAP.get(normalize_provider(provider))


def get_provider_extra_env_keys(provider: str) -> Dict[str, str]:
    return deepcopy(PROVIDER_EXTRA_ENV_MAP.get(normalize_provider(provider), {}))


def get_provider_extra_env_key(provider: str, field: str) -> str | None:
    return get_provider_extra_env_keys(provider).get((field or "").strip().lower())


def get_provider_extra_fields(provider: str) -> List[Dict[str, Any]]:
    provider_id = normalize_provider(provider)
    env_keys = get_provider_extra_env_keys(provider_id)
    fields = deepcopy(PROVIDER_EXTRA_FIELD_CATALOG.get(provider_id, []))
    for item in fields:
        field = str(item.get("field") or "").strip().lower()
        if field:
            item["field"] = field
            item.setdefault("env_key", env_keys.get(field))
        item.setdefault("target", "request_template")
        item.setdefault("input_type", "text")
        item.setdefault("secret", False)
        item.setdefault("aliases", [])
    return fields


def get_endpoint_env_key(env_key: str) -> str:
    return env_key.replace("_API_KEY", "_ENDPOINT").replace("_KEY", "_ENDPOINT")


def get_proxy_mode_env_key(env_key: str) -> str:
    return env_key.replace("_API_KEY", "_PROXY_MODE").replace("_KEY", "_PROXY_MODE")


def get_custom_proxy_env_key(env_key: str) -> str:
    return env_key.replace("_API_KEY", "_CUSTOM_PROXY").replace("_KEY", "_CUSTOM_PROXY")


def get_model_env_key(env_key: str) -> str:
    return env_key.replace("_API_KEY", "_MODEL").replace("_KEY", "_MODEL")


def get_provider_default_endpoint(provider: str) -> str:
    return PROVIDER_DEFAULT_ENDPOINTS.get(normalize_provider(provider), "")


def is_google_generative_language_endpoint(endpoint: Optional[str]) -> bool:
    default_endpoint = GOOGLE_GENERATIVE_LANGUAGE_ENDPOINT.rstrip("/").lower()
    value = str(endpoint or "").strip().rstrip("/").lower()
    return bool(default_endpoint and value.startswith(default_endpoint))


def get_provider_api_path(provider: str, operation: str, **path_params: Any) -> str:
    template = PROVIDER_API_PATHS.get(normalize_provider(provider), {}).get((operation or "").strip(), "")
    if not template:
        return ""
    return template.format(**{key: str(value) for key, value in path_params.items()})


def get_provider_operation_paths(provider: str) -> Dict[str, str]:
    return deepcopy(PROVIDER_API_PATHS.get(normalize_provider(provider), {}))


def build_provider_operation_url_templates(provider: str, endpoint: str) -> Dict[str, str]:
    base = (endpoint or "").strip().rstrip("/")
    if not base:
        return {}
    urls: Dict[str, str] = {}
    for operation, path in get_provider_operation_paths(provider).items():
        suffix = (path or "").strip("/")
        if not suffix:
            urls[operation] = base
        elif base.endswith(f"/{suffix}"):
            urls[operation] = base
        else:
            urls[operation] = f"{base}/{suffix}"
    return urls


def get_provider_default_category(provider: str) -> str:
    capabilities = PROVIDER_CATALOG.get(normalize_provider(provider), {}).get("capabilities") or []
    return str(capabilities[0]) if capabilities else ""


def _default_health_check_url(endpoint: str, provider: str = "") -> str:
    urls = derive_models_health_urls(endpoint, provider)
    return urls[0] if urls else ""


def _enrich_preset(preset: dict) -> dict:
    out = deepcopy(preset)
    provider = normalize_provider(out.get("provider", ""))
    env_key = get_provider_env_key(provider)
    meta = PROVIDER_CATALOG.get(provider, {})
    out.setdefault("endpoint", get_provider_default_endpoint(provider))
    out.setdefault("category", get_provider_default_category(provider))
    out.setdefault("proxy_mode", meta.get("default_proxy_mode", DEFAULT_PROVIDER_PROXY_MODE))
    out.setdefault("supports_proxy", meta.get("supports_proxy", DEFAULT_PROVIDER_SUPPORTS_PROXY))
    out.setdefault("health_check_url", _default_health_check_url(out.get("endpoint", ""), provider))
    out.setdefault("required_key", env_key)
    return out


def get_api_model_presets() -> List[dict]:
    return [_enrich_preset(preset) for preset in API_MODEL_PRESETS]


def get_api_model_preset(provider: str, model_name: Optional[str] = None) -> Optional[dict]:
    normalized = normalize_provider(provider)
    matches = [
        preset
        for preset in get_api_model_presets()
        if normalize_provider(preset.get("provider", "")) == normalized
    ]
    if model_name:
        for preset in matches:
            if preset.get("model_name") == model_name:
                return preset
    return matches[0] if matches else None


def get_provider_model_binding_options(
    provider: str,
    *,
    include_scopes: bool = False,
) -> List[Dict[str, Any]]:
    """Return the front-end operation/model choices supported by one API card."""
    provider_id = normalize_provider(provider)
    if provider_id == "deepseek":
        options = deepcopy(DEEPSEEK_MODEL_BINDING_OPTIONS)
    elif provider_id == "doubao":
        options = deepcopy(DOUBAO_IMAGE_MODEL_BINDING_OPTIONS)
    elif provider_id == "seedance":
        options = deepcopy(SEEDANCE_MODEL_BINDING_OPTIONS)
    elif provider_id == "dashscope":
        options = deepcopy(DASHSCOPE_MODEL_BINDING_OPTIONS)
    elif provider_id == "minimax":
        options = deepcopy(MINIMAX_MODEL_BINDING_OPTIONS)
    else:
        options = []
        seen: set[str] = set()
        for preset in API_MODEL_PRESETS:
            if normalize_provider(str(preset.get("provider") or "")) != provider_id:
                continue
            model_name = str(preset.get("model_name") or "").strip()
            if not model_name:
                continue
            operation = str(preset.get("operation") or model_name).strip().lower()
            if not operation or operation in seen:
                continue
            seen.add(operation)
            options.append(
                {
                    "operation": operation,
                    "label": str(preset.get("operation_label") or preset.get("name") or operation).strip(),
                    "model_name": model_name,
                }
            )

    public_options: List[Dict[str, Any]] = []
    for option in options:
        defaults = model_binding_public_defaults(
            provider_id,
            str(option.get("operation") or ""),
            label=str(option.get("label") or ""),
            model_name=str(option.get("model_name") or ""),
        )
        if defaults.get("front_model_key"):
            option = {
                **option,
                **defaults,
                "display_name": "",
                "description": "",
                "published": True,
            }
        public_options.append(option)
    options = public_options
    return expand_model_binding_scope_options(options) if include_scopes else options


def infer_model_binding_operation(provider: str, model_name: Optional[str]) -> str:
    provider_id = normalize_provider(provider)
    normalized_model = str(model_name or "").strip()
    if provider_id == "doubao":
        return "generate"
    if provider_id == "seedance":
        if normalized_model.lower() in SEEDANCE_SUB_MODEL_ENV_MAP:
            return normalized_model.lower()
        if normalized_model.lower() == SEEDANCE_AGENT_PLAN_MODEL_MAP["agent_plan"].lower():
            return "agent_plan"
        if is_seedance_mini_model(normalized_model):
            return "mini"
        return "fast" if is_seedance_fast_model(normalized_model) else "standard"
    if provider_id == "dashscope":
        return dashscope_sub_model_for_model(normalized_model) or "default"
    for option in get_provider_model_binding_options(provider_id):
        if option["model_name"].lower() == normalized_model.lower():
            return option["operation"]
    return "default"


def normalize_model_bindings(
    provider: str,
    bindings: Any,
    legacy_model_name: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Normalize one-card/many-model bindings and enforce one model per operation."""
    provider_id = normalize_provider(provider)
    raw_bindings = bindings
    if isinstance(raw_bindings, str):
        try:
            raw_bindings = json.loads(raw_bindings) if raw_bindings.strip() else []
        except json.JSONDecodeError:
            raw_bindings = []
    if not isinstance(raw_bindings, list):
        raw_bindings = []

    binding_options = get_provider_model_binding_options(provider, include_scopes=True)
    options_by_key = {
        (normalize_model_usage_scope(item.get("scope")), item["operation"]): item
        for item in binding_options
    }
    option_labels = {key: item["label"] for key, item in options_by_key.items()}
    normalized: Dict[tuple[str, str], Dict[str, Any]] = {}
    for item in raw_bindings:
        if not isinstance(item, dict):
            continue
        model_name = str(item.get("model_name") or "").strip()
        if not model_name:
            continue
        if provider_id == "deepseek":
            model_name = normalize_deepseek_model_name(model_name)
        scope = normalize_model_usage_scope(item.get("scope"))
        operation = str(item.get("operation") or "").strip().lower()
        inferred_operation = infer_model_binding_operation(provider, model_name)
        if provider_id == "doubao":
            operation = "generate"
        elif provider_id == "gemini-image" and inferred_operation != "default" and (scope, operation) not in option_labels:
            operation = inferred_operation
        elif provider_id == "seedance" and inferred_operation == "agent_plan":
            operation = "agent_plan"
        elif not operation or (operation == "default" and inferred_operation != "default"):
            operation = inferred_operation
        default_option = options_by_key.get((scope, operation)) or {}
        defaults = model_binding_public_defaults(
            provider_id,
            operation,
            label=str(default_option.get("label") or item.get("label") or operation),
            model_name=model_name,
        )
        display_name = str(item.get("display_name") or "").strip()
        description = str(item.get("description") or "").strip()
        default_display_name = str(defaults.get("default_display_name") or model_name).strip()
        default_description = str(defaults.get("default_description") or "").strip()
        effective_name = display_name or default_display_name
        effective_description = description or default_description
        published_raw = item.get("published", True)
        published = published_raw is not False and str(published_raw).strip().lower() not in {"0", "false", "no", "off"}
        normalized_binding: Dict[str, Any] = {
            "operation": operation,
            "label": str(item.get("label") or default_option.get("label") or operation).strip(),
            "model_name": model_name,
            "scope": scope,
            "scope_label": MODEL_USAGE_SCOPE_LABELS[scope],
        }
        if defaults.get("front_model_key"):
            normalized_binding.update({
                "label": f"{effective_name} · {effective_description}" if effective_description else effective_name,
                "front_model_key": str(defaults.get("front_model_key") or "").strip(),
                "default_display_name": default_display_name,
                "default_description": default_description,
                "display_name": display_name,
                "description": description,
                "published": published,
            })
        normalized[(scope, operation)] = normalized_binding
        if item.get("scope") is None or not str(item.get("scope")).strip():
            # Bindings created before usage scopes apply to both editors. Match
            # the runtime loader's explicit-key expansion instead of pairing
            # the legacy credential with a synthesized Studio model default.
            for legacy_scope in MODEL_USAGE_SCOPES:
                normalized[(legacy_scope, operation)] = _with_model_usage_scope(
                    normalized_binding, legacy_scope,
                )

    fallback_model = str(legacy_model_name or "").strip()
    if provider_id == "deepseek":
        fallback_model = normalize_deepseek_model_name(fallback_model)
    if not normalized and fallback_model:
        operation = infer_model_binding_operation(provider, fallback_model)
        scope = MODEL_USAGE_SCOPE_WORKFLOW
        option = options_by_key.get((scope, operation)) or {
            "operation": operation,
            "label": option_labels.get((scope, operation)) or operation,
            "model_name": fallback_model,
            "scope": scope,
            "scope_label": MODEL_USAGE_SCOPE_LABELS[scope],
        }
        normalized[(scope, operation)] = deepcopy(option)
        # Registry options supply UI metadata, not a replacement for a stored
        # deployment/model ID. Only a bare operation alias requests its default
        # model; custom IDs must reach runtime and diagnostics unchanged.
        if fallback_model.lower() != operation:
            normalized[(scope, operation)]["model_name"] = fallback_model
    if provider_id in {"gemini-text", "gemini-image", "deepseek", "doubao", "seedance", "dashscope", "minimax"} and normalized:
        for option in get_provider_model_binding_options(provider_id, include_scopes=True):
            operation = option["operation"]
            scope = normalize_model_usage_scope(option.get("scope"))
            if (scope, operation) not in normalized:
                normalized[(scope, operation)] = deepcopy(option)
    return list(normalized.values())


def primary_model_name_for_bindings(
    bindings: Any,
    fallback: Optional[str] = None,
    *,
    scope: Optional[str] = MODEL_USAGE_SCOPE_WORKFLOW,
) -> str:
    target_scope = normalize_model_usage_scope(scope)
    if isinstance(bindings, list):
        for item in bindings:
            if isinstance(item, dict):
                item_scope = normalize_model_usage_scope(item.get("scope"))
                if item_scope != target_scope:
                    continue
                model_name = str(item.get("model_name") or "").strip()
                if model_name:
                    return model_name
    return str(fallback or "").strip()


def normalize_gpt_image_tier(tier: Optional[str]) -> str:
    normalized = (tier or "vip").strip().lower()
    if normalized not in GPT_IMAGE_TIERS:
        raise KeyError(normalized)
    return normalized


def get_gpt_image_tier(tier: Optional[str]) -> tuple[str, dict]:
    normalized = normalize_gpt_image_tier(tier)
    return normalized, deepcopy(GPT_IMAGE_TIERS[normalized])


def get_gpt_image_tiers() -> Dict[str, dict]:
    return deepcopy(GPT_IMAGE_TIERS)


def get_api_provider_catalog() -> List[dict]:
    presets = get_api_model_presets()
    counts: Dict[str, int] = {}
    categories: Dict[str, set] = {}
    defaults: Dict[str, dict] = {}
    for preset in presets:
        provider = normalize_provider(preset.get("provider", ""))
        if not provider:
            continue
        counts[provider] = counts.get(provider, 0) + 1
        defaults.setdefault(provider, preset)
        cat = preset.get("category") or ""
        if cat:
            categories.setdefault(provider, set()).add(cat)

    out: List[dict] = []
    for provider in sorted(set(PROVIDER_ENV_MAP) | set(PROVIDER_CATALOG)):
        item = deepcopy(PROVIDER_CATALOG.get(provider, {}))
        default_preset = defaults.get(provider, {})
        item.update(
            {
                "provider": provider,
                "env_key": PROVIDER_ENV_MAP.get(provider),
                "endpoint_env_key": get_endpoint_env_key(PROVIDER_ENV_MAP[provider])
                if provider in PROVIDER_ENV_MAP
                else None,
                "proxy_mode_env_key": get_proxy_mode_env_key(PROVIDER_ENV_MAP[provider])
                if provider in PROVIDER_ENV_MAP
                else None,
                "custom_proxy_env_key": get_custom_proxy_env_key(PROVIDER_ENV_MAP[provider])
                if provider in PROVIDER_ENV_MAP
                else None,
                "model_env_key": get_model_env_key(PROVIDER_ENV_MAP[provider])
                if provider in PROVIDER_ENV_MAP
                else None,
                "extra_fields": get_provider_extra_fields(provider),
                "model_binding_options": get_provider_model_binding_options(provider, include_scopes=True),
                "model_usage_scopes": [
                    {"scope": scope, "label": MODEL_USAGE_SCOPE_LABELS[scope]}
                    for scope in MODEL_USAGE_SCOPES
                ],
                "access_modes": deepcopy(item.get("access_modes") or []),
                "operation_paths": get_provider_operation_paths(provider),
                "default_operation_url_templates": build_provider_operation_url_templates(
                    provider,
                    default_preset.get("endpoint") or "",
                ),
                "health_check_url": default_preset.get("health_check_url")
                or _default_health_check_url(default_preset.get("endpoint", ""), provider),
                "fallback": item.get("fallback", []),
                "default_config_name": default_preset.get("name"),
                "default_endpoint": default_preset.get("endpoint"),
                "default_model_name": default_preset.get("model_name"),
                "default_category": default_preset.get("category"),
                "default_proxy_mode": default_preset.get("proxy_mode")
                or item.get("default_proxy_mode", DEFAULT_PROVIDER_PROXY_MODE),
                "preset_count": counts.get(provider, 0),
                "preset_categories": sorted(categories.get(provider, set())),
            }
        )
        out.append(item)
    return out


def _config_has_key(config: Any) -> bool:
    value = _config_get(config, "api_key_encrypted", "")
    return bool(value)


def summarize_api_provider_configs(configs: List[Any]) -> List[dict]:
    """Return provider-level readiness without exposing secret values.

    A provider can have several model preset rows that share one runtime env key.
    The summary makes that visible so the admin UI can show whether a provider is
    actually ready, not just whether each individual model card has a key.
    """
    provider_catalog = {item["provider"]: item for item in get_api_provider_catalog()}
    grouped: Dict[str, List[Any]] = {}
    for config in configs or []:
        provider = normalize_provider(_config_get(config, "provider", ""))
        if not provider:
            provider = "__custom__"
        grouped.setdefault(provider, []).append(config)

    provider_ids = sorted(set(provider_catalog) | {p for p in grouped if p != "__custom__"})
    if "__custom__" in grouped:
        provider_ids.append("__custom__")

    summaries: List[dict] = []
    for provider in provider_ids:
        rows = grouped.get(provider, [])
        meta = provider_catalog.get(provider, {})
        env_key = meta.get("env_key")

        total = len(rows)
        enabled_rows = [r for r in rows if _config_get(r, "enabled", True) is not False]
        keyed_rows = [r for r in rows if _config_has_key(r)]
        ready_rows = [r for r in enabled_rows if _config_has_key(r)]
        missing_key_rows = [r for r in rows if not _config_has_key(r)]
        disabled_rows = [r for r in rows if _config_get(r, "enabled", True) is False]

        active_model_counts: Dict[str, int] = {}
        enabled_endpoints = set()
        for row in enabled_rows:
            bindings = normalize_model_bindings(
                provider,
                _config_get(row, "model_bindings", []),
                str(_config_get(row, "model_name", "") or ""),
            )
            for binding in bindings:
                model_name = binding["model_name"]
                active_model_counts[model_name] = active_model_counts.get(model_name, 0) + 1
            endpoint = str(_config_get(row, "endpoint", "") or "").strip()
            if endpoint:
                enabled_endpoints.add(endpoint)
        # and models. Only simultaneous active cards are a runtime conflict.
        duplicate_models: List[str] = []
        duplicate_enabled_models = sorted([m for m, count in active_model_counts.items() if count > 1])

        issues: List[str] = []
        if total == 0:
            status = "not_imported"
            issues.append("not_imported")
        elif ready_rows:
            status = "ready"
            if missing_key_rows:
                issues.append("some_configs_missing_key")
        elif keyed_rows and not enabled_rows:
            status = "disabled"
            issues.append("all_keyed_configs_disabled")
        else:
            status = "missing_key"
            issues.append("missing_key")

        if duplicate_enabled_models:
            issues.append("duplicate_enabled_models")
        if env_key and len(ready_rows) > 1:
            issues.append("multiple_enabled_configs_share_env")
        if env_key and len(enabled_endpoints) > 1:
            issues.append("endpoint_env_conflict")

        summaries.append(
            {
                "provider": None if provider == "__custom__" else provider,
                "label": meta.get("label") or ("Custom" if provider == "__custom__" else provider),
                "vendor": meta.get("vendor") or "",
                "env_key": env_key,
                "endpoint_env_key": meta.get("endpoint_env_key"),
                "required_env": meta.get("required_env", []),
                "fallback_env": meta.get("fallback_env", []),
                "capabilities": meta.get("capabilities", []),
                "operation_paths": meta.get("operation_paths", {}),
                "status": status,
                "ready": bool(ready_rows),
                "issues": issues,
                "counts": {
                    "configs": total,
                    "enabled": len(enabled_rows),
                    "configured": len(keyed_rows),
                    "ready": len(ready_rows),
                    "missing_key": len(missing_key_rows),
                    "disabled": len(disabled_rows),
                    "presets": meta.get("preset_count", 0),
                },
                "duplicate_models": duplicate_models,
                "duplicate_enabled_models": duplicate_enabled_models,
                "enabled_endpoint_count": len(enabled_endpoints),
                "configs": [
                    {
                        "config_id": _config_get(row, "config_id", ""),
                        "name": _config_get(row, "name", ""),
                        "model_name": _config_get(row, "model_name", ""),
                        "endpoint": _config_get(row, "endpoint", ""),
                        "enabled": _config_get(row, "enabled", True) is not False,
                        "has_key": _config_has_key(row),
                    }
                    for row in rows
                ],
            }
        )
    return summaries
