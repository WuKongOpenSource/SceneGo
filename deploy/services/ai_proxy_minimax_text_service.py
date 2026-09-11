"""MiniMax M3 streaming helpers for AI proxy routes."""
from __future__ import annotations

import json
import logging
import queue
import threading
from typing import Any, Callable, Dict, Iterator, List, Optional
from urllib.parse import urlsplit, urlunsplit

from services.ai_proxy_http_client import _ensure_stream_response_ok, _post_stream_request
from services.ai_proxy_types import AIProxyConfigError, AIProxyError
from services.api_provider_registry import MINIMAX_M3_MODEL, MINIMAX_M3_OPERATION
from services.api_provider_runtime import resolve_provider

logger = logging.getLogger(__name__)


MINIMAX_SYSTEM_PROMPT = "You are a helpful assistant for storyboard generation tasks."
MINIMAX_KEEPALIVE_SECONDS = 5.0
MINIMAX_MAX_OUTPUT_TOKENS = 16384


def _resolve_minimax_config(
    model: Optional[str] = None,
    usage_scope: Optional[str] = None,
) -> Any:
    config = resolve_provider("minimax", model or MINIMAX_M3_OPERATION, usage_scope=usage_scope)
    if not config.api_key:
        raise AIProxyConfigError(
            "MiniMax 服务未配置，请在管理后台 (Admin → API 配置) 添加 minimax 提供商的 API Key 后重试",
            status_code=503,
        )
    if not config.endpoint:
        raise AIProxyConfigError("MiniMax 服务 endpoint 未配置，请联系管理员", status_code=503)
    return config


def ensure_minimax_configured(
    model: Optional[str] = None,
    usage_scope: Optional[str] = None,
) -> None:
    _resolve_minimax_config(model, usage_scope=usage_scope)


def build_minimax_payload(
    *,
    prompt: str,
    model: str,
    temperature: float = 0.2,
    stream: bool = True,
) -> Dict[str, Any]:
    return {
        "model": model,
        "max_tokens": MINIMAX_MAX_OUTPUT_TOKENS,
        "system": MINIMAX_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": prompt}],
        "stream": stream,
        "temperature": temperature,
        "thinking": {"type": "disabled"},
    }


def _sse_event(payload: Dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def minimax_anthropic_messages_url(endpoint: str) -> str:
    """Normalize a MiniMax provider endpoint to the official Anthropic Messages API."""
    raw = (endpoint or "").strip().rstrip("/")
    parsed = urlsplit(raw)
    path = parsed.path.rstrip("/")
    for suffix in (
        "/anthropic/v1/messages",
        "/anthropic/v1",
        "/anthropic",
        "/v1/chat/completions",
        "/v1",
    ):
        if path.lower().endswith(suffix):
            path = path[: -len(suffix)]
            break
    normalized_path = f"{path}/anthropic/v1/messages"
    return urlunsplit((parsed.scheme, parsed.netloc, normalized_path, parsed.query, ""))


def _minimax_chat_url(
    model: Optional[str],
    usage_scope: Optional[str] = None,
) -> tuple[str, Dict[str, Any], str]:
    config = _resolve_minimax_config(model, usage_scope=usage_scope)
    resolved_model = config.model_name or MINIMAX_M3_MODEL
    return minimax_anthropic_messages_url(config.endpoint), {
        "headers": {
            "X-Api-Key": config.api_key,
            "Anthropic-Version": "2023-06-01",
            "Content-Type": "application/json",
        },
        **config.requests_kwargs(),
    }, resolved_model


def stream_minimax_chat(
    *,
    prompt: str,
    response_format: str = "text",
    temperature: float = 0.2,
    model: Optional[str] = None,
    usage_scope: Optional[str] = None,
    on_complete: Optional[Callable[[str], None]] = None,
    on_error: Optional[Callable[[str], None]] = None,
) -> Iterator[str]:
    """Yield one MiniMax M3 request with immediate SSE keepalive frames."""
    del response_format  # The script prompts already enforce JSON where required.
    event_queue: queue.Queue[tuple[str, Optional[str]]] = queue.Queue()
    stop_event = threading.Event()

    def produce() -> None:
        response = None
        full_content: List[str] = []
        stream_error: Optional[str] = None
        try:
            url, request_kwargs, resolved_model = _minimax_chat_url(model, usage_scope=usage_scope)
            payload = build_minimax_payload(
                prompt=prompt,
                model=resolved_model,
                temperature=temperature,
            )
            response = _post_stream_request(
                label="MiniMax M3 stream",
                url=url,
                payload=payload,
                timeout=(20, 180),
                timeout_message="MiniMax API 调用超时，请稍后重试",
                request_error_detail=lambda exc: f"MiniMax API 调用失败: {str(exc)[:200]}",
                request_kwargs=request_kwargs,
            )
            _ensure_stream_response_ok(
                label="MiniMax",
                response=response,
                upstream_detail=lambda upstream, status_code: (
                    f"MiniMax API 调用失败: {upstream[:200] or status_code}"
                ),
            )

            for raw_line in response.iter_lines(decode_unicode=True):
                if stop_event.is_set():
                    return
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
                except Exception as exc:
                    logger.warning(
                        "MiniMax stream chunk parse failed: %s | data=%s",
                        exc,
                        data[:200],
                    )
                    continue

                if chunk.get("type") == "error":
                    error = chunk.get("error") or {}
                    stream_error = str(
                        error.get("message")
                        if isinstance(error, dict)
                        else error
                    )[:200] or "MiniMax 返回错误"
                    break
                if chunk.get("type") == "message_stop":
                    break

                delta = chunk.get("delta") or {}
                delta_type = str(delta.get("type") or "")
                reasoning_content = delta.get("thinking")
                if delta_type == "thinking_delta" and isinstance(reasoning_content, str) and reasoning_content:
                    event_queue.put((
                        "event",
                        _sse_event({"type": "reasoning", "content": reasoning_content}),
                    ))

                content_piece = delta.get("text")
                if delta_type == "text_delta" and isinstance(content_piece, str) and content_piece:
                    full_content.append(content_piece)
                    event_queue.put((
                        "event",
                        _sse_event({"type": "content", "content": content_piece}),
                    ))
        except AIProxyError as exc:
            stream_error = exc.detail
        except Exception as exc:
            logger.error("MiniMax stream read failed: %s", exc, exc_info=True)
            stream_error = f"MiniMax 流式读取失败: {str(exc)[:200]}"
        finally:
            if response is not None:
                response.close()

        if stop_event.is_set():
            return
        if stream_error:
            event_queue.put(("error", stream_error))
        elif full_content:
            event_queue.put(("complete", "".join(full_content)))
        else:
            event_queue.put(("error", "MiniMax 返回空内容"))
        event_queue.put(("done", None))

    producer = threading.Thread(
        target=produce,
        name="minimax-m3-stream",
        daemon=True,
    )
    producer.start()

    completed_content: Optional[str] = None
    stream_error: Optional[str] = None
    try:

        yield ": connected\n\n"
        while True:
            try:
                event_type, value = event_queue.get(timeout=MINIMAX_KEEPALIVE_SECONDS)
            except queue.Empty:
                yield ": keepalive\n\n"
                continue
            if event_type == "event" and value:
                yield value
            elif event_type == "complete":
                completed_content = value or ""
            elif event_type == "error":
                stream_error = value or "MiniMax 返回空内容"
                yield _sse_event({"type": "error", "message": stream_error})
            elif event_type == "done":
                break
    except GeneratorExit:
        stop_event.set()
        if on_error:
            on_error("客户端中断 MiniMax 流式连接")
        raise

    if completed_content and on_complete:
        on_complete(completed_content)
    elif stream_error and on_error:
        on_error(stream_error)

    yield "data: [DONE]\n\n"
