"""Runtime video capability decisions and the frontend model manifest."""
from __future__ import annotations

import logging
import hashlib
import json
import os
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from dao.admin.api_config import ApiConfigDAO
from services.api_provider_registry import (
    DASHSCOPE_DEFAULT_MODEL_MAP,
    MINIMAX_DEFAULT_VIDEO_MODEL,
    MINIMAX_FAST_VIDEO_MODEL,
    MODEL_USAGE_SCOPE_WORKFLOW,
    SEEDANCE_AGENT_PLAN_MODEL_MAP,
    SORA2_DEFAULT_VIDEO_MODEL,
    VIDEO_PUBLIC_MODEL_BINDINGS,
    VEO_DEFAULT_VIDEO_MODEL,
    normalize_model_bindings,
    normalize_model_usage_scope,
    normalize_provider,
    seedance_access_mode,
)
from services.api_provider_runtime import (
    provider_health_status,
    resolve_dashscope_model_name,
    resolve_provider,
    resolve_seedance_model_name,
)
from services.api_provider_health_monitor import list_cached_provider_health
from services.cluster_node_service import list_agent_instances, list_agent_nodes

logger = logging.getLogger(__name__)
MINIMAX_H3_CAPABILITY_KEY = "minimax_h3_fl2va"
MINIMAX_H3_PREFERRED_PORT = 8188
GPU2_ROUTING_NAME = "GPU2"


def local_gpu_maintenance() -> Dict[str, Any]:
    return {
        "enabled": str(os.environ.get("OSTORY_LOCAL_GPU_MAINTENANCE", "1")).strip().lower() in {"1", "true", "yes", "on"},
        "message": os.environ.get("OSTORY_LOCAL_GPU_MAINTENANCE_MESSAGE", "本地 GPU 正在维护，当前不会接收新任务；外部 API 模型不受影响。").strip(),
        "estimated_resume_at": os.environ.get("OSTORY_LOCAL_GPU_MAINTENANCE_RESUME_AT", "").strip() or None,
    }


LOCAL_VIDEO_WORKFLOWS = (
    ("LTXNode1", "LTX Video", "ltx", True),
    ("WanNode2", "Wan 2.2", "wan2", True),
    ("Wan2", "兼容视频", "ltx", True),
    ("一阶", "Smooth", "smooth", True),
    ("二阶", "Dawasi", "dawasi", True),
    ("三阶", "Hunyuan Video", "hunyuan", False),
    ("四阶", "LTX Video", "ltx", False),
    ("五阶", "Turbo 2.2", "turbo22", False),
    ("六阶", "Turbo 2.1", "turbo21", False),
    ("七阶", "SVD Wan", "svdwan", False),
)


def _local_video_manifests(instances: Iterable[Dict[str, Any]], *, nodes_online: bool, workflow_dir: Optional[Path] = None) -> List[Dict[str, Any]]:
    """Require a real server graph and a healthy node's matching capability report."""
    root = workflow_dir or Path(__file__).resolve().parent.parent / "workflows"
    graphs = {}
    workflow_names = {f"{prefix}_{mode}" for _, _, prefix, _ in LOCAL_VIDEO_WORKFLOWS for mode in ("i2v", "morph")}
    for path in root.glob("*.json"):
        if path.stem.lower() not in workflow_names:
            continue
        try:
            graph = json.loads(path.read_text(encoding="utf-8"))
            executable = {key: {"class_type": node["class_type"], "inputs": node.get("inputs", {})} for key, node in graph.items() if isinstance(node, dict) and node.get("class_type")}
            valid = bool(executable) and all(str(node["class_type"]).lower() not in {"placeholdernode", "placeholder_node"} for node in executable.values())
            graphs[path.stem.lower()] = hashlib.sha256(json.dumps(executable, sort_keys=True, ensure_ascii=True).encode()).hexdigest() if valid else None
        except (OSError, ValueError, AttributeError, TypeError):
            graphs[path.stem.lower()] = False
    live_instances = [instance for instance in instances if instance.get("healthy") is True and instance.get("agent_id") and instance.get("port")]

    def report(instance, workflow):
        capabilities = instance.get("capabilities") or {}
        workflows = capabilities.get("video_workflows") if isinstance(capabilities, dict) else None
        value = workflows.get(workflow) if isinstance(workflows, dict) else None
        return value if isinstance(value, dict) else {}

    def ready(instance, workflow):
        status = report(instance, workflow)
        return status.get("available") is True and bool(graphs.get(workflow)) and status.get("workflow_sha256") == graphs[workflow]

    models = []
    for key, name, prefix, morph in LOCAL_VIDEO_WORKFLOWS:
        workflow = f"{prefix}_i2v"
        target = next((instance for instance in live_instances if ready(instance, workflow)), None)
        available = bool(nodes_online and graphs.get(workflow) and target)
        if not graphs.get(workflow):
            reason = "当前版本缺少可执行工作流，需先配置对应工作流"
        elif not nodes_online:
            reason = "本地节点离线或暂不可接收任务"
        elif any(report(instance, workflow).get("available") is False for instance in live_instances):
            reason = "节点缺少工作流所需的插件、模型文件或参数选项"
        elif any(report(instance, workflow).get("available") is True for instance in live_instances):
            reason = "节点工作流版本与服务端不一致，请同步对应工作流后重试"
        else:
            reason = "本地节点尚未上报此工作流能力，请检查节点工作流配置与能力上报"
        first_last = bool(morph and target and ready(target, f"{prefix}_morph"))
        models.append({
            "key": key, "label": f"{name} · 本地节点模型", "provider": "processing_cluster",
            "model_name": name, "available": available, "unavailable_reason": None if available else reason,
            "task_types": ["i2v", "first_last_frame"] if first_last else ["i2v"],
            "media_inputs": ["first_frame", "last_frame"] if first_last else ["first_frame"],
            "supports_original_audio": False, "supports_cancel": True, "requires_processing_node": True,
            **_node_target(target), "preferred_comfyui_port": target.get("port") if target else None,
            "query_mode": "queue", "parameter_rules": {"normalization_policy": "workflow_defined"},
        })
    return models


def _default_public_video_label(provider: str, operation: str, fallback: str) -> str:
    defaults = VIDEO_PUBLIC_MODEL_BINDINGS.get((provider, operation)) or {}
    name = str(defaults.get("default_display_name") or "").strip()
    description = str(defaults.get("default_description") or "").strip()
    if not name:
        return fallback
    return f"{name} · {description}" if description else name


def _is_seedance_omni_model(model_name: str) -> bool:
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
    """Build public video presentation from enabled backend API bindings."""
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


async def _has_online_comfyui_agent() -> bool:
    try:
        return bool(await list_agent_nodes())
    except Exception as exc:
        logger.debug("video capability ComfyUI agent probe failed: %s", exc)
        return False


def _node_matches_routing_name(node: Dict[str, Any], routing_name: str) -> bool:
    requested = str(routing_name or "").strip().lower()
    return any(
        str(node.get(field) or "").strip().lower() == requested
        for field in ("routing_name", "name", "node_id", "agent_id", "id")
    )


def _node_target(node: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not node:
        return {}
    agent_id = str(node.get("agent_id") or node.get("id") or "").strip()
    node_id = str(node.get("node_id") or agent_id or node.get("id") or "").strip()
    target: Dict[str, Any] = {}
    if agent_id:
        target["preferred_agent_id"] = agent_id
    if node_id:
        target["preferred_node_id"] = node_id
    target["strict_preferred_routing"] = True
    return target


def _find_node_target(nodes: Iterable[Dict[str, Any]], routing_name: str) -> Dict[str, Any]:
    for node in nodes or []:
        if _node_matches_routing_name(node, routing_name):
            return _node_target(node)
    return {}


def _is_minimax_h3_instance(instance: Dict[str, Any]) -> bool:
    try:
        if int(instance.get("port") or 0) != MINIMAX_H3_PREFERRED_PORT:
            return False
    except (TypeError, ValueError):
        return False
    capabilities = instance.get("capabilities") or {}
    if not isinstance(capabilities, dict):
        return False
    # GPU2 keeps the baseline runtime resident and switches to H3 only after a
    # queued H3 task is claimed. Mini/Fast installation capabilities are
    # therefore valid even when the live object-info probe belongs to the
    # baseline runtime and minimax_h3_fl2va is temporarily false.
    return any(
        capabilities.get(key) is True
        for key in (
            MINIMAX_H3_CAPABILITY_KEY,
            "minimax_h3_fast",
            "minimax_h3_mini",
        )
    )


async def find_minimax_h3_agent_instance() -> Optional[Dict[str, Any]]:
    """Return the healthy agent instance that owns the local MiniMax H3 sidecar."""
    try:
        instances = await list_agent_instances()
    except Exception as exc:
        logger.debug("video capability MiniMax H3 agent probe failed: %s", exc)
        return None
    for instance in instances or []:
        if _is_minimax_h3_instance(instance):
            return instance
    return None


async def resolve_minimax_h3_agent_target() -> Dict[str, Any]:
    """Return routing fields for MiniMax H3 tasks, or an empty dict when unavailable."""
    instance = await find_minimax_h3_agent_instance()
    if not instance:
        try:
            return _minimax_h3_gpu2_fallback_target(await list_agent_nodes())
        except Exception as exc:
            logger.debug("video capability MiniMax H3 GPU2 fallback failed: %s", exc)
            return {}
    return _minimax_h3_target_from_instance(instance)


def _minimax_h3_target_from_instance(instance: Dict[str, Any]) -> Dict[str, Any]:
    """Build stable routing fields from the same capability snapshot."""
    agent_id = str(instance.get("agent_id") or instance.get("node_id") or "").strip()
    node_id = str(instance.get("node_id") or agent_id).strip()
    target: Dict[str, Any] = {
        "preferred_comfyui_port": MINIMAX_H3_PREFERRED_PORT,
        "strict_preferred_comfyui_port": True,
    }
    if agent_id:
        target["preferred_agent_id"] = agent_id
    if node_id:
        target["preferred_node_id"] = node_id
    return target


def _minimax_h3_gpu2_fallback_target(agent_nodes: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    """Keep local H3 visible while the GPU2 sidecar capability heartbeat catches up."""
    target = _find_node_target(agent_nodes, GPU2_ROUTING_NAME)
    if not target:
        return {}
    target["preferred_comfyui_port"] = MINIMAX_H3_PREFERRED_PORT
    target["strict_preferred_comfyui_port"] = True
    target["strict_preferred_routing"] = True
    return target


async def _has_minimax_h3_agent() -> bool:
    return bool(await find_minimax_h3_agent_instance())


def _provider_runtime_state(
    provider: str,
    model_name: Optional[str] = None,
    *,
    usage_scope: str = MODEL_USAGE_SCOPE_WORKFLOW,
) -> Tuple[bool, str]:
    """Return whether a provider is callable plus the model name it will use."""
    try:
        config = resolve_provider(provider, model_name, usage_scope=usage_scope)
        return bool(config.has_key), str(config.model_name or model_name or "").strip()
    except Exception as exc:
        logger.debug(
            "video capability provider probe failed: provider=%s model=%s error=%s",
            provider,
            model_name,
            exc,
        )
        return False, str(model_name or "").strip()


def _resolve_dashscope_model_options(
    sub_models: Iterable[str],
    *,
    usage_scope: str,
) -> List[str]:
    out: List[str] = []
    for sub_model in sub_models:
        try:
            model_name = resolve_dashscope_model_name(sub_model, usage_scope=usage_scope)
        except Exception as exc:
            logger.debug(
                "video capability DashScope model probe failed: sub_model=%s error=%s",
                sub_model,
                exc,
            )
            model_name = DASHSCOPE_DEFAULT_MODEL_MAP.get(sub_model, "")
        if model_name and model_name not in out:
            out.append(model_name)
    return out


def _seedance_manifest(
    model_name: str,
    *,
    key: str,
    label: str,
    omni: bool,
    available: bool,
    resolutions: Optional[List[str]] = None,
) -> Dict[str, Any]:
    media_inputs = ["text", "first_frame", "last_frame"]
    task_types = ["t2v", "i2v", "first_last_frame"]
    if omni:
        media_inputs.extend(["reference_image", "reference_video", "reference_audio"])
        task_types.append("multi_reference")
    max_duration = 12 if "1.5-pro" in (model_name or "").lower() else 15
    return {
        "key": key,
        "label": label,
        "provider": "seedance",
        "model_name": model_name,
        "available": available,
        "task_types": task_types,
        "media_inputs": media_inputs,
        "supports_original_audio": omni,
        "supports_cancel": False,
        "query_mode": "async",
        "parameter_rules": {
            "resolution": resolutions or ["480p", "720p", "1080p"],
            "ratio": ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
            "duration": {"type": "integer", "minimum": 4, "maximum": max_duration},
            "normalization_policy": "reject_or_explain",
        },
    }


def _minimax_h3_video_manifest(
    *,
    key: str = "MiniMaxH3",
    label: str = "MiniMax H3 · 本地节点模型",
    model_name: str = "MiniMax H3",
    profile: str = "standard",
    available: bool,
    target: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    target = target or {}
    return {
        "key": key,
        "label": label,
        "provider": "processing_cluster",
        "model_name": model_name,
        "task_types": ["i2v", "first_last_frame"],
        "media_inputs": ["first_frame", "last_frame"],
        "supports_original_audio": False,
        "supports_generated_audio": True,
        "supports_cancel": True,
        "requires_processing_node": True,
        "preferred_agent_id": target.get("preferred_agent_id"),
        "preferred_node_id": target.get("preferred_node_id"),
        "preferred_comfyui_port": MINIMAX_H3_PREFERRED_PORT,
        "strict_preferred_routing": True,
        "available": available,
        "query_mode": "queue",
        "parameter_rules": {
            "duration": {"type": "integer", "default": 5, "minimum": 4, "maximum": 15},
            "fps": {"type": "integer", "default": 24},
            "resolution": ["low_vram_16:9"],
            "seed": {"type": "integer", "default": -1, "minimum": -1},
            "negative_prompt": {"type": "string", "default": ""},
            "h3_profile": profile,
            "normalization_policy": "workflow_defined",
        },
    }


def _fixed_api_video_manifest(
    key: str,
    label: str,
    provider: str,
    model_name: Optional[str],
    *,
    available: bool,
) -> Dict[str, Any]:
    """Describe API video models whose remaining parameters are provider-managed."""
    return {
        "key": key,
        "label": label,
        "provider": provider,
        "model_name": model_name,
        "available": available,
        "task_types": ["i2v", "first_last_frame"],
        "media_inputs": ["first_frame", "last_frame"],
        "supports_original_audio": False,
        "supports_cancel": False,
        "query_mode": "async",
        "parameter_rules": {"normalization_policy": "provider_default"},
    }


def build_video_model_manifest(
    *,
    standard_seedance_model: str,
    fast_seedance_model: str,
    mini_seedance_model: str,
    seedance_omni: bool,
    comfyui_available: bool,
    minimax_h3_available: bool = False,
    minimax_h3_fast_available: bool = False,
    minimax_h3_mini_available: bool = False,
    minimax_h3_target: Optional[Dict[str, Any]] = None,
    agent_plan_seedance_model: str = "",
    seedance_billing_mode: str = "standard",
    model_scope: str = MODEL_USAGE_SCOPE_WORKFLOW,
    api_availability: Optional[Dict[str, bool]] = None,
    runtime_model_names: Optional[Dict[str, Any]] = None,
    public_model_catalog: Optional[Dict[str, Any]] = None,
    local_instances: Iterable[Dict[str, Any]] = (),
) -> Dict[str, Any]:
    """Build the versioned, secret-free capability contract consumed by the UI."""
    availability = api_availability or {}
    runtime_models = runtime_model_names or {}

    def is_available(key: str, default: bool = True) -> bool:
        return bool(availability.get(key, default))

    def runtime_model(key: str, fallback: Optional[str] = None) -> Optional[str]:
        value = runtime_models.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, list):
            for item in value:
                candidate = str(item or "").strip()
                if candidate:
                    return candidate
        return fallback

    def runtime_options(key: str, fallback: Iterable[str] = ()) -> List[str]:
        raw = runtime_models.get(key)
        values = raw if isinstance(raw, list) else list(fallback)
        out: List[str] = []
        for item in values:
            value = str(item or "").strip()
            if value and value not in out:
                out.append(value)
        return out

    seedance_models = [
        _seedance_manifest(
            agent_plan_seedance_model or SEEDANCE_AGENT_PLAN_MODEL_MAP["agent_plan"],
            key="Seedance15",
            label=_default_public_video_label("seedance", "agent_plan", "Seedance 1.5 Pro"),
            omni=False,
            available=is_available("Seedance15"),
        ),
        _seedance_manifest(
            standard_seedance_model,
            key="Seedance2",
            label=_default_public_video_label("seedance", "standard", "Seedance 2.0"),
            omni=seedance_omni and _is_seedance_omni_model(standard_seedance_model),
            available=is_available("Seedance2"),
        ),
        _seedance_manifest(
            fast_seedance_model,
            key="Seedance2Fast",
            label=_default_public_video_label("seedance", "fast", "Seedance 2.0 Fast"),
            omni=seedance_omni and _is_seedance_omni_model(fast_seedance_model),
            available=is_available("Seedance2Fast"),
            resolutions=["480p", "720p"],
        ),
        _seedance_manifest(
            mini_seedance_model,
            key="Seedance2Mini",
            label=_default_public_video_label("seedance", "mini", "Seedance 2.0 Mini"),
            omni=seedance_omni and _is_seedance_omni_model(mini_seedance_model),
            available=is_available("Seedance2Mini"),
            resolutions=["480p", "720p"],
        ),
    ]

    manifest = {
        "manifest_version": "2026-09-05.1",
        "model_scope": model_scope,
        "models": [
            *[
                _minimax_h3_video_manifest(
                    key=key,
                    label=label,
                    model_name=model_name,
                    profile=profile,
                    available={
                        "standard": minimax_h3_available,
                        "fast": minimax_h3_fast_available,
                        "mini": minimax_h3_mini_available,
                    }[profile],
                    target=minimax_h3_target,
                )
                for key, label, model_name, profile in (
                    ("MiniMaxH3", "MiniMax H3 · 本地节点模型", "MiniMax H3", "standard"),
                    ("MiniMaxH3Fast", "MiniMax H3 Fast · 本地节点模型", "MiniMax H3 Fast", "fast"),
                    ("MiniMaxH3Mini", "MiniMax H3 Mini · 本地节点模型", "MiniMax H3 Mini", "mini"),
                )
            ],
            # Legacy workflow definitions remain readable but are not offered for new tasks.
            _fixed_api_video_manifest(
                "Veo",
                _default_public_video_label("veo", VEO_DEFAULT_VIDEO_MODEL.lower(), "Veo 3.1 Fast"),
                "veo",
                runtime_model("Veo", VEO_DEFAULT_VIDEO_MODEL),
                available=is_available("Veo"),
            ),
            _fixed_api_video_manifest(
                "Sora2",
                _default_public_video_label("sora2", SORA2_DEFAULT_VIDEO_MODEL.lower(), "Sora 2"),
                "sora2",
                runtime_model("Sora2", SORA2_DEFAULT_VIDEO_MODEL),
                available=is_available("Sora2"),
            ),
            {
                "key": "大能",
                "label": _default_public_video_label("dashscope", "wan26", "Wan 2.6"),
                "provider": "dashscope",
                "model_name": runtime_model("大能", DASHSCOPE_DEFAULT_MODEL_MAP["wan26"]),
                "available": is_available("大能"),
                "task_types": ["i2v"],
                "media_inputs": ["first_frame"],
                "supports_original_audio": False,
                "supports_cancel": False,
                "query_mode": "async",
                "parameter_rules": {
                    "resolution": ["720P", "1080P"],
                    "duration": {"type": "integer", "default": 5, "options": [5, 10, 15]},
                    "shot_type": ["multi", "single"],
                    "seed": {"type": "integer", "default": -1, "minimum": -1},
                    "normalization_policy": "reject_or_explain",
                },
            },
            *seedance_models,
            {
                "key": "MINI",
                "label": _default_public_video_label("minimax", "video-standard", "MiniMax Hailuo 2.3"),
                "provider": "minimax",
                "model_name": runtime_model("MINI", MINIMAX_DEFAULT_VIDEO_MODEL),
                "model_options": runtime_options(
                    "MINI",
                    [
                        runtime_model("MINI", MINIMAX_DEFAULT_VIDEO_MODEL) or MINIMAX_DEFAULT_VIDEO_MODEL,
                        MINIMAX_FAST_VIDEO_MODEL,
                    ],
                ),
                "available": is_available("MINI"),
                "task_types": ["i2v", "first_last_frame"],
                "media_inputs": ["first_frame", "last_frame"],
                "supports_original_audio": False,
                "supports_cancel": False,
                "query_mode": "async",
                "parameter_rules": {
                    "prompt_optimizer": {"type": "boolean", "default": True},
                    "valid_combinations": [
                        {"duration": 6, "resolution": ["768P", "1080P"]},
                        {"duration": 10, "resolution": ["768P"]},
                    ],
                    "normalization_policy": "reject",
                },
            },
            {
                "key": "Kling",
                "label": _default_public_video_label("dashscope", "kling-standard", "Kling V3"),
                "provider": "dashscope",
                "model_name": runtime_model("Kling"),
                "model_options": runtime_options("Kling"),
                "available": is_available("Kling"),
                "task_types": ["t2v", "i2v", "first_last_frame", "multi_reference"],
                "media_inputs": ["first_frame", "last_frame", "reference_image"],
                "supports_original_audio": True,
                "supports_cancel": False,
                "query_mode": "async",
                "parameter_rules": {
                    "mode": ["std", "pro"],
                    "duration": {"type": "integer", "minimum": 1, "maximum": 15, "default": 5},
                    "aspect_ratio": ["16:9", "9:16", "1:1"],
                    "audio": {"type": "boolean", "default": False},
                    "watermark": {"type": "boolean", "default": False},
                    "normalization_policy": "reject_or_explain",
                },
            },
            {
                "key": "Vidu",
                "label": _default_public_video_label("dashscope", "vidu-reference-q3", "Vidu Q3"),
                "provider": "dashscope",
                "model_name": runtime_model("Vidu"),
                "model_options": runtime_options("Vidu"),
                "available": is_available("Vidu"),
                "task_types": ["i2v", "first_last_frame", "multi_reference"],
                "media_inputs": ["first_frame", "last_frame", "reference_image"],
                "supports_original_audio": True,
                "supports_cancel": False,
                "query_mode": "async",
                "parameter_rules": {
                    "resolution": ["540P", "720P", "1080P"],
                    "duration": {"type": "integer", "minimum": 1, "maximum": 16, "default": 5},
                    "watermark": {"type": "boolean", "default": False},
                    "normalization_policy": "reject_or_explain",
                },
            },
            {
                "key": "HappyHorse",
                "label": _default_public_video_label("dashscope", "happyhorse", "HappyHorse 1.0"),
                "provider": "dashscope",
                "model_name": runtime_model("HappyHorse", DASHSCOPE_DEFAULT_MODEL_MAP["happyhorse"]),
                "available": is_available("HappyHorse"),
                "task_types": ["multi_reference"],
                "media_inputs": ["reference_image"],
                "supports_original_audio": False,
                "supports_cancel": False,
                "query_mode": "async",
                "parameter_rules": {
                    "resolution": ["720P", "1080P"],
                    "ratio": ["16:9", "9:16", "3:4", "4:3", "4:5", "5:4", "1:1", "9:21", "21:9"],
                    "duration": {"type": "integer", "minimum": 1, "maximum": 15, "default": 5},
                    "watermark": {"type": "boolean", "default": True},
                    "normalization_policy": "reject_or_explain",
                },
            },
        ],
    }
    maintenance = local_gpu_maintenance()
    for model in manifest["models"]:
        if model["provider"] != "processing_cluster":
            continue
        if maintenance["enabled"]:
            model["available"] = False
            model["unavailable_reason"] = maintenance["message"] or "本地节点正在维护，暂不可接收任务"
        elif not model["available"] and not model.get("unavailable_reason"):
            model["unavailable_reason"] = (
                "本地节点尚未确认此 H3 配置的插件与模型文件，请检查能力上报"
                if comfyui_available else "本地节点离线或暂不可接收任务"
            )
    return apply_public_video_catalog(manifest, public_model_catalog)


async def get_video_capabilities(
    usage_scope: str = MODEL_USAGE_SCOPE_WORKFLOW,
) -> Dict[str, Any]:
    """Return legacy feature flags plus a versioned model capability manifest."""
    model_scope = normalize_model_usage_scope(usage_scope)
    public_model_catalog = await load_public_video_catalog(model_scope)
    try:
        agent_plan_seedance_model = resolve_seedance_model_name("agent_plan", usage_scope=model_scope)
        standard_seedance_model = resolve_seedance_model_name("standard", usage_scope=model_scope)
        fast_seedance_model = resolve_seedance_model_name("fast", usage_scope=model_scope)
        mini_seedance_model = resolve_seedance_model_name("mini", usage_scope=model_scope)
    except Exception as exc:
        logger.debug("video capability Seedance model probe failed: %s", exc)
        agent_plan_seedance_model = ""
        standard_seedance_model = ""
        fast_seedance_model = ""
        mini_seedance_model = ""

    try:
        agent_nodes = await list_agent_nodes()
    except Exception as exc:
        logger.debug("video capability ComfyUI agent probe failed: %s", exc)
        agent_nodes = []
    comfyui_available = bool(agent_nodes)
    try:
        local_instances = await list_agent_instances()
    except Exception as exc:
        logger.debug("video workflow capability cache unavailable: %s", exc)
        local_instances = []
    minimax_h3_instance = next((instance for instance in local_instances if _is_minimax_h3_instance(instance)), None)
    minimax_h3_target = (
        _minimax_h3_target_from_instance(minimax_h3_instance)
        if minimax_h3_instance
        else _minimax_h3_gpu2_fallback_target(agent_nodes)
    )
    minimax_h3_available = bool(minimax_h3_target.get("preferred_agent_id"))
    minimax_h3_capabilities = (
        minimax_h3_instance.get("capabilities")
        if isinstance(minimax_h3_instance, dict)
        else {}
    ) or {}
    minimax_h3_fast_available = bool(
        minimax_h3_available and minimax_h3_capabilities.get("minimax_h3_fast") is True
    )
    minimax_h3_mini_available = bool(
        minimax_h3_available and minimax_h3_capabilities.get("minimax_h3_mini") is True
    )
    seedance_key_available: Dict[str, bool] = {}
    seedance_models_by_key = {
        "Seedance15": agent_plan_seedance_model,
        "Seedance2": standard_seedance_model,
        "Seedance2Fast": fast_seedance_model,
        "Seedance2Mini": mini_seedance_model,
    }
    for key, model_name in seedance_models_by_key.items():
        try:
            seedance_provider_config = resolve_provider(
                "seedance",
                model_name or None,
                usage_scope=model_scope,
            )
            seedance_key_available[key] = bool(seedance_provider_config.has_key)
        except Exception as exc:
            logger.debug(
                "video capability Seedance provider probe failed: key=%s model=%s error=%s",
                key,
                model_name,
                exc,
            )
            seedance_key_available[key] = False

    seedance_omni = (
        any(_is_seedance_omni_model(model) for model in (
            standard_seedance_model,
            fast_seedance_model,
            mini_seedance_model,
        ))
    )
    try:
        seedance_health = await list_cached_provider_health(targets=[
            {"provider": "seedance", "model_name": agent_plan_seedance_model or None},
            {"provider": "seedance", "model_name": standard_seedance_model or None},
            {"provider": "seedance", "model_name": fast_seedance_model or None},
            {"provider": "seedance", "model_name": mini_seedance_model or None},
        ])
    except Exception as exc:
        logger.debug("video capability Seedance health cache probe failed: %s", exc)
        seedance_health = []

    def seedance_model_available(key: str, model_name: str) -> bool:
        if not seedance_key_available.get(key) or not model_name:
            return False
        return provider_health_status("seedance", seedance_health, model_name=model_name) not in {"error", "no_key"}

    minimax_available, minimax_model = _provider_runtime_state(
        "minimax",
        None,
        usage_scope=model_scope,
    )
    sora2_available, sora2_model = _provider_runtime_state(
        "sora2",
        None,
        usage_scope=model_scope,
    )
    veo_available, veo_model = _provider_runtime_state(
        "veo",
        None,
        usage_scope=model_scope,
    )
    dashscope_available, _dashscope_provider_model = _provider_runtime_state(
        "dashscope",
        None,
        usage_scope=model_scope,
    )

    wan26_options = _resolve_dashscope_model_options(["wan26"], usage_scope=model_scope)
    kling_options = _resolve_dashscope_model_options(["kling-standard", "kling-omni"], usage_scope=model_scope)
    vidu_options = _resolve_dashscope_model_options(
        [
            "vidu-reference-q3-mix",
            "vidu-reference-q3",
            "vidu-reference-q3-turbo",
            "vidu-reference-q2-pro",
            "vidu-reference-q2",
            "vidu-startend-q3-pro",
            "vidu-startend-q3-turbo",
            "vidu-startend-q2-pro",
            "vidu-startend-q2-turbo",
        ],
        usage_scope=model_scope,
    )
    happyhorse_options = _resolve_dashscope_model_options(["happyhorse"], usage_scope=model_scope)

    return {
        "seedance_omni": seedance_omni,
        "comfyui_available": comfyui_available,
        **build_video_model_manifest(
            agent_plan_seedance_model=agent_plan_seedance_model,
            standard_seedance_model=standard_seedance_model,
            fast_seedance_model=fast_seedance_model,
            mini_seedance_model=mini_seedance_model,
            seedance_omni=seedance_omni,
            comfyui_available=comfyui_available,
            minimax_h3_available=minimax_h3_available,
            minimax_h3_fast_available=minimax_h3_fast_available,
            minimax_h3_mini_available=minimax_h3_mini_available,
            minimax_h3_target=minimax_h3_target,
            model_scope=model_scope,
            api_availability={
                "Veo": veo_available,
                "Sora2": sora2_available,
                "大能": dashscope_available,
                "Seedance2": seedance_model_available("Seedance2", standard_seedance_model),
                "Seedance2Fast": seedance_model_available("Seedance2Fast", fast_seedance_model),
                "Seedance2Mini": seedance_model_available("Seedance2Mini", mini_seedance_model),
                "Seedance15": seedance_model_available("Seedance15", agent_plan_seedance_model),
                "MINI": minimax_available,
                "Kling": dashscope_available,
                "Vidu": dashscope_available,
                "HappyHorse": dashscope_available,
            },
            runtime_model_names={
                "Veo": veo_model or VEO_DEFAULT_VIDEO_MODEL,
                "Sora2": sora2_model or SORA2_DEFAULT_VIDEO_MODEL,
                "大能": (wan26_options[0] if wan26_options else DASHSCOPE_DEFAULT_MODEL_MAP["wan26"]),
                "MINI": minimax_model or MINIMAX_DEFAULT_VIDEO_MODEL,
                "HappyHorse": (
                    happyhorse_options[0]
                    if happyhorse_options
                    else DASHSCOPE_DEFAULT_MODEL_MAP["happyhorse"]
                ),
                "Kling": kling_options,
                "Vidu": vidu_options,
            },
            public_model_catalog=public_model_catalog,
            local_instances=local_instances,
        ),
    }
