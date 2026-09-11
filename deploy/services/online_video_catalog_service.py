"""Secret-free online video model catalogue shared by private and source editions."""
from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, List, Optional

from dao.admin.api_config import ApiConfigDAO
from services.api_provider_registry import (
    MODEL_USAGE_SCOPE_WORKFLOW,
    VIDEO_PUBLIC_MODEL_BINDINGS,
    normalize_model_bindings,
    normalize_model_usage_scope,
    normalize_provider,
    seedance_access_mode,
)


logger = logging.getLogger(__name__)


def default_public_video_label(provider: str, operation: str, fallback: str) -> str:
    defaults = VIDEO_PUBLIC_MODEL_BINDINGS.get((provider, operation)) or {}
    name = str(defaults.get("default_display_name") or "").strip()
    description = str(defaults.get("default_description") or "").strip()
    if not name:
        return fallback
    return f"{name} · {description}" if description else name


def is_seedance_omni_model(model_name: str) -> bool:
    normalized = (model_name or "").lower()
    return "2-0" in normalized or "2.0" in normalized


def _config_value(config: Any, key: str, default: Any = None) -> Any:
    if isinstance(config, dict):
        return config.get(key, default)
    try:
        return config[key]
    except (KeyError, TypeError):
        return getattr(config, key, default)


def build_public_video_catalog(
    configs: Iterable[Any],
    *,
    usage_scope: str = MODEL_USAGE_SCOPE_WORKFLOW,
) -> Dict[str, Any]:
    """Build public presentation metadata from enabled API bindings."""
    scope = normalize_model_usage_scope(usage_scope)
    video_providers = {provider for provider, _operation in VIDEO_PUBLIC_MODEL_BINDINGS}
    configured_providers: set[str] = set()
    binding_by_identity: Dict[tuple[str, str, str], Dict[str, Any]] = {}

    for config in configs or []:
        provider = normalize_provider(str(_config_value(config, "provider", "") or ""))
        if provider not in video_providers:
            continue
        configured_providers.add(provider)
        if _config_value(config, "enabled", True) is False:
            continue
        endpoint = str(_config_value(config, "endpoint", "") or "")
        bindings = normalize_model_bindings(
            provider,
            _config_value(config, "model_bindings", []),
            str(_config_value(config, "model_name", "") or ""),
        )
        for binding in bindings:
            if normalize_model_usage_scope(binding.get("scope")) != scope:
                continue
            operation = str(binding.get("operation") or "").strip().lower()
            if provider == "seedance":
                access_mode = seedance_access_mode(endpoint)
                if access_mode == "agent_plan" and operation != "agent_plan":
                    continue
                if access_mode != "agent_plan" and operation == "agent_plan":
                    continue
            front_model_key = str(binding.get("front_model_key") or "").strip()
            if not front_model_key or binding.get("published") is False:
                continue
            model_name = str(binding.get("model_name") or "").strip()
            if not model_name:
                continue
            default_display_name = str(binding.get("default_display_name") or model_name).strip()
            default_description = str(binding.get("default_description") or "").strip()
            custom_display_name = str(binding.get("display_name") or "").strip()
            custom_description = str(binding.get("description") or "").strip()
            display_name = custom_display_name or default_display_name
            description = custom_description or default_description
            binding_by_identity[(provider, front_model_key, operation)] = {
                "provider": provider,
                "operation": operation,
                "front_model_key": front_model_key,
                "model_name": model_name,
                "display_name": display_name,
                "description": description,
                "default_display_name": default_display_name,
                "default_description": default_description,
                "display_name_customized": bool(custom_display_name),
                "description_customized": bool(custom_description),
                "label": f"{display_name} · {description}" if description else display_name,
            }

    bindings_by_front_key: Dict[str, List[Dict[str, Any]]] = {}
    for binding in binding_by_identity.values():
        bindings_by_front_key.setdefault(binding["front_model_key"], []).append(binding)
    return {
        "configured_providers": configured_providers,
        "bindings_by_front_key": bindings_by_front_key,
    }


def apply_public_video_catalog(
    manifest: Dict[str, Any],
    catalog: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    if not catalog:
        return manifest
    configured_providers = set(catalog.get("configured_providers") or set())
    bindings_by_front_key = catalog.get("bindings_by_front_key") or {}
    for model in manifest.get("models", []):
        provider = normalize_provider(str(model.get("provider") or ""))
        if provider not in configured_providers:
            continue
        model["catalog_controlled"] = True
        bindings = list(bindings_by_front_key.get(str(model.get("key") or "")) or [])
        if not bindings:
            model["published"] = False
            model["available"] = False
            model["unavailable_reason"] = "模型未在后台发布"
            if "model_options" in model:
                model["model_options"] = []
            continue

        current_model = str(model.get("model_name") or "").strip().lower()
        primary = next(
            (
                binding
                for binding in bindings
                if str(binding.get("model_name") or "").strip().lower() == current_model
            ),
            bindings[0],
        )
        model["published"] = True
        model["model_name"] = primary["model_name"]
        model["label"] = primary["label"]
        for field in (
            "display_name",
            "description",
            "default_display_name",
            "default_description",
            "display_name_customized",
            "description_customized",
        ):
            model[field] = primary[field]
        model["model_options"] = [binding["model_name"] for binding in bindings]
        model["model_option_labels"] = [
            {
                "operation": binding["operation"],
                "model_name": binding["model_name"],
                "label": binding["label"],
                "display_name": binding["display_name"],
                "description": binding["description"],
            }
            for binding in bindings
        ]
    return manifest


async def load_public_video_catalog(usage_scope: str) -> Optional[Dict[str, Any]]:
    try:
        configs = await ApiConfigDAO.list_all()
    except Exception as exc:
        logger.warning("video capability admin catalogue unavailable: %s", exc)
        return None
    return build_public_video_catalog(configs, usage_scope=usage_scope)
