"""Read-only image generation capability checks for creator UI preflight."""
from __future__ import annotations

from typing import Any, Dict

from services.ai_proxy_gpt_image_service import gpt_image_tier_capability
from services.api_provider_registry import (
    DOUBAO_IMAGE_DEFAULT_MODEL,
    normalize_doubao_image_model_for_endpoint,
)
from services.api_provider_runtime import resolve_provider
from services.seedance_image_provenance import (
    SEEDREAM_PRO_MODEL,
    SeedanceInputProvenanceError,
    validate_portrait_generation,
)


def _model_capability(requested_model: str) -> tuple[Dict[str, Any], Any, str]:
    config = resolve_provider("doubao", requested_model, usage_scope="workflow")
    resolved_model = normalize_doubao_image_model_for_endpoint(
        config.model_name or requested_model or DOUBAO_IMAGE_DEFAULT_MODEL,
        config.endpoint,
    )
    if not config.api_key or not config.endpoint:
        return {"available": False, "reason": "当前模型通道未配置或已停用"}, config, resolved_model
    if requested_model == SEEDREAM_PRO_MODEL and resolved_model != SEEDREAM_PRO_MODEL:
        return {"available": False, "reason": "当前未配置 Seedream 5.0 Pro 官方通道"}, config, resolved_model
    if requested_model != SEEDREAM_PRO_MODEL and resolved_model == SEEDREAM_PRO_MODEL:
        return {"available": False, "reason": "当前未配置 Seedream 5.0 Lite 通道"}, config, resolved_model
    return {"available": True, "reason": ""}, config, resolved_model


def build_image_generation_capabilities() -> Dict[str, Any]:
    lite, lite_config, lite_model = _model_capability(DOUBAO_IMAGE_DEFAULT_MODEL)
    pro, _pro_config, _pro_model = _model_capability(SEEDREAM_PRO_MODEL)
    portrait = {"available": False, "reason": "Seedream 5.0 Lite 当前不可用"}
    if lite["available"]:
        try:
            validate_portrait_generation(
                lite_config,
                lite_model,
                [],
                usage_scope="workflow",
            )
            portrait = {"available": True, "reason": ""}
        except SeedanceInputProvenanceError as exc:
            portrait = {"available": False, "reason": str(exc)}

    return {
        "models": {
            "doubao": lite,
            "doubao_pro": pro,
            "gpt_image_vip": gpt_image_tier_capability("vip"),
            "gpt_image_official": gpt_image_tier_capability("official"),
        },
        "seedance_portrait": portrait,
    }
