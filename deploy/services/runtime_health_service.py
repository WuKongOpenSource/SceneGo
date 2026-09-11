"""Runtime database, migration, and release metadata health helpers."""
from __future__ import annotations

import json
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional

from dao.admin.runtime_health import RuntimeHealthDAO
from dao.admin.api_config import ApiConfigDAO
from core.online_provider_task_types import is_online_provider_task


def _json_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _age_seconds(value: Any) -> Optional[int]:
    if value is None:
        return None
    parsed = value
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(parsed, datetime):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return max(0, int((datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).total_seconds()))


def _task_channel_snapshot(rows: list[dict[str, Any]], *, external: bool) -> dict[str, Any]:
    pending_count = 0
    processing_count = 0
    pending_times: list[Any] = []
    processing_times: list[Any] = []
    for row in rows:
        task_type = str(row.get("task_type") or "")
        # Report the complementary channel without importing its execution policy.
        if is_online_provider_task(task_type) != external:
            continue
        status = str(row.get("status") or "").lower()
        count = int(row.get("task_count") or 0)
        if status in {"pending", "queued"}:
            pending_count += count
            if row.get("oldest_created_at") is not None:
                pending_times.append(row["oldest_created_at"])
        elif status == "processing":
            processing_count += count
            if row.get("oldest_started_at") is not None:
                processing_times.append(row["oldest_started_at"])
    oldest_pending_at = min(pending_times) if pending_times else None
    oldest_processing_at = min(processing_times) if processing_times else None
    return {
        "pending_count": pending_count,
        "processing_count": processing_count,
        "oldest_pending_at": _json_value(oldest_pending_at),
        "oldest_pending_age_seconds": _age_seconds(oldest_pending_at),
        "oldest_processing_at": _json_value(oldest_processing_at),
        "oldest_processing_age_seconds": _age_seconds(oldest_processing_at),
    }


def online_queue_health_status(
    pending: Optional[int], processing: Optional[int], snapshot: Optional[dict[str, Any]],
) -> str:
    """Diagnose online task liveness without reconciling or resubmitting work.

    SQL and Redis are separate observations. A queued database row can already
    be processing in Redis during handoff, so that overlap is not a lost task.
    A degraded probe is diagnostic only and never authorizes billing or retries.
    """
    if pending is None or processing is None or snapshot is None:
        return "unavailable"
    if pending < 0 or processing < 0:
        return "unhealthy"

    def threshold(name: str, default: int) -> int:
        try:
            return max(1, int(os.getenv(name, str(default))))
        except (TypeError, ValueError):
            return default

    pending_age = snapshot.get("oldest_pending_age_seconds")
    processing_age = snapshot.get("oldest_processing_age_seconds")
    if pending and pending_age is not None and pending_age > threshold("HEALTH_QUEUE_MAX_AGE_SECONDS", 3600):
        return "stalled"
    if processing_age is not None and processing_age > threshold("HEALTH_PROCESSING_MAX_AGE_SECONDS", 7200):
        return "stalled"
    database_active = int(snapshot.get("pending_count") or 0) + int(snapshot.get("processing_count") or 0)
    if not pending and not processing and database_active:
        return "inconsistent"
    return "healthy"


def release_metadata_path() -> Path:
    configured = str(os.getenv("RELEASE_METADATA_PATH") or "").strip()
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[1] / "release_metadata.json"


def read_release_metadata(path: Optional[Path] = None) -> dict[str, Any]:
    metadata_path = path or release_metadata_path()
    fallback = {
        "git_sha": str(os.getenv("GIT_SHA") or "").strip() or None,
        "backend_source_sha256": str(os.getenv("BACKEND_SOURCE_SHA256") or "").strip() or None,
        "frontend_source_sha256": str(os.getenv("FRONTEND_SOURCE_SHA256") or "").strip() or None,
        "released_at": str(os.getenv("RELEASED_AT") or "").strip() or None,
    }
    if not metadata_path.is_file():
        return {
            "status": "missing",
            "path": str(metadata_path),
            **fallback,
        }

    try:
        parsed = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return {
            "status": "invalid",
            "path": str(metadata_path),
            "error": type(exc).__name__,
            **fallback,
        }
    if not isinstance(parsed, dict):
        return {
            "status": "invalid",
            "path": str(metadata_path),
            "error": "metadata must be a JSON object",
            **fallback,
        }
    return {
        "status": "available",
        "path": str(metadata_path),
        **parsed,
    }


async def collect_database_health(db_manager: Optional[object]) -> dict[str, Any]:
    if db_manager is None:
        return {
            "status": "unhealthy",
            "error": "database manager is unavailable",
            "migrations": {"status": "unknown", "applied_count": None},
        }

    try:
        snapshot = await RuntimeHealthDAO.get_database_snapshot(db_manager)
        ping = snapshot["ping"]
        if ping != 1:
            raise RuntimeError(f"unexpected database ping result: {ping!r}")
        if not snapshot["ledger_exists"]:
            migrations = {"status": "uninitialized", "applied_count": 0}
        else:
            latest = dict(snapshot["latest"] or {})
            if not latest:
                migrations = {"status": "ready", "applied_count": 0, "latest": None}
            else:
                applied_count = int(latest.pop("applied_count") or 0)
                migrations = {
                    "status": "ready",
                    "applied_count": applied_count,
                    "latest": {key: _json_value(value) for key, value in latest.items()},
                }
        task_rows = [dict(row) for row in (snapshot.get("task_queue_rows") or [])]
        task_queue = _task_channel_snapshot(task_rows, external=False)
        api_tasks = _task_channel_snapshot(task_rows, external=True)
        return {
            "status": "healthy",
            "migrations": migrations,
            "task_queue": task_queue,
            "api_tasks": api_tasks,
        }
    except Exception as exc:
        return {
            "status": "unhealthy",
            "error": f"{type(exc).__name__}: {exc}",
            "migrations": {"status": "unknown", "applied_count": None},
        }


def critical_provider_ids(configured_providers: Optional[list[str]] = None) -> list[str]:
    raw = os.getenv("HEALTH_CRITICAL_PROVIDERS")
    source = raw.split(",") if raw and raw.strip() else (configured_providers or [])
    return list(dict.fromkeys(item.strip().lower() for item in source if item.strip()))


async def collect_provider_health() -> dict[str, Any]:
    from services.api_provider_health_monitor import (
        list_cached_provider_health,
        provider_health_monitor_state,
        summarize_provider_health_results,
    )

    try:
        configured = [
            str(row.get("provider") or "")
            for row in await ApiConfigDAO.list_enabled()
            if str(row.get("api_key_encrypted") or "").strip()
        ]
        providers = critical_provider_ids(configured)
        if not providers:
            return {
                "status": "unknown",
                "critical_providers": [],
                "summary": summarize_provider_health_results([]),
                "channels": [],
                "monitor": provider_health_monitor_state(),
            }
        rows = await list_cached_provider_health(providers)
        summary = summarize_provider_health_results(rows)
        unhealthy_count = (
            summary["error"] + summary["no_key"] + summary["blocked_region"]
        )
        if unhealthy_count:
            status = "unhealthy"
        elif rows:
            status = "healthy"
        else:
            status = "unknown"
        channels = [
            {
                "provider": row.get("provider"),
                "model_name": row.get("model_name"),
                "status": row.get("status") or "unknown",
                "checked_at": row.get("checked_at") or row.get("cached_at"),
            }
            for row in rows
        ]
        return {
            "status": status,
            "critical_providers": providers,
            "summary": summary,
            "channels": channels,
            "monitor": provider_health_monitor_state(),
        }
    except Exception as exc:
        return {
            "status": "unavailable",
            "critical_providers": critical_provider_ids(),
            "error": f"{type(exc).__name__}: {exc}",
        }
