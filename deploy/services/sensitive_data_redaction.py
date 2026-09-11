"""Conservative secret redaction for logs and diagnostic error summaries."""
from __future__ import annotations

import re
from typing import Any


_BEARER = re.compile(r"(?i)\b(Bearer\s+)[^\s,;\"']+")
_KEY_VALUE = re.compile(
    r"(?i)(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|cookie|secret|password)\b"
    r"\s*[\"']?\s*[:=]\s*[\"']?)([^\s,;\"'}]+)"
)
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")
_COMMON_KEY = re.compile(r"\b(?:sk|ak|rk)-[A-Za-z0-9_-]{8,}\b", re.IGNORECASE)
_URL_QUERY_SECRET = re.compile(
    r"(?i)([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)=)"
    r"[^&#\s]+"
)
_URL_QUERY = re.compile(r"(?i)(https?://[^\s?#]+)\?[^\s#]*")
_CONTENT_VALUE = re.compile(
    r"(?i)([\"']?(?:prompt|negative_prompt|text_prompt|lyrics|image_url|video_url|"
    r"audio_url|download_url)[\"']?\s*[:=]\s*[\"'])(.*?)([\"'])"
)
_WINDOWS_PATH = re.compile(r"(?i)\b[A-Z]:\\(?:[^\s\"'<>|]+\\)*[^\s\"'<>|]*")
_POSIX_PRIVATE_PATH = re.compile(
    r"(?<![A-Za-z0-9])/(?:home|root|users|private|srv|opt|etc|var|tmp)/[^\s\"'<>]*",
    re.IGNORECASE,
)


def redact_sensitive_text(value: Any, *, max_chars: int = 500) -> str:
    """Return a bounded diagnostic string with common credential forms hidden."""
    text = str(value or "")
    text = _BEARER.sub(r"\1[REDACTED]", text)
    text = _KEY_VALUE.sub(r"\1[REDACTED]", text)
    text = _JWT.sub("[REDACTED_JWT]", text)
    text = _COMMON_KEY.sub("[REDACTED_KEY]", text)
    text = _URL_QUERY_SECRET.sub(r"\1[REDACTED]", text)
    text = _URL_QUERY.sub(r"\1?[REDACTED_QUERY]", text)
    text = _CONTENT_VALUE.sub(r"\1[REDACTED_CONTENT]\3", text)
    text = _WINDOWS_PATH.sub("[REDACTED_PATH]", text)
    text = _POSIX_PRIVATE_PATH.sub("[REDACTED_PATH]", text)
    limit = max(0, int(max_chars))
    return text[:limit] if limit else ""
