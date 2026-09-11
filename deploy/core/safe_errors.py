"""Production HTTP error rendering that never reflects internal exceptions."""
from __future__ import annotations

import logging
import os

from fastapi import HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from starlette.responses import JSONResponse, Response

from services.sensitive_data_redaction import redact_sensitive_text


logger = logging.getLogger(__name__)

SAFE_SERVER_DETAILS = {
    500: "服务器处理请求失败",
    501: "该功能当前不可用",
    502: "上游服务暂不可用，请稍后重试",
    503: "服务暂不可用，请稍后重试",
    504: "上游服务响应超时，请稍后重试",
}


def _safe_client_detail(value, *, depth: int = 0):
    """Return a small JSON-safe error detail with nested secrets removed."""
    if depth > 4:
        return "[TRUNCATED]"
    if isinstance(value, str):
        return redact_sensitive_text(value, max_chars=500)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, (list, tuple)):
        return [_safe_client_detail(item, depth=depth + 1) for item in value[:100]]
    if isinstance(value, dict):
        safe = {}
        for index, (raw_key, item) in enumerate(value.items()):
            if index >= 100:
                break
            key = redact_sensitive_text(raw_key, max_chars=100)
            if any(marker in str(raw_key).casefold() for marker in (
                "password", "secret", "token", "authorization", "cookie", "api_key", "apikey"
            )):
                safe[key] = "[REDACTED]"
            else:
                safe[key] = _safe_client_detail(item, depth=depth + 1)
        return safe
    return "请求参数或状态不正确"


def _production() -> bool:
    return os.getenv("OSTORY_RUNTIME_ENV", "development").strip().lower() == "production"


async def safe_http_exception_handler(request: Request, exc: HTTPException) -> Response:
    """Preserve development diagnostics and bound every production error.

    A 4xx response is normally actionable user feedback, so its wording remains
    intact after credential/path redaction.  A 5xx response crosses a different
    trust boundary and is replaced with a fixed public message.
    """
    if not _production():
        return await http_exception_handler(request, exc)

    if exc.status_code < 500:
        detail = _safe_client_detail(exc.detail)
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": detail},
            headers=exc.headers,
        )

    logger.error(
        "HTTP request failed path=%s status=%s",
        request.url.path,
        exc.status_code,
    )
    detail = SAFE_SERVER_DETAILS.get(exc.status_code, "服务暂不可用，请稍后重试")
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": detail},
        headers=exc.headers,
    )
