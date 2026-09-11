"""Helpers for resolving local image references safely."""
from __future__ import annotations

import base64
import logging
from pathlib import Path

from utils.net_guard import safe_storage_path as _safe_storage_path

logger = logging.getLogger(__name__)

_DEPLOY_ROOT = Path(__file__).resolve().parents[1]


def storage_path_safe(url: str, deploy_root: Path | None = None) -> Path:
    """Resolve a /storage/... URL under persistent_storage, returning a non-existent sentinel on rejection."""
    root = Path(deploy_root or _DEPLOY_ROOT)
    try:
        return Path(_safe_storage_path(url, str(root)))
    except ValueError:
        logger.warning("Rejected out-of-bounds /storage path: %r", url)
        return root / "persistent_storage" / "__blocked_nonexistent__"


def data_url_to_base64(data_url: str) -> str:
    if not data_url:
        return ""
    if "base64," in data_url:
        return data_url.split("base64,", 1)[1]
    if data_url.startswith("/storage/"):
        file_path = storage_path_safe(data_url)
        if file_path.exists():
            return base64.b64encode(file_path.read_bytes()).decode("utf-8")
        logger.warning("data_url_to_base64: file not found: %s", file_path)
        return ""
    if "," in data_url:
        return data_url.split(",", 1)[1]
    return data_url


def to_doubao_image_input(ref: str) -> str:
    """Convert common image references into the data URL format accepted by Ark image APIs."""
    if not ref:
        return ""
    if ref.startswith("data:image/"):
        try:
            head, body = ref.split(";base64,", 1)
            fmt = head.split("/", 1)[1].lower()
            if fmt == "jpg":
                fmt = "jpeg"
            return f"data:image/{fmt};base64,{body}"
        except Exception:
            return ref
    if ref.startswith("/storage/"):
        file_path = storage_path_safe(ref)
        if not file_path.exists():
            logger.warning("to_doubao_image_input: file not found: %s", file_path)
            return ""
        ext = file_path.suffix.lower().lstrip(".")
        if ext == "jpg":
            ext = "jpeg"
        if ext not in ("jpeg", "png", "webp", "bmp", "tiff", "gif"):
            ext = "png"
        b64 = base64.b64encode(file_path.read_bytes()).decode("utf-8")
        return f"data:image/{ext};base64,{b64}"
    if ref.startswith(("http://", "https://")):
        return ref
    return f"data:image/png;base64,{ref}"
