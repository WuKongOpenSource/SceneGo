"""Canonical storage path helpers.

The public URL remains ``/storage/<relative path>``.  New generated media
should be grouped by user, project, episode, and month so migrations and
cleanup can reason about ownership without scanning business tables.
"""
from __future__ import annotations

import mimetypes
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Optional


_SAFE_SEGMENT_RE = re.compile(r"[^A-Za-z0-9_.-]+")
_TYPE_ALIASES = {
    "images": "image",
    "videos": "video",
    "audios": "audio",
}
_MIME_EXT = {
    "image/webp": ".webp",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
}


def canonical_file_type(file_type: Optional[str]) -> str:
    value = (file_type or "other").strip().lower()
    return _TYPE_ALIASES.get(value, value or "other")


def safe_segment(value: Any, fallback: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return fallback
    cleaned = _SAFE_SEGMENT_RE.sub("_", raw).strip("._-")
    return (cleaned or fallback)[:120]


def year_month_from(value: Any = None) -> str:
    if isinstance(value, datetime):
        return value.strftime("%Y%m")
    if isinstance(value, str) and len(value) >= 7:
        compact = value[:7].replace("-", "")
        if len(compact) == 6 and compact.isdigit():
            return compact
    return datetime.now().strftime("%Y%m")


def extension_from(
    *,
    file_name: Optional[str] = None,
    file_path: Optional[str] = None,
    file_url: Optional[str] = None,
    mime_type: Optional[str] = None,
    default: str = ".bin",
) -> str:
    for candidate in (file_name, file_path, file_url):
        suffix = Path(str(candidate or "").split("?", 1)[0]).suffix
        if suffix and len(suffix) <= 12:
            return suffix.lower()
    mime = (mime_type or "").split(";", 1)[0].lower()
    if mime in _MIME_EXT:
        return _MIME_EXT[mime]
    guessed = mimetypes.guess_extension(mime) if mime else None
    return (guessed or default).lower()


def build_storage_relative_path(
    *,
    file_type: str,
    user_id: str,
    project_id: Optional[str],
    episode_id: Optional[str],
    year_month: str,
    file_id: str,
    extension: str,
) -> Path:
    ext = extension if extension.startswith(".") else f".{extension}"
    filename = f"{safe_segment(file_id, 'file')}{ext}"
    return Path(
        canonical_file_type(file_type),
        safe_segment(user_id, "_user"),
        safe_segment(project_id, "_global"),
        safe_segment(episode_id, "_project"),
        safe_segment(year_month, datetime.now().strftime("%Y%m")),
        filename,
    )


def storage_url_for(relative_path: Path) -> str:
    return f"/storage/{relative_path.as_posix()}"
