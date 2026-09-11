"""Validation helpers for executable ComfyUI workflow templates."""
from __future__ import annotations

import json
from typing import Any


INVALID_WORKFLOW_MARKER = "\u8bf7\u66ff\u6362\u4e3a\u5b9e\u9645\u5de5\u4f5c\u6d41"
PLACEHOLDER_NODE_TYPES = {"placeholdernode", "placeholder_node"}


def decode_workflow_json(value: Any) -> Any:
    """Decode a JSON string while leaving already-decoded values unchanged."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return None
    return value


def workflow_invalid_reason(value: Any) -> str | None:
    """Return why a value is not an executable ComfyUI node graph."""
    workflow_json = decode_workflow_json(value)
    if not isinstance(workflow_json, dict):
        return "workflow JSON root must be an object"
    if not workflow_json:
        return "workflow JSON is empty"

    serialized = json.dumps(workflow_json, ensure_ascii=False)
    if INVALID_WORKFLOW_MARKER in serialized:
        return f"workflow contains invalid marker: {INVALID_WORKFLOW_MARKER}"

    node_types = [
        str(node.get("class_type", "")).strip()
        for node in workflow_json.values()
        if isinstance(node, dict) and node.get("class_type")
    ]
    if any(node_type.lower() in PLACEHOLDER_NODE_TYPES for node_type in node_types):
        return "workflow contains PlaceholderNode"
    if not node_types:
        return "workflow contains no executable nodes"
    return None


def workflow_executable_node_count(value: Any) -> int:
    """Count executable nodes, returning zero for any invalid workflow."""
    workflow_json = decode_workflow_json(value)
    if workflow_invalid_reason(workflow_json) is not None:
        return 0
    return sum(
        1
        for node in workflow_json.values()
        if isinstance(node, dict) and node.get("class_type")
    )


def workflow_is_executable(value: Any) -> bool:
    return workflow_invalid_reason(value) is None
