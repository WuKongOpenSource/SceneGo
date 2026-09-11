"""Application-level total request-body ceiling.

Per-file checks happen after multipart parsing. This outer ASGI middleware
rejects oversized declared bodies before Starlette allocates or spools them,
and safely buffers size-unknown upload bodies to a spooled temporary file.
"""
from __future__ import annotations

import os
import tempfile
from typing import Any

from starlette.responses import JSONResponse


DEFAULT_MAX_REQUEST_BODY_BYTES = 100 * 1024 * 1024
BODY_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def configured_request_body_limit() -> int:
    raw = os.getenv("MAX_REQUEST_BODY_BYTES", str(DEFAULT_MAX_REQUEST_BODY_BYTES))
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("MAX_REQUEST_BODY_BYTES must be an integer") from exc
    if value <= 0:
        raise ValueError("MAX_REQUEST_BODY_BYTES must be positive")
    return value


class RequestBodyLimitMiddleware:
    """Reject request bodies beyond an exact byte count before route parsing."""

    def __init__(self, app, *, max_bytes: int | None = None, spool_memory_bytes: int = 1024 * 1024):
        self.app = app
        self.max_bytes = max_bytes or configured_request_body_limit()
        self.spool_memory_bytes = max(64 * 1024, int(spool_memory_bytes))

    async def _reject(self, scope, receive, send) -> None:
        response = JSONResponse(
            {"detail": "请求体超过服务器允许的大小"},
            status_code=413,
            headers={"Cache-Control": "no-store"},
        )
        await response(scope, receive, send)

    async def __call__(self, scope: dict[str, Any], receive, send) -> None:
        if scope.get("type") != "http" or str(scope.get("method") or "").upper() not in BODY_METHODS:
            await self.app(scope, receive, send)
            return

        headers = {name.lower(): value for name, value in scope.get("headers") or []}
        raw_length = headers.get(b"content-length")
        if raw_length is not None:
            try:
                declared = int(raw_length)
            except (TypeError, ValueError):
                declared = -1
            if declared > self.max_bytes:
                await self._reject(scope, receive, send)
                return
            if 0 <= declared <= self.max_bytes:
                await self.app(scope, receive, send)
                return

        spool = tempfile.SpooledTemporaryFile(max_size=self.spool_memory_bytes)
        total = 0
        try:
            while True:
                message = await receive()
                if message.get("type") == "http.disconnect":
                    return
                body = message.get("body") or b""
                total += len(body)
                if total > self.max_bytes:
                    await self._reject(scope, receive, send)
                    return
                spool.write(body)
                if not message.get("more_body", False):
                    break

            spool.seek(0)
            finished = False

            async def replay_receive():
                nonlocal finished
                if finished:
                    return {"type": "http.disconnect"}
                chunk = spool.read(64 * 1024)
                more = spool.tell() < total
                if not more:
                    finished = True
                return {"type": "http.request", "body": chunk, "more_body": more}

            await self.app(scope, replay_receive, send)
        finally:
            spool.close()
