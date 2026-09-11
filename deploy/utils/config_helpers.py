"""Small helpers for reading dict-like or object-like config rows."""
from __future__ import annotations

from typing import Any


def _config_get(config: Any, key: str, default: Any = None) -> Any:
    getter = getattr(config, "get", None)
    if callable(getter):
        return getter(key, default)
    try:
        return config[key]
    except (KeyError, IndexError, TypeError):
        pass
    return getattr(config, key, default)
