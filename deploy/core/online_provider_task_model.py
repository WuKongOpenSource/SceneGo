"""Serializable task state used by the source-edition online provider queue."""
from __future__ import annotations

import json
from datetime import datetime
from enum import Enum
from typing import Any, Optional


class OnlineTaskStatus(str, Enum):
    PENDING = "pending"
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"


class OnlineProviderTask:
    """Minimal task record with no local-node or workflow state."""

    def __init__(
        self,
        task_id: str,
        task_type: str,
        data: dict[str, Any],
        *,
        priority: int = 2,
        user_id: Optional[str] = None,
    ) -> None:
        self.task_id = str(task_id)
        self.task_type = str(task_type)
        self.data = dict(data or {})
        self.priority = int(priority)
        self.user_id = str(user_id) if user_id is not None else None
        self.status = OnlineTaskStatus.PENDING
        self.node_id = None
        self.prompt_id = None
        self.created_at = datetime.now().isoformat()
        self.started_at: Optional[str] = None
        self.completed_at: Optional[str] = None
        self.result: Optional[dict[str, Any]] = None
        self.error: Optional[str] = None
        self.progress = 0.0
        self.retries = 0
        self.max_retries = 3

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "task_type": self.task_type,
            "data": self.data,
            "priority": self.priority,
            "user_id": self.user_id,
            "status": self.status.value,
            "node_id": self.node_id,
            "prompt_id": self.prompt_id,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "result": self.result,
            "error": self.error,
            "progress": self.progress,
            "retries": self.retries,
            "max_retries": self.max_retries,
        }

    @classmethod
    def from_dict(cls, values: dict[str, Any]) -> "OnlineProviderTask":
        data = _json_mapping(values.get("data"))
        task = cls(
            values["task_id"],
            values["task_type"],
            data,
            priority=_integer(values.get("priority"), 2),
            user_id=values.get("user_id") or None,
        )
        try:
            task.status = OnlineTaskStatus(str(values.get("status") or OnlineTaskStatus.PENDING.value))
        except ValueError:
            task.status = OnlineTaskStatus.PENDING
        task.created_at = str(values.get("created_at") or task.created_at)
        task.started_at = values.get("started_at") or None
        task.dispatch_state = values.get("dispatch_state") or ""
        task.refund_status = values.get("refund_status") or ""
        task.completed_at = values.get("completed_at") or None
        task.result = _json_mapping(values.get("result"), allow_none=True)
        task.error = values.get("error") or None
        task.progress = _floating(values.get("progress"), 0.0)
        task.retries = _integer(values.get("retries"), 0)
        task.max_retries = max(1, _integer(values.get("max_retries"), 3))
        return task


def _json_mapping(value: Any, *, allow_none: bool = False) -> Optional[dict[str, Any]]:
    if value in (None, ""):
        return None if allow_none else {}
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return None if allow_none else {}
    return parsed if isinstance(parsed, dict) else (None if allow_none else {})


def _integer(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _floating(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default
