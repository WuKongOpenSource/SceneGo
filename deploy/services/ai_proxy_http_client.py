"""HTTP helpers shared by AI proxy provider services."""
from __future__ import annotations

import asyncio
import io
import json
import logging
import time
from typing import Any, Callable, Dict, Optional, Union

import requests

from services.ai_proxy_types import AIProxyError, AIProxyUpstreamError
from services.provider_endpoint_policy import validate_provider_endpoint
from services.sensitive_data_redaction import redact_sensitive_text

logger = logging.getLogger(__name__)


class _BoundedJsonUpload(io.BytesIO):
    """Send original JSON in bounded writes instead of one large socket sendall.

    The socket write timeout applies per chunk; this deadline also bounds the
    complete upload. A seekable body lets requests supply Content-Length, not
    chunked transfer encoding, for providers that reject streaming HTTP bodies.
    """

    def __init__(self, payload: Dict[str, Any], max_seconds: float):
        super().__init__(json.dumps(payload, allow_nan=False).encode("utf-8"))
        self.deadline = time.monotonic() + max_seconds

    def read(self, size: int = -1) -> bytes:
        if time.monotonic() >= self.deadline:
            raise requests.Timeout("Provider JSON upload exceeded its total deadline")
        return super().read(min(size, 64 * 1024) if size >= 0 else 64 * 1024)


def _is_timeout_exception(error: BaseException) -> bool:
    """Recognize timeouts wrapped by requests/urllib3 during request upload."""
    pending: list[Any] = [error]
    seen: set[int] = set()
    while pending:
        current = pending.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        if isinstance(current, (requests.Timeout, TimeoutError)):
            return True
        if isinstance(current, BaseException):
            message = str(current).casefold()
            if "timed out" in message or "timeout" in message:
                return True
            pending.extend(getattr(current, "args", ()) or ())
            cause = getattr(current, "__cause__", None)
            context = getattr(current, "__context__", None)
            if cause is not None:
                pending.append(cause)
            if context is not None:
                pending.append(context)
        elif isinstance(current, (tuple, list)):
            pending.extend(current)
    return False


def _default_upstream_detail(label: str) -> Callable[[str, int], str]:
    return lambda upstream, status_code: f"{label} API 调用失败: {upstream[:200] or status_code}"


def _read_post_json_response(
    *,
    label: str,
    response: Any,
    parse_error_message: str,
    expected_status: Optional[int] = None,
    upstream_detail: Optional[Callable[[str, int], str]] = None,
    upstream_status_code: Union[int, Callable[[int], int]] = 502,
    upstream_status_detail: Optional[Callable[[str, int], int]] = None,
) -> Dict[str, Any]:
    failed = response.status_code >= 400 if expected_status is None else response.status_code != expected_status
    if failed:
        upstream = redact_sensitive_text(response.text, max_chars=500)
        logger.error("%s upstream failed: status=%s body=%s", label, response.status_code, upstream)
        detail_factory = upstream_detail or _default_upstream_detail(label)
        normalized_status = (
            upstream_status_detail(upstream, response.status_code)
            if upstream_status_detail
            else (
                upstream_status_code(response.status_code)
                if callable(upstream_status_code)
                else upstream_status_code
            )
        )
        raise AIProxyUpstreamError(
            detail_factory(upstream, response.status_code),
            status_code=normalized_status,
            upstream=upstream,
        )
    try:
        return response.json()
    except ValueError as e:
        logger.error("%s response JSON parse failed: %s", label, e, exc_info=True)
        raise AIProxyUpstreamError(parse_error_message) from e


def _post_json_request(
    *,
    label: str,
    url: str,
    headers: Dict[str, str],
    payload: Dict[str, Any],
    timeout: Any,
    timeout_message: str,
    request_error_message: str,
    parse_error_message: str,
    request_kwargs: Optional[Dict[str, Any]] = None,
    expected_status: Optional[int] = None,
    timeout_status_code: int = 504,
    upstream_detail: Optional[Callable[[str, int], str]] = None,
    upstream_status_code: Union[int, Callable[[int], int]] = 502,
    upstream_status_detail: Optional[Callable[[str, int], int]] = None,
    upload_timeout: Optional[float] = None,
) -> Dict[str, Any]:
    """POST provider JSON while keeping provider-specific detail at call sites."""
    upload = None
    try:
        validate_provider_endpoint(url)
        options = dict(request_kwargs or {})
        options.setdefault("allow_redirects", False)
        body = {"json": payload}
        if upload_timeout is not None:
            upload = _BoundedJsonUpload(payload, max_seconds=upload_timeout)
            body = {"data": upload}
            headers = {"Content-Type": "application/json", **headers}
        response = requests.post(
            url,
            headers=headers,
            **body,
            timeout=timeout,
            **options,
        )
        return _read_post_json_response(
            label=label,
            response=response,
            parse_error_message=parse_error_message,
            expected_status=expected_status,
            upstream_detail=upstream_detail,
            upstream_status_code=upstream_status_code,
            upstream_status_detail=upstream_status_detail,
        )
    except AIProxyError:
        raise
    except requests.Timeout as e:
        raise AIProxyUpstreamError(timeout_message, status_code=timeout_status_code) from e
    except requests.RequestException as e:
        if _is_timeout_exception(e):
            raise AIProxyUpstreamError(timeout_message, status_code=timeout_status_code) from e
        logger.error(
            "%s request failed: %s",
            label,
            redact_sensitive_text(e, max_chars=300),
            exc_info=True,
        )
        raise AIProxyUpstreamError(request_error_message) from e
    finally:
        if upload is not None:
            upload.close()


async def _post_json_request_async(**kwargs: Any) -> Dict[str, Any]:
    return await asyncio.to_thread(_post_json_request, **kwargs)


def _post_form_request(
    *,
    label: str,
    url: str,
    headers: Dict[str, str],
    data: Dict[str, str],
    files: Any,
    timeout: Any,
    timeout_message: str,
    request_error_message: str,
    parse_error_message: str,
    request_kwargs: Optional[Dict[str, Any]] = None,
    expected_status: Optional[int] = None,
    timeout_status_code: int = 504,
    upstream_detail: Optional[Callable[[str, int], str]] = None,
    upstream_status_code: Union[int, Callable[[int], int]] = 502,
    upstream_status_detail: Optional[Callable[[str, int], int]] = None,
) -> Dict[str, Any]:
    """POST provider multipart/form-data while sharing upstream response handling."""
    try:
        validate_provider_endpoint(url)
        options = dict(request_kwargs or {})
        options.setdefault("allow_redirects", False)
        response = requests.post(
            url,
            headers=headers,
            data=data,
            files=files,
            timeout=timeout,
            **options,
        )
        return _read_post_json_response(
            label=label,
            response=response,
            parse_error_message=parse_error_message,
            expected_status=expected_status,
            upstream_detail=upstream_detail,
            upstream_status_code=upstream_status_code,
            upstream_status_detail=upstream_status_detail,
        )
    except AIProxyError:
        raise
    except requests.Timeout as e:
        raise AIProxyUpstreamError(timeout_message, status_code=timeout_status_code) from e
    except requests.RequestException as e:
        if _is_timeout_exception(e):
            raise AIProxyUpstreamError(timeout_message, status_code=timeout_status_code) from e
        logger.error(
            "%s request failed: %s",
            label,
            redact_sensitive_text(e, max_chars=300),
            exc_info=True,
        )
        raise AIProxyUpstreamError(request_error_message) from e


async def _post_form_request_async(**kwargs: Any) -> Dict[str, Any]:
    return await asyncio.to_thread(_post_form_request, **kwargs)


def _post_stream_request(
    *,
    label: str,
    url: str,
    payload: Dict[str, Any],
    timeout: Any,
    timeout_message: str,
    request_error_detail: Callable[[Exception], str],
    request_kwargs: Optional[Dict[str, Any]] = None,
    timeout_status_code: int = 504,
) -> Any:
    """POST a streaming provider request and normalize connection errors."""
    try:
        validate_provider_endpoint(url)
        options = dict(request_kwargs or {})
        options.setdefault("allow_redirects", False)
        return requests.post(
            url,
            json=payload,
            stream=True,
            timeout=timeout,
            **options,
        )
    except requests.Timeout as e:
        logger.error(
            "%s stream request timeout: %s",
            label,
            redact_sensitive_text(e, max_chars=300),
            exc_info=True,
        )
        raise AIProxyUpstreamError(timeout_message, status_code=timeout_status_code) from e
    except requests.RequestException as e:
        if _is_timeout_exception(e):
            raise AIProxyUpstreamError(timeout_message, status_code=timeout_status_code) from e
        safe_error = redact_sensitive_text(e, max_chars=300)
        logger.error("%s stream request failed: %s", label, safe_error, exc_info=True)
        raise AIProxyUpstreamError(
            redact_sensitive_text(request_error_detail(e), max_chars=300)
        ) from e


def _ensure_stream_response_ok(
    *,
    label: str,
    response: Any,
    upstream_detail: Optional[Callable[[str, int], str]] = None,
) -> None:
    if response.status_code < 400:
        return
    upstream = redact_sensitive_text(response.text, max_chars=500)
    logger.error("%s stream upstream failed: status=%s body=%s", label, response.status_code, upstream)
    detail_factory = upstream_detail or _default_upstream_detail(label)
    raise AIProxyUpstreamError(
        detail_factory(upstream, response.status_code),
        upstream=upstream,
    )
