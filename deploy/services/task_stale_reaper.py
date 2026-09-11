"""Reconcile stale SQL tasks with Redis state and frozen credits."""
from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable, Optional

from dao_task import TaskDAO
from services import credit_service

logger = logging.getLogger(__name__)

STALE_TASK_MESSAGE = "任务执行已中断，请重新生成；本次未扣创作点数"


async def reap_stale_tasks(
    hours: int,
    *,
    task_queue: Any,
    cleanup_ids_fn: Optional[Callable[[int], Awaitable[list[str]]]] = None,
    release_fn: Optional[Callable[..., Awaitable[Any]]] = None,
) -> int:
    """Fail stale tasks everywhere and idempotently release any reservation."""
    cleanup = cleanup_ids_fn or TaskDAO.cleanup_stale_ids
    release = release_fn or credit_service.release
    task_ids = await cleanup(hours)

    for task_id in task_ids:
        try:
            await task_queue.fail_task(task_id, STALE_TASK_MESSAGE, retry=False)
        except Exception as exc:
            logger.warning("Failed to reconcile stale Redis task %s: %s", task_id, exc)
        try:
            await release(
                task_id,
                operator="task_stale_reaper",
                reason="stale task exceeded timeout",
            )
        except Exception as exc:
            logger.error("Failed to release stale task credits %s: %s", task_id, exc)

    return len(task_ids)
