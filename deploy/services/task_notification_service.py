"""Task recovery and notification business logic."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from services.task_read_service import public_task_error


class TaskNotificationServiceError(RuntimeError):
    pass


class TaskFileForbidden(TaskNotificationServiceError):
    pass


def _row_to_dict(row: Any) -> Dict[str, Any]:
    return dict(row)


def _rows_to_dicts(rows: Any) -> list[Dict[str, Any]]:
    return [dict(row) for row in rows]


def _normalize_task_data(value: Any) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _is_notification_suppressed_task(row: Dict[str, Any]) -> bool:
    return _normalize_task_data(row.get("task_data")).get("suppress_notification") is True


def _sanitize_task_row_errors(row: Dict[str, Any], task_data: Optional[dict] = None) -> Dict[str, Any]:
    data = task_data if isinstance(task_data, dict) else _normalize_task_data(row.get("task_data"))
    task_type = row.get("task_type") or data.get("task_type") or data.get("requested_workflow_type")
    for key in ("error", "error_message"):
        if row.get(key):
            row[key] = public_task_error(task_type, data, row[key])
    return row


def _enrich_task_row_from_data(row: Dict[str, Any], *, include_empty_entity: bool = False) -> Dict[str, Any]:
    task_data = _normalize_task_data(row.pop("task_data", None) or {})
    context_keys = (
        "project_id",
        "source_page",
        "source_item_id",
        "display_name",
        "category",
        "provider",
        "model",
    )
    for key in context_keys:
        value = row.get(key) or task_data.get(key)
        if value:
            row[key] = value

    entity_keys = ("entity_type", "entity_id", "file_role", "episode_id")
    for key in entity_keys:
        value = task_data.get(key, "")
        if value or include_empty_entity:
            row[key] = value or ""

    return _sanitize_task_row_errors(row, task_data)


def _since_ms_to_naive_utc(since: Optional[int]) -> Optional[datetime]:
    if not since:
        return None
    return datetime.fromtimestamp(since / 1000, tz=timezone.utc).replace(tzinfo=None)


def _task_status_value(task: Any) -> str:
    status = getattr(task, "status", "")
    return getattr(status, "value", status) or ""


def _task_progress_value(task: Any, status: str) -> Optional[float]:
    if status == "completed":
        return 100
    value = getattr(task, "progress", None)
    if value is None or isinstance(value, bool):
        return None
    try:
        progress = min(100.0, max(0.0, float(value)))
    except (TypeError, ValueError):
        return None
    return progress if progress > 0 else None


async def _persist_terminal_task(task: Any, task_dao: Any) -> None:
    status = _task_status_value(task)
    if hasattr(task_dao, "reconcile_terminal_task"):
        await task_dao.reconcile_terminal_task(
            task_id=getattr(task, "task_id", ""),
            status=status,
            result_data=getattr(task, "result", None),
            error_message=getattr(task, "error", None),
            retries=getattr(task, "retries", None),
        )
        return

    if status == "completed":
        await task_dao.update_task_status(
            task_id=getattr(task, "task_id", ""),
            status="completed",
            result_data=getattr(task, "result", None),
        )
    elif status in {"failed", "timeout"}:
        await task_dao.update_task_status(
            task_id=getattr(task, "task_id", ""),
            status="failed",
            error_message=getattr(task, "error", None) or "Task already failed in Redis",
        )
    elif status == "cancelled":
        await task_dao.update_task_status(task_id=getattr(task, "task_id", ""), status="cancelled")


async def _reconcile_active_tasks_with_queue(
    tasks: list[Dict[str, Any]],
    *,
    task_queue: Any,
    task_dao: Any,
) -> list[Dict[str, Any]]:
    if task_queue is None:
        return tasks

    active_tasks: list[Dict[str, Any]] = []
    terminal_statuses = {"completed", "failed", "cancelled", "timeout"}

    for task_row in tasks:
        task_id = task_row.get("task_id")
        if not task_id:
            active_tasks.append(task_row)
            continue

        try:
            redis_task = await task_queue.get_task(task_id)
        except Exception:
            active_tasks.append(task_row)
            continue

        if not redis_task:
            active_tasks.append(task_row)
            continue

        queue_status = _task_status_value(redis_task)
        if queue_status in terminal_statuses:
            await _persist_terminal_task(redis_task, task_dao)
            continue

        merged_row = dict(task_row)
        from core.task_dispatch_guard import can_cancel_task

        merged_row["status"] = queue_status or merged_row.get("status")
        merged_row["can_cancel"] = can_cancel_task(redis_task)
        merged_row["progress"] = _task_progress_value(redis_task, queue_status)
        queue_data = _normalize_task_data(getattr(redis_task, "data", None))
        for key in (
            "project_id",
            "source_page",
            "source_item_id",
            "display_name",
            "category",
            "entity_type",
            "entity_id",
            "file_role",
            "episode_id",
            "provider",
            "model",
        ):
            if queue_data.get(key):
                merged_row[key] = queue_data[key]
        started_at = getattr(redis_task, "started_at", None)
        if started_at is not None:
            merged_row["started_at"] = started_at
        active_tasks.append(merged_row)

    return active_tasks


async def get_recent_tasks(
    *,
    user_id: str,
    hours: int,
    task_dao: Any,
) -> Dict[str, Any]:
    tasks = await task_dao.get_recent_completed_tasks(user_id, hours)
    return {"success": True, "tasks": [_sanitize_task_row_errors(row) for row in _rows_to_dicts(tasks)]}


async def get_task_files(
    *,
    task_id: str,
    user_id: str,
    task_dao: Any,
) -> Dict[str, Any]:
    task = await task_dao.get_task(task_id)
    if not task or task["user_id"] != user_id:
        raise TaskFileForbidden("Task files are not accessible")
    files = await task_dao.get_task_files(task_id)
    return {"success": True, "files": _rows_to_dicts(files)}


async def get_active_tasks(
    *,
    user_id: str,
    task_dao: Any,
    task_queue: Any = None,
) -> Dict[str, Any]:
    tasks = await task_dao.get_active_tasks_for_user(user_id, limit=50)
    active_rows = [
        _enrich_task_row_from_data(row)
        for row in _rows_to_dicts(tasks)
        if not _is_notification_suppressed_task(row)
    ]
    active_tasks = await _reconcile_active_tasks_with_queue(
        active_rows,
        task_queue=task_queue,
        task_dao=task_dao,
    )
    return {"success": True, "tasks": active_tasks}


async def get_task_notifications(
    *,
    user_id: str,
    since: Optional[int],
    task_dao: Any,
) -> Dict[str, Any]:
    since_dt = _since_ms_to_naive_utc(since)


    tasks = await task_dao.get_terminal_tasks_for_notifications(user_id, since_dt, limit=50)

    notifications = []
    for task in tasks:
        row = _enrich_task_row_from_data(_row_to_dict(task), include_empty_entity=True)
        notifications.append(row)

    return {"success": True, "notifications": notifications}


async def get_unread_notification_count(
    *,
    user_id: str,
    notification_dao: Any,
) -> Dict[str, Any]:
    count = await notification_dao.get_unread_count(user_id)
    return {"success": True, "count": count}


async def get_notifications(
    *,
    user_id: str,
    status: Optional[str],
    limit: int,
    offset: int,
    notification_dao: Any,
) -> Dict[str, Any]:
    if status == "unread":
        items = await notification_dao.get_unread(user_id, limit=limit)
    else:
        items = await notification_dao.get_history(user_id, limit=limit, offset=offset)
    rows = _rows_to_dicts(items)
    for row in rows:
        metadata = _normalize_task_data(row.get("metadata"))
        task_type = metadata.get("task_type") or row.get("task_type")
        if row.get("message"):
            row["message"] = public_task_error(task_type, metadata, row["message"])
    return {"success": True, "notifications": rows}


async def mark_notification_read(
    *,
    notification_id: str,
    user_id: str,
    notification_dao: Any,
) -> Dict[str, Any]:
    await notification_dao.mark_read(notification_id, user_id)
    return {"success": True}


async def mark_all_notifications_read(
    *,
    user_id: str,
    notification_dao: Any,
) -> Dict[str, Any]:
    count = await notification_dao.mark_all_read(user_id)
    return {"success": True, "count": count}


async def dismiss_notification(
    *,
    notification_id: str,
    user_id: str,
    notification_dao: Any,
) -> Dict[str, Any]:
    dismissed = await notification_dao.dismiss(notification_id, user_id)
    return {"success": True, "dismissed": bool(dismissed)}
