"""Shared JSON helpers."""
from __future__ import annotations

import json
from typing import Any


def parse_jsonb_field(value: Any) -> Any:
    """Parse a DB JSON/JSONB value while preserving legacy fallback behavior."""
    if value is None:
        return {}
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return {}
    return value
