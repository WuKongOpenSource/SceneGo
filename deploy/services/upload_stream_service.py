"""Bounded readers for request uploads.

FastAPI's ``UploadFile`` is already spooled, but calling ``read()`` without a
limit can still copy an attacker-controlled payload into application memory.
All public upload routes should use this helper before passing byte content to
legacy service functions.
"""
from __future__ import annotations

from typing import Any


DEFAULT_CHUNK_SIZE = 1024 * 1024


class UploadPayloadTooLarge(ValueError):
    """Raised as soon as an upload exceeds its configured byte limit."""


async def read_upload_limited(
    upload_file: Any,
    *,
    max_bytes: int,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
) -> bytes:
    """Read an upload in bounded chunks and stop before unbounded allocation."""
    if max_bytes <= 0:
        raise ValueError("max_bytes must be a positive integer")
    if chunk_size <= 0:
        raise ValueError("chunk_size must be a positive integer")

    payload = bytearray()
    while True:
        chunk = await upload_file.read(min(chunk_size, max_bytes - len(payload) + 1))
        if not chunk:
            return bytes(payload)
        payload.extend(chunk)
        if len(payload) > max_bytes:
            raise UploadPayloadTooLarge(f"upload exceeds {max_bytes} bytes")
