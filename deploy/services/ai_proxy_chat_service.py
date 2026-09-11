"""OpenAI-compatible chat helpers for AI proxy providers."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Dict, List, Optional

from services.api_provider_health_monitor import list_cached_provider_health
from services.api_provider_runtime import provider_fallback_chain, resolve_provider_with_failover
from services.ai_proxy_http_client import _post_json_request
from services.ai_proxy_types import AIProxyConfigError, AIProxyUpstreamError, TextGenerationResult

logger = logging.getLogger(__name__)


def _unique_provider_ids(items: List[Optional[str]]) -> List[str]:
    seen: set[str] = set()
    out: List[str] = []
    for item in items:
        provider = str(item or "").strip().lower()
        if not provider or provider in seen:
            continue
        seen.add(provider)
        out.append(provider)
    return out


def provider_health_scope_for_failover(provider: str) -> List[str]:
    return _unique_provider_ids(
        [
            provider,
            *[entry.get("provider") for entry in provider_fallback_chain(provider)],
        ]
    )


async def resolve_ai_proxy_provider(
    provider: str,
    model: Optional[str] = None,
    *,
    health_providers: Optional[List[str]] = None,
    usage_scope: Optional[str] = "workflow",
) -> tuple[Any, Dict[str, Any]]:
    """Resolve a provider with registry-declared failover and cached health.

    Health checks are best effort: if Redis/cache is unavailable, resolver still
    falls back only for static reasons such as missing key/endpoint.
    """
    providers = health_providers or provider_health_scope_for_failover(provider)
    try:
        provider_health = await list_cached_provider_health(providers)
    except Exception as health_error:
        logger.warning("%s failover health cache unavailable: %s", provider, health_error)
        provider_health = []

    config, failover = resolve_provider_with_failover(
        provider,
        model,
        provider_health=provider_health,
        usage_scope=usage_scope,
    )
    if failover.get("active"):
        logger.warning(
            "AI provider failover active: requested=%s selected=%s reason=%s",
            failover.get("requested_provider"),
            failover.get("selected_provider"),
            failover.get("reason"),
        )
    return config, failover


def build_chat_payload(
    *,
    model: str,
    prompt: str,
    system_prompt: Optional[str] = None,
    temperature: float = 1.0,
) -> Dict[str, Any]:
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    return {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }


def _post_chat_completion_result_sync(
    *,
    config: Any,
    failover: Dict[str, Any],
    messages: List[Dict[str, Any]],
    temperature: float,
    requested_model: Optional[str],
    default_model: str,
    label: str,
    timeout: Any = 120,
    timeout_message: str = "Text generation timed out, please try again later",
    timeout_status_code: int = 500,
    request_error_message: str = "Text generation failed, please try again later",
    parse_error_message: str = "Text generation service returned an invalid response",
    upstream_detail: Optional[Callable[[str, int], str]] = None,
    empty_content_message: Optional[str] = None,
    extra_payload: Optional[Dict[str, Any]] = None,
) -> TextGenerationResult:
    """Call a synchronous OpenAI-compatible chat completion provider."""
    if not config.api_key:
        raise AIProxyConfigError("文本生成服务未配置，请联系管理员")
    if not config.endpoint:
        raise AIProxyConfigError("文本生成服务 endpoint 未配置，请联系管理员")

    resolved_model = config.model_name or requested_model or default_model
    payload = {
        "model": resolved_model,
        "messages": messages,
        "temperature": temperature,
    }
    if extra_payload:
        payload.update(extra_payload)

    result = _post_json_request(
        label=label,
        url=config.url_for_operation("chat_completions"),
        headers={
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        },
        payload=payload,
        timeout=timeout,
        timeout_message=timeout_message,
        timeout_status_code=timeout_status_code,
        request_error_message=request_error_message,
        parse_error_message=parse_error_message,
        request_kwargs=config.requests_kwargs(),
        upstream_detail=upstream_detail,
    )

    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    if empty_content_message and not content:
        raise AIProxyUpstreamError(empty_content_message)
    return TextGenerationResult(
        content=content,
        provider=config.provider,
        model_name=resolved_model,
        failover=failover,
    )


async def _post_chat_completion_result(
    *,
    config: Any,
    failover: Dict[str, Any],
    messages: List[Dict[str, Any]],
    temperature: float,
    requested_model: Optional[str],
    default_model: str,
    label: str,
) -> TextGenerationResult:
    """Async wrapper for OpenAI-compatible chat completion providers."""
    return await asyncio.to_thread(
        _post_chat_completion_result_sync,
        config=config,
        failover=failover,
        messages=messages,
        temperature=temperature,
        requested_model=requested_model,
        default_model=default_model,
        label=label,
        timeout=120,
        timeout_message="文本生成失败，请稍后重试",
        timeout_status_code=500,
        request_error_message="文本生成失败，请稍后重试",
        parse_error_message="文本生成服务响应格式异常",
        upstream_detail=lambda upstream, _status_code: f"文本生成失败：{upstream[:200]}" if upstream else "文本生成失败，请稍后重试",
    )


