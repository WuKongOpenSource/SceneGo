"""Shared types for AI proxy services and routes."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict


class AIProxyError(RuntimeError):
    def __init__(
        self,
        detail: str,
        *,
        status_code: int = 500,
        upstream: str = "",
    ):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code
        self.upstream = upstream


class AIProxyConfigError(AIProxyError):
    pass


class AIProxyUpstreamError(AIProxyError):
    pass


@dataclass(frozen=True)
class GptImageReferenceInput:
    filename: str
    content: bytes
    mime_type: str


@dataclass(frozen=True)
class TextGenerationResult:
    content: str
    provider: str
    model_name: str
    failover: Dict[str, Any]
