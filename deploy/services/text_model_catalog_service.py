"""Public, secret-free text model metadata for authenticated frontend clients."""
from __future__ import annotations

from typing import Any, Dict, List

from services.ai_proxy_chat_service import resolve_ai_proxy_provider
from services.api_provider_registry import MODEL_USAGE_SCOPE_WORKFLOW, normalize_model_usage_scope
from services.api_provider_runtime import resolve_provider


def _model_label(model_name: Any, capability: str) -> str:
    runtime = str(model_name or "").strip() or "AI"
    return f"{runtime} · {capability}"


async def build_text_model_catalog(
    usage_scope: str = MODEL_USAGE_SCOPE_WORKFLOW,
) -> List[Dict[str, Any]]:
    """Describe public text-model choices used by the stable frontend selector.

    Frontend values, operation identifiers, and billing keys remain stable so
    existing projects keep working. Creator-facing labels intentionally expose
    the current runtime model and version; provider credentials and endpoints
    remain admin-only.
    """
    model_scope = normalize_model_usage_scope(usage_scope)
    minimax_config = resolve_provider("minimax", "minimax-m3", usage_scope=model_scope)
    deepseek_chat_config = resolve_provider("deepseek", "deepseek-chat", usage_scope=model_scope)
    deepseek_reasoner_config = resolve_provider("deepseek", "deepseek-reasoner", usage_scope=model_scope)
    gemini_config, gemini_failover = await resolve_ai_proxy_provider(
        "gemini-text",
        usage_scope=model_scope,
    )

    return [
        {
            "value": "minimax-m3",
            "label": _model_label(minimax_config.model_name or "MiniMax-M3", "连续写作模型"),
            "hint": "适合持续",
            "billing_model": "script_tier_1",
            "model_scope": model_scope,
            "failover_active": False,
        },
        {
            "value": "deepseek-chat",
            "label": _model_label(deepseek_chat_config.model_name or "deepseek-v4-flash", "快速写作模型"),
            "hint": "速度优先",
            "billing_model": "script_tier_2",
            "model_scope": model_scope,
            "failover_active": False,
        },
        {
            "value": "deepseek",
            "label": _model_label(deepseek_reasoner_config.model_name or "deepseek-v4-pro", "推理写作模型"),
            "hint": "推理优先",
            "billing_model": "script_tier_3",
            "model_scope": model_scope,
            "failover_active": False,
        },
        {
            "value": "gemini",
            "label": _model_label(gemini_config.model_name or "gemini-2.5-flash", "全能写作模型"),
            "hint": "综合全能",
            "billing_model": "script_tier_4",
            "model_scope": model_scope,
            "failover_active": bool(gemini_failover.get("active")),
        },
    ]
