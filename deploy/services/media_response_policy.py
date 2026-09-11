"""Safe response policy for user-controlled media files.

The browser must never decide whether an authenticated upload is executable
content from a client-supplied ``Content-Type`` value. Only a small extension
allowlist is eligible for inline playback or preview. Everything else is
served as an attachment with an inert MIME type.
"""
from __future__ import annotations

from pathlib import Path
from typing import Mapping
from urllib.parse import quote


SAFE_INLINE_MIME_BY_EXTENSION: Mapping[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
}


def safe_inline_media_type(filename_or_path: str | Path) -> str | None:
    """Return a server-owned MIME mapping for previewable media."""
    return SAFE_INLINE_MIME_BY_EXTENSION.get(Path(str(filename_or_path)).suffix.lower())


def safe_content_disposition(
    filename_or_path: str | Path,
    *,
    download_name: str | None = None,
) -> tuple[str, str, dict[str, str]]:
    """Return MIME type, disposition and defense-in-depth response headers."""
    safe_type = safe_inline_media_type(filename_or_path)
    name = Path(str(download_name or filename_or_path or "download")).name or "download"
    encoded_name = quote(name, safe="")
    if safe_type:
        disposition = f"inline; filename*=UTF-8''{encoded_name}"
        extra_headers: dict[str, str] = {}
    else:
        safe_type = "application/octet-stream"
        disposition = f"attachment; filename*=UTF-8''{encoded_name}"
        extra_headers = {"Content-Security-Policy": "sandbox; default-src 'none'"}
    return safe_type, disposition, extra_headers


def apply_safe_media_response_headers(
    response,
    filename_or_path: str | Path,
    *,
    download_name: str | None = None,
) -> None:
    """Apply the policy to an existing Starlette/FastAPI response in place."""
    media_type, disposition, extra_headers = safe_content_disposition(
        filename_or_path,
        download_name=download_name,
    )
    response.headers["Content-Type"] = media_type
    response.headers["Content-Disposition"] = disposition
    response.headers["X-Content-Type-Options"] = "nosniff"
    for name, value in extra_headers.items():
        response.headers[name] = value
