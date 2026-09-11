"""Coarse public readiness and protected source-edition health details."""
from __future__ import annotations

from typing import Any, Callable, Iterable, Optional

from fastapi import APIRouter, Depends

from services.api_provider_health_monitor import (
    list_cached_provider_health,
    provider_health_monitor_state,
    summarize_provider_health_results,
)
from services.runtime_health_service import collect_database_health, online_queue_health_status


async def _database_health(database_manager: Any) -> tuple[dict[str, Any], Optional[dict[str, Any]]]:
    if database_manager is None:
        return {"status": "unavailable", "migrations": {"status": "unknown"}}, None
    snapshot = await collect_database_health(database_manager)
    if snapshot["status"] != "healthy":
        return {"status": "unhealthy", "migrations": {"status": "unknown"}}, None
    # Keep the public response shape and suppress database exception text,
    # internal task channels, and full migration metadata even in admin output.
    migrations = snapshot["migrations"]
    return {
        "status": "healthy",
        "migrations": {"status": migrations["status"], "applied_count": migrations["applied_count"]},
    }, snapshot["api_tasks"]


async def _redis_health(redis_client: Any) -> str:
    if redis_client is None:
        return "unavailable"
    try:
        return "healthy" if await redis_client.ping() else "unhealthy"
    except Exception:
        return "unhealthy"


async def _queue_health(queue: Any, snapshot: Optional[dict[str, Any]]) -> dict[str, Any]:
    if queue is None:
        return {"status": "unavailable", "pending": None, "processing": None}
    try:
        pending = int(await queue.get_external_queue_length())
        processing = int(await queue.get_external_processing_count())
        return {"status": online_queue_health_status(pending, processing, snapshot),
                "pending": pending, "processing": processing}
    except Exception:
        return {"status": "unhealthy", "pending": None, "processing": None}


def _worker_health(workers: Iterable[Any]) -> dict[str, Any]:
    worker_list = list(workers or [])
    active = sum(1 for worker in worker_list if getattr(worker, "current_task", None))
    return {
        "status": "healthy" if worker_list else "unavailable",
        "total": len(worker_list),
        "active": active,
    }


async def _provider_health(redis_client: Any) -> dict[str, Any]:
    try:
        rows = await list_cached_provider_health(redis_client=redis_client)
        summary = summarize_provider_health_results(rows)
        unavailable = summary["error"] + summary["no_key"] + summary["blocked_region"]
        if unavailable:
            status = "degraded"
        elif rows:
            status = "healthy"
        else:
            status = "unknown"
        return {
            "status": status,
            "summary": summary,
            "monitor": provider_health_monitor_state(),
        }
    except Exception:
        return {
            "status": "unavailable",
            "summary": summarize_provider_health_results([]),
            "monitor": provider_health_monitor_state(),
        }


def create_public_health_router(
    *,
    require_admin_dependency: Callable[..., Any],
    get_database_manager: Callable[[], Any],
    get_redis_client: Callable[[], Any],
    get_online_queue: Callable[[], Optional[Any]],
    get_online_workers: Callable[[], Iterable[Any]],
) -> APIRouter:
    """Build health routes without importing private runtime modules."""
    router = APIRouter(tags=["health"])

    async def _collect() -> dict[str, Any]:
        database, online_tasks = await _database_health(get_database_manager())
        redis_client = get_redis_client()
        redis_status = await _redis_health(redis_client)
        queue = await _queue_health(get_online_queue(), online_tasks)
        workers = _worker_health(get_online_workers())
        providers = await _provider_health(redis_client)
        status = "healthy"
        if (
            database["status"] != "healthy"
            or redis_status != "healthy"
            or queue["status"] != "healthy"
            or workers["status"] != "healthy"
            or providers["status"] in {"degraded", "unavailable"}
        ):
            status = "degraded"
        return {
            "status": status,
            "database": database,
            "redis": {"status": redis_status},
            "online_queue": queue,
            "online_workers": workers,
            "online_providers": providers,
        }

    @router.get("/health")
    async def coarse_health() -> dict[str, str]:
        details = await _collect()
        return {"status": details["status"]}

    @router.get("/api/admin/system/health")
    async def detailed_health(_admin: str = Depends(require_admin_dependency)) -> dict[str, Any]:
        return await _collect()

    return router
