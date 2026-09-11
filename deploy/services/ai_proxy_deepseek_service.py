"""DeepSeek text and streaming helpers for AI proxy routes."""
from __future__ import annotations

import json
import logging
from typing import Any, Callable, Dict, Iterator, List, Optional

from services.api_provider_runtime import resolve_provider
from services.ai_proxy_chat_service import _post_chat_completion_result_sync
from services.ai_proxy_http_client import _ensure_stream_response_ok, _post_stream_request
from services.ai_proxy_types import AIProxyConfigError, AIProxyError, AIProxyUpstreamError

logger = logging.getLogger(__name__)


DEEPSEEK_SYSTEM_PROMPT = "You are a helpful assistant for storyboard generation tasks."


def _resolve_deepseek_config(
    model: Optional[str] = None,
    usage_scope: Optional[str] = None,
) -> Any:
    config = resolve_provider("deepseek", model, usage_scope=usage_scope)
    if not config.api_key:
        raise AIProxyConfigError(
            "DeepSeek 服务未配置，请在管理后台 (Admin → API 配置) 添加 deepseek 提供商的 API Key 后重试",
            status_code=503,
        )
    if not config.endpoint:
        raise AIProxyConfigError("DeepSeek 服务 endpoint 未配置，请联系管理员", status_code=503)
    return config


def ensure_deepseek_configured(
    model: Optional[str] = None,
    usage_scope: Optional[str] = None,
) -> None:
    _resolve_deepseek_config(model, usage_scope=usage_scope)


def build_deepseek_payload(
    *,
    prompt: str,
    model: str,
    response_format: str = "text",
    temperature: float = 0.2,
    stream: bool = False,
    thinking_type: Optional[str] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": DEEPSEEK_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "stream": stream,
        "temperature": temperature,
    }
    if response_format == "json":
        payload["response_format"] = {"type": "json_object"}
    if thinking_type:
        payload["thinking"] = {"type": thinking_type}
    return payload


def _sse_event(payload: Dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _deepseek_chat_url(
    model: Optional[str],
    usage_scope: Optional[str] = None,
) -> tuple[str, Dict[str, Any], str]:
    config = _resolve_deepseek_config(model, usage_scope=usage_scope)
    resolved_model = config.model_name or model or "deepseek-reasoner"
    return config.url_for_operation("chat_completions"), {
        "headers": {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        },
        **config.requests_kwargs(),
    }, resolved_model


def _deepseek_thinking_type(model: Optional[str]) -> Optional[str]:
    operation = str(model or "deepseek-reasoner").strip().lower()
    if operation == "deepseek-chat":
        return "disabled"
    if operation == "deepseek-reasoner":
        return "enabled"
    return None


def generate_deepseek_text(
    *,
    prompt: str,
    response_format: str = "text",
    temperature: float = 0.2,
    model: Optional[str] = None,
    usage_scope: Optional[str] = None,
) -> str:
    config = _resolve_deepseek_config(model, usage_scope=usage_scope)
    extra_payload: Dict[str, Any] = {
        "stream": False,
        "thinking": {"type": _deepseek_thinking_type(model) or "enabled"},
    }
    if response_format == "json":
        extra_payload["response_format"] = {"type": "json_object"}

    result = _post_chat_completion_result_sync(
        config=config,
        failover={
            "active": False,
            "requested_provider": "deepseek",
            "selected_provider": config.provider,
            "reason": None,
        },
        messages=[
            {"role": "system", "content": DEEPSEEK_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=temperature,
        requested_model=model,
        default_model="deepseek-reasoner",
        label="DeepSeek",
        timeout=180,
        timeout_message="DeepSeek API 调用超时，请稍后重试",
        request_error_message="DeepSeek API 调用失败，请稍后重试",
        parse_error_message="DeepSeek 响应格式异常",
        upstream_detail=lambda upstream, status_code: f"DeepSeek API 调用失败: {upstream[:200] or status_code}",
        empty_content_message="AI服务返回空内容",
        extra_payload=extra_payload,
    )
    return result.content


def stream_deepseek_chat(
    *,
    prompt: str,
    response_format: str = "text",
    temperature: float = 0.2,
    model: Optional[str] = None,
    usage_scope: Optional[str] = None,
    on_complete: Optional[Callable[[str], None]] = None,
    on_error: Optional[Callable[[str], None]] = None,
) -> Iterator[str]:
    """Yield DeepSeek chat chunks in the route's existing SSE event format."""
    try:
        url, request_kwargs, resolved_model = _deepseek_chat_url(model, usage_scope=usage_scope)
        payload = build_deepseek_payload(
            prompt=prompt,
            model=resolved_model,
            response_format=response_format,
            temperature=temperature,
            stream=True,
            thinking_type=_deepseek_thinking_type(model) or "enabled",
        )
    except AIProxyError as e:
        if on_error:
            on_error(e.detail)
        yield _sse_event({"type": "error", "message": e.detail})
        yield "data: [DONE]\n\n"
        return

    try:
        response = _post_stream_request(
            label="DeepSeek stream",
            url=url,
            payload=payload,
            timeout=(20, 180),
            timeout_message="DeepSeek API 调用超时，请稍后重试",
            request_error_detail=lambda e: f"DeepSeek API 调用失败: {str(e)[:200]}",
            request_kwargs=request_kwargs,
        )
    except AIProxyUpstreamError as e:
        if on_error:
            on_error(e.detail)
        yield _sse_event({"type": "error", "message": e.detail})
        yield "data: [DONE]\n\n"
        return

    full_content: List[str] = []
    stream_error: Optional[str] = None
    try:
        _ensure_stream_response_ok(
            label="DeepSeek",
            response=response,
            upstream_detail=lambda upstream, status_code: f"DeepSeek API 调用失败: {upstream[:200] or status_code}",
        )

        for raw_line in response.iter_lines(decode_unicode=True):
            if not raw_line:
                continue
            line = raw_line.decode("utf-8", errors="ignore") if isinstance(raw_line, bytes) else raw_line
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
            except Exception as e:
                logger.warning("DeepSeek stream chunk parse failed: %s | data=%s", e, data[:200])
                continue

            reasoning_content = delta.get("reasoning_content")
            if reasoning_content:
                yield _sse_event({"type": "reasoning", "content": reasoning_content})

            content_piece = delta.get("content")
            if content_piece:
                full_content.append(content_piece)
                yield _sse_event({"type": "content", "content": content_piece})
    except AIProxyUpstreamError as e:
        stream_error = e.detail
        yield _sse_event({"type": "error", "message": e.detail})
    except GeneratorExit:
        if on_error:
            on_error("客户端中断 DeepSeek 流式连接")
        raise
    except Exception as e:
        logger.error("DeepSeek stream read failed: %s", e, exc_info=True)
        stream_error = f"DeepSeek 流式读取失败: {str(e)[:200]}"
        yield _sse_event({"type": "error", "message": stream_error})
    finally:
        response.close()

    if on_complete and full_content:
        on_complete("".join(full_content))
    elif on_error:
        on_error(stream_error or "DeepSeek 返回空内容")

    yield "data: [DONE]\n\n"

