"""Gemini text/chat helpers for AI proxy routes."""
from __future__ import annotations

import json
import logging
from typing import Any, Callable, Dict, Iterator, List, Optional

from services.api_provider_runtime import resolve_provider
from services.ai_proxy_chat_service import _post_chat_completion_result, build_chat_payload, resolve_ai_proxy_provider
from services.ai_proxy_http_client import _ensure_stream_response_ok, _post_stream_request
from services.ai_proxy_types import (
    AIProxyConfigError,
    AIProxyError,
    AIProxyUpstreamError,
    TextGenerationResult,
)

logger = logging.getLogger(__name__)


def _sse_event(payload: Dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _ensure_gemini_stream_config(config: Any) -> Any:
    if not config.api_key:
        raise AIProxyConfigError("Gemini 文本服务未配置，请联系管理员", status_code=503)
    if not config.endpoint:
        raise AIProxyConfigError("Gemini 文本服务 endpoint 未配置，请联系管理员", status_code=503)
    return config


async def resolve_gemini_stream_config(
    model: Optional[str] = None,
    usage_scope: Optional[str] = None,
) -> Any:
    config, _failover = await resolve_ai_proxy_provider(
        "gemini-text",
        model,
        usage_scope=usage_scope,
    )
    return _ensure_gemini_stream_config(config)


def stream_gemini_text(
    *,
    prompt: str,
    system_prompt: Optional[str] = None,
    temperature: float = 1.0,
    model: Optional[str] = None,
    usage_scope: Optional[str] = None,
    config: Optional[Any] = None,
    on_complete: Optional[Callable[[str], None]] = None,
    on_error: Optional[Callable[[str], None]] = None,
) -> Iterator[str]:
    """Stream an OpenAI-compatible Gemini text response to the shared SSE client."""
    try:
        stream_config = _ensure_gemini_stream_config(
            config or resolve_provider("gemini-text", model, usage_scope=usage_scope)
        )
        resolved_model = stream_config.model_name or model or "gemini-2.5-flash"
        payload = build_chat_payload(
            model=resolved_model,
            prompt=prompt,
            system_prompt=system_prompt,
            temperature=temperature,
        )
        payload["stream"] = True
        response = _post_stream_request(
            label="Gemini text stream",
            url=stream_config.url_for_operation("chat_completions"),
            payload=payload,
            timeout=(20, 60),
            timeout_message="Gemini 文本生成超时，请稍后重试",
            request_error_detail=lambda exc: f"Gemini 文本生成失败: {str(exc)[:200]}",
            request_kwargs={
                "headers": {
                    "Authorization": f"Bearer {stream_config.api_key}",
                    "Content-Type": "application/json",
                },
                **stream_config.requests_kwargs(),
            },
        )
    except AIProxyError as exc:
        if on_error:
            on_error(exc.detail)
        yield _sse_event({"type": "error", "message": exc.detail})
        yield "data: [DONE]\n\n"
        return

    full_content: List[str] = []
    stream_error: Optional[str] = None
    try:
        _ensure_stream_response_ok(
            label="Gemini text",
            response=response,
            upstream_detail=lambda upstream, status_code: (
                f"Gemini 文本生成失败: {upstream[:200] or status_code}"
            ),
        )
        for raw_line in response.iter_lines(decode_unicode=True):
            if not raw_line:
                continue
            line = (
                raw_line.decode("utf-8", errors="ignore")
                if isinstance(raw_line, bytes)
                else raw_line
            )
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data:
                continue
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
                choices = chunk.get("choices") or []
                delta = (choices[0].get("delta") or {}) if choices else {}
            except Exception as exc:
                logger.warning(
                    "Gemini text stream chunk parse failed: %s | data=%s",
                    exc,
                    data[:200],
                )
                continue

            content_piece = delta.get("content")
            if isinstance(content_piece, str) and content_piece:
                full_content.append(content_piece)
                yield _sse_event({"type": "content", "content": content_piece})
    except AIProxyUpstreamError as exc:
        stream_error = exc.detail
        yield _sse_event({"type": "error", "message": exc.detail})
    except GeneratorExit:
        if on_error:
            on_error("客户端中断 Gemini 文本流式连接")
        raise
    except Exception as exc:
        logger.error("Gemini text stream read failed: %s", exc, exc_info=True)
        stream_error = f"Gemini 文本流式读取失败: {str(exc)[:200]}"
        yield _sse_event({"type": "error", "message": stream_error})
    finally:
        response.close()

    if on_complete and full_content:
        on_complete("".join(full_content))
    elif on_error:
        on_error(stream_error or "Gemini 返回空内容")

    yield "data: [DONE]\n\n"


async def generate_gemini_text_result(
    *,
    prompt: str,
    system_prompt: Optional[str] = None,
    temperature: float = 1.0,
    model: Optional[str] = None,
    usage_scope: Optional[str] = None,
) -> TextGenerationResult:
    config, failover = await resolve_ai_proxy_provider(
        "gemini-text",
        model,
        usage_scope=usage_scope,
    )
    payload = build_chat_payload(
        model=config.model_name or model or "gemini-2.5-flash",
        prompt=prompt,
        system_prompt=system_prompt,
        temperature=temperature,
    )

    return await _post_chat_completion_result(
        config=config,
        failover=failover,
        messages=payload["messages"],
        temperature=temperature,
        requested_model=model,
        default_model="gemini-2.5-flash",
        label="Gemini text",
    )


async def generate_gemini_chat_result(
    *,
    messages: List[Dict[str, Any]],
    temperature: float = 1.0,
    model: Optional[str] = None,
    usage_scope: Optional[str] = None,
    allow_failover: bool = True,
    label: str = "Gemini chat",
) -> TextGenerationResult:
    if allow_failover:
        config, failover = await resolve_ai_proxy_provider(
            "gemini-text",
            model,
            usage_scope=usage_scope,
        )
    else:
        config = resolve_provider("gemini-text", model, usage_scope=usage_scope)
        failover = {
            "active": False,
            "requested_provider": "gemini-text",
            "selected_provider": config.provider,
            "reason": None,
        }

    return await _post_chat_completion_result(
        config=config,
        failover=failover,
        messages=messages,
        temperature=temperature,
        requested_model=model,
        default_model="gemini-2.5-flash",
        label=label,
    )


async def generate_gemini_text(
    *,
    prompt: str,
    system_prompt: Optional[str] = None,
    temperature: float = 1.0,
    model: Optional[str] = None,
    usage_scope: Optional[str] = None,
) -> str:
    result = await generate_gemini_text_result(
        prompt=prompt,
        system_prompt=system_prompt,
        temperature=temperature,
        model=model,
        usage_scope=usage_scope,
    )
    return result.content

