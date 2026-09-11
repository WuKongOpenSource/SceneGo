"""Size-bounded response readers shared by remote media download paths."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any


class RemoteContentTooLarge(ValueError):
    """Raised when a remote body exceeds its declared or observed limit."""


def configured_download_limit(env_name: str, default_bytes: int) -> int:
    try:
        value = int(os.getenv(env_name, str(default_bytes)))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{env_name} must be an integer number of bytes") from exc
    if value <= 0:
        raise ValueError(f"{env_name} must be positive")
    return value


def _declared_content_length(response: Any) -> int | None:
    headers = getattr(response, "headers", {}) or {}
    value = headers.get("Content-Length") or headers.get("content-length")
    if value is None:
        return None
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return None


def read_requests_response_limited(
    response: Any,
    *,
    max_bytes: int,
    chunk_size: int = 64 * 1024,
) -> bytes:
    """Read a requests-style streaming response with an exact byte ceiling."""
    try:
        declared = _declared_content_length(response)
        if declared is not None and declared > max_bytes:
            raise RemoteContentTooLarge(f"remote content exceeds {max_bytes} bytes")

        payload = bytearray()
        for chunk in response.iter_content(chunk_size=chunk_size):
            if not chunk:
                continue
            payload.extend(chunk)
            if len(payload) > max_bytes:
                raise RemoteContentTooLarge(f"remote content exceeds {max_bytes} bytes")
        return bytes(payload)
    finally:
        close = getattr(response, "close", None)
        if callable(close):
            close()


async def read_aiohttp_response_limited(
    response: Any,
    *,
    max_bytes: int,
    chunk_size: int = 64 * 1024,
) -> bytes:
    """Read an aiohttp response body with an exact byte ceiling."""
    declared = getattr(response, "content_length", None)
    if declared is not None and declared > max_bytes:
        raise RemoteContentTooLarge(f"remote content exceeds {max_bytes} bytes")

    payload = bytearray()
    async for chunk in response.content.iter_chunked(chunk_size):
        if not chunk:
            continue
        payload.extend(chunk)
        if len(payload) > max_bytes:
            raise RemoteContentTooLarge(f"remote content exceeds {max_bytes} bytes")
    return bytes(payload)


async def write_aiohttp_response_limited(
    response: Any,
    destination: str | os.PathLike[str],
    *,
    max_bytes: int,
    chunk_size: int = 64 * 1024,
) -> int:
    """Stream an aiohttp response to disk and stop before exhausting storage."""
    declared = getattr(response, "content_length", None)
    if declared is not None and declared > max_bytes:
        raise RemoteContentTooLarge(f"remote content exceeds {max_bytes} bytes")

    path = Path(destination)
    written = 0
    try:
        with path.open("wb") as output:
            async for chunk in response.content.iter_chunked(chunk_size):
                if not chunk:
                    continue
                written += len(chunk)
                if written > max_bytes:
                    raise RemoteContentTooLarge(f"remote content exceeds {max_bytes} bytes")
                output.write(chunk)
        return written
    except Exception:
        path.unlink(missing_ok=True)
        raise
