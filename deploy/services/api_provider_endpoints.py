"""Provider endpoint helpers shared by external API clients.

Admin-configured provider endpoints are allowed to be either a base API root or
a concrete create-task URL. Keep those provider-specific URL shape rules here so
clients do not drift apart when the admin config platform evolves.
"""
from __future__ import annotations

from typing import Iterable, List, Optional


DASHSCOPE_VIDEO_SYNTHESIS_PATH = "/services/aigc/video-generation/video-synthesis"
DASHSCOPE_COMPATIBLE_PATH = "/compatible-mode/v1"


def dedupe_urls(urls: Iterable[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for url in urls:
        clean = (url or "").strip().rstrip("/")
        if not clean or clean in seen:
            continue
        seen.add(clean)
        out.append(clean)
    return out


def derive_dashscope_video_urls(endpoint: Optional[str]) -> tuple[str, str]:
    """Return (query_api_root, create_endpoint) for DashScope video APIs.

    Supported endpoint forms:
    - .../compatible-mode/v1
    - .../api/v1
    - .../api/v1/services/aigc/video-generation/video-synthesis
    - a self-hosted API root that follows the same task URL contract
    """
    endpoint = (endpoint or "").strip().rstrip("/")
    if not endpoint:
        raise ValueError("DashScope endpoint is not configured")

    lower_endpoint = endpoint.lower()
    if lower_endpoint.endswith(DASHSCOPE_COMPATIBLE_PATH):
        api_root = endpoint[: -len(DASHSCOPE_COMPATIBLE_PATH)].rstrip("/") + "/api/v1"
        return api_root, f"{api_root}{DASHSCOPE_VIDEO_SYNTHESIS_PATH}"

    if DASHSCOPE_VIDEO_SYNTHESIS_PATH in endpoint:
        api_root = endpoint.split(DASHSCOPE_VIDEO_SYNTHESIS_PATH, 1)[0].rstrip("/")
        if not api_root:
            raise ValueError("DashScope endpoint is missing API root")
        return api_root, endpoint

    if lower_endpoint.endswith("/api/v1"):
        return endpoint, f"{endpoint}{DASHSCOPE_VIDEO_SYNTHESIS_PATH}"

    if "/services/" in endpoint:
        api_root = endpoint.split("/services/", 1)[0].rstrip("/")
        if not api_root:
            raise ValueError("DashScope endpoint is missing API root")
        return api_root, endpoint

    return endpoint, f"{endpoint}{DASHSCOPE_VIDEO_SYNTHESIS_PATH}"


def derive_models_health_urls(endpoint: Optional[str], provider: str = "") -> List[str]:
    """Return lightweight model-list health URLs derived from a provider endpoint."""
    endpoint = (endpoint or "").strip().rstrip("/")
    if not endpoint:
        return []

    provider = (provider or "").strip().lower()
    lower = endpoint.lower()
    candidates: List[str] = []
    matched_specific_endpoint = False

    if lower.endswith("/models"):
        return [endpoint]

    replacements = (
        ("/images/generations", "/models"),
        ("/images/edits", "/models"),
        ("/chat/completions", "/models"),
        ("/contents/generations/tasks", "/models"),
    )
    for suffix, target in replacements:
        if lower.endswith(suffix):
            candidates.append(f"{endpoint[: -len(suffix)]}{target}")
            matched_specific_endpoint = True

    dashscope_task_path = f"/api/v1{DASHSCOPE_VIDEO_SYNTHESIS_PATH}"
    if provider == "dashscope" and dashscope_task_path in lower:
        prefix = endpoint[: lower.index(dashscope_task_path)].rstrip("/")
        candidates.append(f"{prefix}{DASHSCOPE_COMPATIBLE_PATH}/models")
        matched_specific_endpoint = True

    if matched_specific_endpoint:
        candidates.append(endpoint)
    elif lower.endswith(("/v1", "/v1beta", "/api/v3", DASHSCOPE_COMPATIBLE_PATH)):
        candidates.append(f"{endpoint}/models")
    else:
        candidates.append(f"{endpoint}/models")
        candidates.append(endpoint)
    return dedupe_urls(candidates)
