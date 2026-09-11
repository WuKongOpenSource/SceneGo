"""Content loading helpers for AI proxy generated images."""
from __future__ import annotations

import base64
import logging

import requests

from services.remote_content_service import (
    RemoteContentTooLarge,
    configured_download_limit,
    read_requests_response_limited,
)
from services.ai_proxy_types import AIProxyUpstreamError
from utils.net_guard import assert_public_http_url

logger = logging.getLogger(__name__)
DEFAULT_MAX_REMOTE_IMAGE_BYTES = 50 * 1024 * 1024


def generated_image_content(
    image: str,
    *,
    timeout: int = 60,
    max_bytes: int | None = None,
) -> bytes:
    """Return bytes for a generated image data URL or provider-hosted public URL."""
    limit = max_bytes or configured_download_limit(
        "MAX_REMOTE_IMAGE_DOWNLOAD_BYTES",
        DEFAULT_MAX_REMOTE_IMAGE_BYTES,
    )
    if image.startswith("data:"):
        b64_data = image.split(",", 1)[1] if "," in image else image
        try:
            content = base64.b64decode(b64_data, validate=True)
        except (ValueError, TypeError) as exc:
            raise AIProxyUpstreamError("生成图片数据无效") from exc
        if len(content) > limit:
            raise AIProxyUpstreamError("生成图片超过大小限制", status_code=413)
        return content

    assert_public_http_url(image)
    try:
        response = requests.get(
            image,
            timeout=timeout,
            stream=True,
            allow_redirects=False,
        )
        if 300 <= response.status_code < 400:
            raise AIProxyUpstreamError("生成图片下载重定向已被安全策略拒绝")
        response.raise_for_status()
        return read_requests_response_limited(response, max_bytes=limit)
    except RemoteContentTooLarge as exc:
        raise AIProxyUpstreamError("生成图片超过大小限制", status_code=413) from exc
    except requests.Timeout as exc:
        raise AIProxyUpstreamError("下载生成图片超时，请稍后重试", status_code=504) from exc
    except requests.RequestException as exc:
        logger.warning("Generated image download failed: %s", exc, exc_info=True)
        raise AIProxyUpstreamError(f"下载生成图片失败: {str(exc)[:200]}") from exc
