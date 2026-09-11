"""Online-only video capabilities for the source edition.

This module deliberately has no imports from node, Agent, workflow, GPU, or
local-execution packages. Missing provider credentials and failed health checks
are represented as disabled models with a user-facing reason.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, List, Optional, Tuple

from services.api_provider_health_monitor import list_cached_provider_health
from services.api_provider_registry import (
    DASHSCOPE_DEFAULT_MODEL_MAP,
    MINIMAX_DEFAULT_VIDEO_MODEL,
    MINIMAX_FAST_VIDEO_MODEL,
    MODEL_USAGE_SCOPE_WORKFLOW,
    SEEDANCE_AGENT_PLAN_MODEL_MAP,
    SORA2_DEFAULT_VIDEO_MODEL,
    VEO_DEFAULT_VIDEO_MODEL,
    normalize_model_usage_scope,
)
from services.api_provider_runtime import (
    provider_is_usable,
    resolve_dashscope_model_name,
    resolve_provider,
    resolve_seedance_model_name,
)
from services.online_video_catalog_service import (
    apply_public_video_catalog,
    default_public_video_label,
    is_seedance_omni_model,
    load_public_video_catalog,
)


logger = logging.getLogger(__name__)


def _provider_runtime_state(
    provider: str,
    model_name: Optional[str],
    provider_health: Iterable[Dict[str, Any]],
    *,
    usage_scope: str,
) -> Tuple[bool, str, str]:
    try:
        config = resolve_provider(provider, model_name, usage_scope=usage_scope)
        runtime_model = str(config.model_name or model_name or "").strip()
        if not config.has_key:
            return False, runtime_model, "后台未配置该平台的 API 密钥"
        if not provider_is_usable(provider, provider_health, model_name=runtime_model or None):
            return False, runtime_model, "平台健康检查失败，请管理员检查账号、额度、地域和网络"
        return True, runtime_model, ""
    except Exception as exc:
        logger.debug("public video provider probe failed: provider=%s error=%s", provider, exc)
        return False, str(model_name or "").strip(), "平台配置无效或运行时不可用"


def _manifest_entry(
    *,
    key: str,
    label: str,
    provider: str,
    model_name: str,
    available: bool,
    unavailable_reason: str,
    task_types: List[str],
    media_inputs: List[str],
    parameter_rules: Dict[str, Any],
    model_options: Optional[List[str]] = None,
    supports_original_audio: bool = False,
) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "key": key,
        "label": label,
        "provider": provider,
        "model_name": model_name,
        "available": available,
        "unavailable_reason": unavailable_reason if not available else "",
        "task_types": task_types,
        "media_inputs": media_inputs,
        "supports_original_audio": supports_original_audio,
        "supports_cancel": False,
        "requires_gpu_node": False,
        "requires_processing_node": False,
        "query_mode": "async",
        "parameter_rules": parameter_rules,
    }
    if model_options:
        result["model_options"] = model_options
    return result


def _dashscope_options(sub_models: Iterable[str], *, usage_scope: str) -> List[str]:
    values: List[str] = []
    for sub_model in sub_models:
        try:
            value = resolve_dashscope_model_name(sub_model, usage_scope=usage_scope)
        except Exception as exc:
            logger.debug("public DashScope model probe failed: sub_model=%s error=%s", sub_model, exc)
            value = DASHSCOPE_DEFAULT_MODEL_MAP.get(sub_model, "")
        if value and value not in values:
            values.append(value)
    return values


async def get_public_video_capabilities(
    usage_scope: str = MODEL_USAGE_SCOPE_WORKFLOW,
) -> Dict[str, Any]:
    scope = normalize_model_usage_scope(usage_scope)
    catalog = await load_public_video_catalog(scope)
    try:
        provider_health = await list_cached_provider_health()
    except Exception as exc:
        logger.debug("public provider health cache unavailable: %s", exc)
        provider_health = []

    def state(provider: str, model_name: Optional[str] = None) -> Tuple[bool, str, str]:
        return _provider_runtime_state(
            provider,
            model_name,
            provider_health,
            usage_scope=scope,
        )

    seedance_models: Dict[str, str] = {}
    for operation, key in (
        ("agent_plan", "Seedance15"),
        ("standard", "Seedance2"),
        ("fast", "Seedance2Fast"),
        ("mini", "Seedance2Mini"),
    ):
        try:
            seedance_models[key] = resolve_seedance_model_name(operation, usage_scope=scope)
        except Exception as exc:
            logger.debug("public Seedance model probe failed: operation=%s error=%s", operation, exc)
            seedance_models[key] = (
                SEEDANCE_AGENT_PLAN_MODEL_MAP["agent_plan"] if operation == "agent_plan" else ""
            )

    seedance_omni = any(
        is_seedance_omni_model(seedance_models[key])
        for key in ("Seedance2", "Seedance2Fast", "Seedance2Mini")
    )
    models: List[Dict[str, Any]] = []
    seedance_specs = (
        ("Seedance15", "agent_plan", "Seedance 1.5 Pro", ["i2v", "first_last_frame"], ["first_frame", "last_frame"]),
        ("Seedance2", "standard", "Seedance 2.0", ["t2v", "i2v", "first_last_frame", "multi_reference"], ["first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"]),
        ("Seedance2Fast", "fast", "Seedance 2.0 Fast", ["t2v", "i2v", "first_last_frame", "multi_reference"], ["first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"]),
        ("Seedance2Mini", "mini", "Seedance 2.0 Mini", ["t2v", "i2v", "first_last_frame", "multi_reference"], ["first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"]),
    )
    for key, operation, fallback_label, task_types, media_inputs in seedance_specs:
        available, runtime_model, reason = state("seedance", seedance_models[key] or None)
        resolutions = ["480p", "720p"] if key in {"Seedance2Fast", "Seedance2Mini"} else ["480p", "720p", "1080p"]
        models.append(_manifest_entry(
            key=key,
            label=default_public_video_label("seedance", operation, fallback_label),
            provider="seedance",
            model_name=runtime_model,
            available=available,
            unavailable_reason=reason,
            task_types=task_types,
            media_inputs=media_inputs,
            supports_original_audio=key != "Seedance15",
            parameter_rules={
                "resolution": resolutions,
                "ratio": ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4"],
                "duration": {"type": "integer", "minimum": 1, "maximum": 15, "default": 5},
                "generate_audio": {"type": "boolean", "default": True},
                "normalization_policy": "reject_or_explain",
            },
        ))

    minimax_available, minimax_model, minimax_reason = state("minimax", None)
    models.append(_manifest_entry(
        key="MINI",
        label=default_public_video_label("minimax", "video-standard", "MiniMax Hailuo 2.3"),
        provider="minimax",
        model_name=minimax_model or MINIMAX_DEFAULT_VIDEO_MODEL,
        model_options=[minimax_model or MINIMAX_DEFAULT_VIDEO_MODEL, MINIMAX_FAST_VIDEO_MODEL],
        available=minimax_available,
        unavailable_reason=minimax_reason,
        task_types=["i2v", "first_last_frame"],
        media_inputs=["first_frame", "last_frame"],
        parameter_rules={
            "prompt_optimizer": {"type": "boolean", "default": True},
            "valid_combinations": [
                {"duration": 6, "resolution": ["768P", "1080P"]},
                {"duration": 10, "resolution": ["768P"]},
            ],
            "normalization_policy": "reject",
        },
    ))

    for key, provider, default_model, operation, fallback_label in (
        ("Veo", "veo", VEO_DEFAULT_VIDEO_MODEL, VEO_DEFAULT_VIDEO_MODEL.lower(), "Veo 3.1 Fast"),
        ("Sora2", "sora2", SORA2_DEFAULT_VIDEO_MODEL, SORA2_DEFAULT_VIDEO_MODEL.lower(), "Sora 2"),
    ):
        available, runtime_model, reason = state(provider, None)
        models.append(_manifest_entry(
            key=key,
            label=default_public_video_label(provider, operation, fallback_label),
            provider=provider,
            model_name=runtime_model or default_model,
            available=available,
            unavailable_reason=reason,
            task_types=["i2v", "first_last_frame"],
            media_inputs=["first_frame", "last_frame"],
            parameter_rules={"normalization_policy": "provider_default"},
        ))

    dashscope_available, _dashscope_model, dashscope_reason = state("dashscope", None)
    dashscope_specs = (
        ("大能", "wan26", "Wan 2.6", ["wan26"], ["i2v"], ["first_frame"]),
        ("Kling", "kling-standard", "Kling V3", ["kling-standard", "kling-omni"], ["t2v", "i2v", "first_last_frame", "multi_reference"], ["first_frame", "last_frame", "reference_image"]),
        ("Vidu", "vidu-reference-q3", "Vidu Q3", ["vidu-reference-q3-mix", "vidu-reference-q3", "vidu-reference-q3-turbo", "vidu-startend-q3-pro", "vidu-startend-q3-turbo"], ["i2v", "first_last_frame", "multi_reference"], ["first_frame", "last_frame", "reference_image"]),
        ("HappyHorse", "happyhorse", "HappyHorse 1.0", ["happyhorse"], ["multi_reference"], ["reference_image"]),
    )
    for key, operation, fallback_label, sub_models, task_types, media_inputs in dashscope_specs:
        options = _dashscope_options(sub_models, usage_scope=scope)
        models.append(_manifest_entry(
            key=key,
            label=default_public_video_label("dashscope", operation, fallback_label),
            provider="dashscope",
            model_name=options[0] if options else "",
            model_options=options,
            available=dashscope_available,
            unavailable_reason=dashscope_reason,
            task_types=task_types,
            media_inputs=media_inputs,
            supports_original_audio=key in {"Kling", "Vidu"},
            parameter_rules={
                "resolution": ["720P", "1080P"],
                "duration": {"type": "integer", "minimum": 1, "maximum": 15, "default": 5},
                "normalization_policy": "reject_or_explain",
            },
        ))

    manifest: Dict[str, Any] = {
        "seedance_omni": seedance_omni,
        "comfyui_available": False,
        "manifest_version": "source-online-1",
        "model_scope": scope,
        "models": models,
    }
    return apply_public_video_catalog(manifest, catalog)
