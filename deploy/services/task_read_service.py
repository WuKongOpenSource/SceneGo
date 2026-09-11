"""Read-side helpers for task routes.

Routers should not know whether task state came from Redis or PostgreSQL. This
module keeps DB availability checks, DAO fallbacks, and response normalization
in one place while preserving the existing route response shape.
"""
from __future__ import annotations

import json
from typing import Any, Optional
from core.task_dispatch_guard import can_cancel_task
from core.video_submission_grace import cancel_deadline, public_execution_status


_TERMINAL_STATUSES = {"completed", "failed", "cancelled", "timeout"}

_LOCAL_WORKFLOW_LABELS = {
    "i2i_fj": "角度调整",
    "angle-adjust": "角度调整",
    "i2i_human": "多角度人物生成",
    "human-multi-angle": "多角度人物生成",
    "i2i_around": "全景角度生成",
    "around-angle": "全景角度生成",
    "image_upscale": "图片放大",
    "upscale_hd": "图片放大",
    "remove_watermark": "水印处理",
    "three_view": "三视图生成",
}

_INTERNAL_ERROR_MARKERS = (
    "traceback", "execution_error", "execution_cached", "prompt_id",
    "node_type", "ksampler", "get_output_data", "execution.py",
    "has_pending_tasks", "file \\\"", "file '\\", " line ",
)


def public_task_error(task_type: Any, task_data: Any, error: Any) -> Optional[str]:
    message = str(error or "").strip()
    if not message:
        return None
    data = _jsonish(task_data, {})
    requested_type = str(data.get("requested_workflow_type") or "") if isinstance(data, dict) else ""
    registry_kind = str(data.get("registry_kind") or data.get("source_kind") or "") if isinstance(data, dict) else ""
    candidates = [str(task_type or "").lower(), requested_type.lower(), registry_kind.lower()]
    workflow_key = next((item for item in candidates if item in _LOCAL_WORKFLOW_LABELS), "")

    normalized = message.lower()
    if not workflow_key and not any(marker in normalized for marker in _INTERNAL_ERROR_MARKERS):
        return message

    label = _LOCAL_WORKFLOW_LABELS.get(workflow_key, "图片处理")
    if any(marker in normalized for marker in ("missing_node_type", "int constant", "http 400")):
        return f"处理节点缺少{label}所需组件，本次未生成结果。"
    if any(marker in normalized for marker in ("upgrade_required", "版本不匹配", "完整的图片放大能力")):
        return f"处理节点版本不支持当前{label}规格，本次未生成结果。"
    if any(marker in normalized for marker in ("offline", "unreachable", "离线", "不可达")):
        return f"{label}处理节点离线或不可达，本次未生成结果。"
    if any(marker in normalized for marker in ("timeout", "timed out", "超时")):
        return f"{label}等待超时，本次未生成结果。请稍后重试。"
    return f"{label}失败，本次未生成结果。请稍后重试；若持续失败，请联系管理员并提供任务编号。"


def _db_refund_status(task: dict[str, Any]) -> Optional[str]:
    freeze_status = str(task.get("credit_freeze_status") or "").lower()
    if freeze_status == "frozen":
        return "pending"
    if freeze_status == "released":
        return "completed"
    return None


def _jsonish(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return default
    return value


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    isoformat = getattr(value, "isoformat", None)
    if callable(isoformat):
        return isoformat()
    return str(value)


def _coerce_progress(value: Any, *, status: str) -> Optional[float]:
    if status == "completed":
        return 100
    if value is None or isinstance(value, bool):
        return None
    try:
        progress = float(value)
    except (TypeError, ValueError):
        return None
    progress = min(100.0, max(0.0, progress))
    if progress <= 0 and status not in _TERMINAL_STATUSES:
        return None
    return progress


def _db_progress(task: dict[str, Any]) -> Optional[float]:
    status = str(task.get("status") or "unknown")
    metadata = _jsonish(task.get("metadata"), {})
    task_data = _jsonish(task.get("task_data"), {})
    candidates = (
        task.get("progress"),
        metadata.get("progress") if isinstance(metadata, dict) else None,
        task_data.get("progress") if isinstance(task_data, dict) else None,
    )
    for candidate in candidates:
        progress = _coerce_progress(candidate, status=status)
        if progress is not None:
            return progress
    return _coerce_progress(None, status=status)


def _queue_progress(task: Any) -> Optional[float]:
    status_value = getattr(task, "status", "")
    status = str(getattr(status_value, "value", status_value) or "unknown")
    return _coerce_progress(getattr(task, "progress", None), status=status)


def _requested_statuses(status: Optional[str]) -> set[str]:
    if not status:
        return set()
    aliases = {
        "running": {"running", "processing"},
        "processing": {"running", "processing"},
        "pending": {"pending", "queued"},
        "queued": {"pending", "queued"},
    }
    requested: set[str] = set()
    for item in str(status).split(","):
        normalized = item.strip().lower()
        if normalized:
            requested.update(aliases.get(normalized, {normalized}))
    return requested


def format_queue_task_status(task: Any) -> dict[str, Any]:
    return {
        "task_id": task.task_id,
        # Keep the actual execution route and submitted model available while
        # polling.  Video result labels must be derived from the task that
        # produced the file, never from the card's mutable current selection.
        "task_type": task.task_type,
        "data": task.data,
        "status": public_execution_status(task),
        **({"cancel_deadline": cancel_deadline(task)} if cancel_deadline(task) else {}),
        "can_cancel": can_cancel_task(task),
        "refund_status": getattr(task, "refund_status", "") or None,
        "progress": _queue_progress(task),
        "node_id": task.node_id,
        "result": task.result,
        "error": public_task_error(task.task_type, task.data, task.error),
        "created_at": task.created_at,
        "started_at": task.started_at,
        "completed_at": task.completed_at,
    }


def format_db_task_status(task: dict[str, Any]) -> dict[str, Any]:
    result_data = _jsonish(task.get("result_data"), task.get("result_data"))
    task_data = _jsonish(task.get("task_data"), {})
    return {
        "task_id": task["task_id"],
        "task_type": task.get("task_type"),
        "data": task_data,
        "status": task["status"],
        "can_cancel": False,
        "refund_status": _db_refund_status(task),
        "progress": _db_progress(task),
        "node_id": task.get("node_id"),
        "result": result_data,
        "error": public_task_error(task.get("task_type"), task_data, task.get("error_message")),
        "created_at": str(task["created_at"]) if task.get("created_at") else None,
        "started_at": str(task["started_at"]) if task.get("started_at") else None,
        "completed_at": str(task["completed_at"]) if task.get("completed_at") else None,
        "source": "database",
    }


def format_db_task_summary(task: dict[str, Any]) -> dict[str, Any]:
    task_data = _jsonish(task.get("task_data"), {})
    return {
        "task_id": task.get("task_id"),
        "task_type": task.get("task_type"),
        "status": task.get("status", "unknown"),
        "refund_status": _db_refund_status(task),
        "progress": _db_progress(task),
        "result": _jsonish(task.get("result_data"), {}),
        "error": public_task_error(task.get("task_type"), task_data, task.get("error_message")),
        "created_at": _iso(task.get("created_at")),
        "completed_at": _iso(task.get("completed_at")),
        "data": task_data,
    }


def format_queue_task_summary(task: Any) -> dict[str, Any]:
    return {
        "task_id": task.task_id,
        "task_type": task.task_type,
        "status": public_execution_status(task),
        **({"cancel_deadline": cancel_deadline(task)} if cancel_deadline(task) else {}),
        "can_cancel": can_cancel_task(task),
        "progress": _queue_progress(task),
        "result": task.result,
        "error": public_task_error(task.task_type, task.data, task.error),
        "created_at": task.created_at,
        "completed_at": task.completed_at,
        "data": task.data,
    }


async def get_task_status_response(
    *,
    task_id: str,
    task_queue: Any,
    task_dao: Any,
    logger: Any,
    username: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    task = await task_queue.get_task(task_id)
    if task:
        if username is not None and str(getattr(task, "user_id", "") or "") != str(username):
            return None
        return format_queue_task_status(task)

    try:
        db_task = await task_dao.get_task_by_task_id(task_id)
        if db_task and username is not None and str(db_task.get("user_id") or "") != str(username):
            return None
        return format_db_task_status(db_task) if db_task else None
    except Exception as exc:
        logger.warning("Database fallback task lookup failed: %s", exc)
        return None


async def get_db_task_for_delete(
    *,
    task_id: str,
    task_dao: Any,
    logger: Any,
) -> Optional[dict[str, Any]]:
    try:
        db_task = await task_dao.get_task(task_id)
        if db_task:
            logger.info("Loaded task from database: %s", task_id)
        return db_task
    except Exception as exc:
        logger.warning("Database task lookup failed: %s", exc)
        return None


async def soft_delete_user_file_by_path_fragment(
    *,
    username: str,
    file_path: str,
    file_dao: Any,
    logger: Any,
) -> int:
    try:
        return int(await file_dao.soft_delete_user_files_by_path_fragment(username, file_path) or 0)
    except Exception as exc:
        logger.warning("Database file soft-delete failed: %s", exc)
        return 0


async def delete_db_task(
    *,
    task_id: str,
    username: str,
    task_dao: Any,
    logger: Any,
) -> Optional[bool]:
    try:
        logger.info("Deleting task %s for user %s", task_id, username)
        result = await task_dao.delete_task(task_id, username)
        if result is None:
            logger.warning("Database unavailable; skipped task deletion")
            return None
        deleted = bool(result)
        logger.info("Task database deletion result: %s", deleted)
        return deleted
    except Exception as exc:
        logger.error("Database task deletion failed: %s", exc, exc_info=True)
        return False


async def list_user_tasks_response(
    *,
    username: str,
    limit: int,
    status: Optional[str],
    task_queue: Any,
    task_dao: Any,
    logger: Any,
) -> dict[str, Any]:
    db_task_list: list[dict[str, Any]] = []
    try:
        db_tasks = await task_dao.get_user_tasks(username, limit=limit)
        if db_tasks is not None:
            db_task_list = [format_db_task_summary(task) for task in db_tasks]
            logger.info("Loaded %s tasks from database", len(db_task_list))
    except Exception as exc:
        logger.warning("Database task load failed; using queue state: %s", exc)

    queue_task_list: list[dict[str, Any]] = []
    try:
        queue_tasks = await task_queue.get_user_tasks(username, limit=limit, status=None)
        queue_task_list = [format_queue_task_summary(task) for task in queue_tasks]
        logger.info("Loaded %s tasks from queue", len(queue_task_list))
    except Exception as exc:
        logger.warning("Queue task load failed; using database state: %s", exc)

    db_by_id = {str(task.get("task_id")): task for task in db_task_list if task.get("task_id")}
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()

    # Redis is authoritative while the live task record exists. PostgreSQL is
    # the durable history source after that Redis record expires.
    for queue_task in queue_task_list:
        task_id = str(queue_task.get("task_id") or "")
        db_task = db_by_id.get(task_id, {})
        combined = {**db_task, **queue_task}
        if isinstance(db_task.get("data"), dict) and isinstance(queue_task.get("data"), dict):
            combined["data"] = {**db_task["data"], **queue_task["data"]}
        merged.append(combined)
        if task_id:
            seen.add(task_id)

    merged.extend(
        task for task in db_task_list
        if str(task.get("task_id") or "") not in seen
    )

    requested = _requested_statuses(status)
    if requested:
        merged = [task for task in merged if str(task.get("status") or "").lower() in requested]

    return {"success": True, "tasks": merged[:limit]}
