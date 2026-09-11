"""OpenAI-compatible image response helpers for AI proxy providers."""
from __future__ import annotations

from typing import Any, Dict, List


def parse_openai_image_response(result: Dict[str, Any]) -> List[str]:
    images: List[str] = []
    for item in result.get("data", []) or []:
        if item.get("b64_json"):
            images.append(f"data:image/png;base64,{item['b64_json']}")
        elif item.get("url"):
            images.append(item["url"])
    return images
