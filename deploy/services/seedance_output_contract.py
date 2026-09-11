"""Output validation shared by request parsing and the provider adapter."""
from typing import Any


def seedance_output_resolution(value: Any, model: str = "") -> str:
    resolution = str(value if value is not None else "").strip().lower() or "720p"
    if resolution not in ("480p", "720p", "1080p"):
        raise ValueError("Seedance 清晰度无效，请选择 480P、720P 或 1080P")
    model = str(model or "").strip().lower()
    is_limited = model in ("mini", "fast") or any(
        variant in model for variant in ("seedance-2-0-mini", "seedance-2-0-fast")
    )
    if is_limited and resolution == "1080p":
        raise ValueError("Seedance 2.0 Fast / Mini 仅支持 480P 或 720P，请调整清晰度后重试")
    return resolution
