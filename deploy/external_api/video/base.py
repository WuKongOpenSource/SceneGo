"""Shared helpers for external video API clients."""
from __future__ import annotations

import logging
from typing import Any, Dict, Mapping, Optional

import requests

from services.remote_content_service import (
    configured_download_limit,
    read_requests_response_limited,
)
from services.provider_endpoint_policy import validate_provider_endpoint
from services.sensitive_data_redaction import redact_sensitive_text
from utils.net_guard import assert_public_http_url


DEFAULT_MAX_REMOTE_VIDEO_BYTES = 1024 * 1024 * 1024

def request_json(
    method: str,
    url: str,
    *,
    headers: Optional[Mapping[str, str]] = None,
    timeout: int = 30,
    request_kwargs: Optional[Dict[str, Any]] = None,
    logger: Optional[logging.Logger] = None,
    label: str = "video api",
    **kwargs: Any,
) -> Any:
    """Send an HTTP request and return a JSON response with shared runtime kwargs."""
    log = logger or logging.getLogger(__name__)
    options = dict(request_kwargs or {})
    options.update(kwargs)
    options.setdefault("allow_redirects", False)
    validate_provider_endpoint(url)
    response = requests.request(
        method.upper(),
        url,
        headers=dict(headers or {}),
        timeout=timeout,
        **options,
    )
    if not getattr(response, "ok", True):
        log.error(
            "%s JSON request failed: HTTP %s body=%s",
            label,
            getattr(response, "status_code", "?"),
            redact_sensitive_text(getattr(response, "text", ""), max_chars=500),
        )
    response.raise_for_status()
    data = response.json()
    log.debug("%s JSON request complete: %s %s", label, method.upper(), url)
    return data


def request_multipart_json(
    method: str,
    url: str,
    *,
    headers: Optional[Mapping[str, str]] = None,
    files: Optional[Mapping[str, Any]] = None,
    data: Optional[Mapping[str, Any]] = None,
    timeout: int = 30,
    request_kwargs: Optional[Dict[str, Any]] = None,
    logger: Optional[logging.Logger] = None,
    label: str = "video api",
) -> Any:
    """Send a multipart request and return a JSON response with shared runtime kwargs."""
    log = logger or logging.getLogger(__name__)
    options = dict(request_kwargs or {})
    options.setdefault("allow_redirects", False)
    validate_provider_endpoint(url)
    response = requests.request(
        method.upper(),
        url,
        headers=dict(headers or {}),
        files=files,
        data=data,
        timeout=timeout,
        **options,
    )
    if not getattr(response, "ok", True):
        log.error(
            "%s multipart request failed: HTTP %s body=%s",
            label,
            getattr(response, "status_code", "?"),
            redact_sensitive_text(getattr(response, "text", ""), max_chars=500),
        )
    response.raise_for_status()
    result = response.json()
    log.debug("%s multipart request complete: %s %s", label, method.upper(), url)
    return result


def download_streaming_video(
    url: str,
    *,
    headers: Optional[Mapping[str, str]] = None,
    timeout: int = 120,
    request_kwargs: Optional[Dict[str, Any]] = None,
    logger: Optional[logging.Logger] = None,
    label: str = "video",
    chunk_size: int = 8192,
    max_bytes: Optional[int] = None,
) -> bytes:
    """Download a video URL with shared streaming/chunk handling."""
    log = logger or logging.getLogger(__name__)
    kwargs = request_kwargs or {}
    assert_public_http_url(url)
    response = requests.get(
        url,
        headers=dict(headers or {}),
        stream=True,
        timeout=timeout,
        allow_redirects=False,
        **kwargs,
    )
    if 300 <= getattr(response, "status_code", 200) < 400:
        raise RuntimeError(f"{label} download redirect was refused")
    response.raise_for_status()

    limit = max_bytes or configured_download_limit(
        "MAX_REMOTE_VIDEO_DOWNLOAD_BYTES",
        DEFAULT_MAX_REMOTE_VIDEO_BYTES,
    )
    data = read_requests_response_limited(
        response,
        max_bytes=limit,
        chunk_size=chunk_size,
    )
    log.info("%s download complete: %s bytes", label, len(data))
    return data
