"""Redis queue containing only tasks executed by configured online providers.

This module is deliberately independent of local GPU nodes, workflow templates,
and local execution transport.  It is suitable for a source-only public runtime and is
also small enough to audit as an explicit trust boundary.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime
from typing import Any, Optional

from core.online_provider_task_model import OnlineProviderTask, OnlineTaskStatus
from core.online_provider_task_types import is_online_provider_task
from core.task_dispatch_guard import (
    begin_submission, cancel_before_submission, claim_for_preparation,
    finish_cancellation, retry_cancelled_refunds, save_task_unless_cancelled,
)
from services.sensitive_data_redaction import redact_sensitive_text

logger = logging.getLogger(__name__)

PENDING_KEY = "ovideo:online:pending"
PROCESSING_KEY = "ovideo:online:processing"
COMPLETED_KEY = "ovideo:online:completed"
FAILED_KEY = "ovideo:online:failed"
TASK_PREFIX = "ovideo:online:task:"
USER_TASK_PREFIX = "ovideo:online:user:"
TASK_EXPIRE_SECONDS = 180 * 24 * 60 * 60
USER_INDEX_EXPIRE_SECONDS = 30 * 24 * 60 * 60


def _env_int(name: str, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


def _task_event(task: OnlineProviderTask, event_type: str) -> dict[str, Any]:
    data = task.data or {}
    entity_id = data.get("entity_id") or ""
    return {
        "type": event_type,
        "task_id": task.task_id,
        "status": task.status.value,
        "task_type": task.task_type,
        "display_name": data.get("display_name") or "",
        "project_id": data.get("project_id") or "",
        "source_page": data.get("source_page") or "",
        "source_item_id": data.get("source_item_id") or entity_id,
        "entity_type": data.get("entity_type") or "",
        "entity_id": entity_id,
        "file_role": data.get("file_role") or "",
        "episode_id": data.get("episode_id") or "",
        "provider": data.get("provider") or "",
        "model": data.get("model") or "",
    }


class OnlineProviderQueue:
    """Persist and dispatch online-provider tasks without a local-node lane."""

    def __init__(self, redis_client: Any) -> None:
        self.redis = redis_client

    async def reserve_daily_quota(
        self, quota_key: str, task_id: str, seed_task_ids: Optional[list[str]],
        limit: int, ttl_seconds: int,
    ) -> bool:
        from core.daily_task_quota import reserve_daily_quota
        return await reserve_daily_quota(self.redis, quota_key, task_id, seed_task_ids, limit, ttl_seconds)

    async def release_daily_quota(self, quota_key: Optional[str], task_id: str) -> None:
        from core.daily_task_quota import release_daily_quota
        await release_daily_quota(self.redis, quota_key, task_id)

    async def enqueue(self, task: OnlineProviderTask) -> bool:
        if not is_online_provider_task(task.task_type):
            raise ValueError("Task type is not available in the online-provider queue")
        try:
            task.status = OnlineTaskStatus.QUEUED
            await self._save_task(task)
            now = int(time.time())
            if task.user_id:
                await self.redis.zadd(f"{USER_TASK_PREFIX}{task.user_id}", {task.task_id: now})
                await self.redis.expire(
                    f"{USER_TASK_PREFIX}{task.user_id}",
                    USER_INDEX_EXPIRE_SECONDS,
                )
            from core.video_submission_grace import enqueue_with_grace, cancel_deadline
            await enqueue_with_grace(self.redis, PENDING_KEY, f"{TASK_PREFIX}{task.task_id}",
                                     task.task_id, self._priority_score(task, now), cancel_deadline(task))
            await self._persist_create(task)
            return True
        except Exception as exc:
            logger.error("Online task enqueue failed: %s", redact_sensitive_text(exc), exc_info=True)
            return False

    @staticmethod
    def _priority_score(task: OnlineProviderTask, now: int) -> int:
        priority = min(9, max(0, int(task.priority)))
        return ((9 - priority) * 10**12) + now

    async def dequeue(self, timeout: int = 5, external_only: bool = True) -> Optional[OnlineProviderTask]:
        del timeout
        if not external_only:
            raise ValueError("OnlineProviderQueue only supports external_only=True")
        try:
            await retry_cancelled_refunds(self, TASK_PREFIX)
            from core.video_submission_grace import promote_ready
            await promote_ready(self.redis, PENDING_KEY, TASK_PREFIX)
            result = await self.redis.zpopmin(PENDING_KEY, count=1)
            if not result:
                return None
            raw_task_id = result[0][0] if isinstance(result[0], (tuple, list)) else result[0]
            task_id = raw_task_id.decode("utf-8") if isinstance(raw_task_id, bytes) else str(raw_task_id)
            task = await self.get_task(task_id)
            if not task:
                logger.warning("Online task %s has no state record", task_id)
                return None
            if not is_online_provider_task(task.task_type):
                await self.fail_task(task_id, "Task type is not allowed by the online-provider worker", retry=False)
                return None
            if not await claim_for_preparation(self.redis, f"{TASK_PREFIX}{task_id}", PROCESSING_KEY, task_id):
                return None
            task.status = OnlineTaskStatus.PROCESSING
            task.started_at = datetime.now().isoformat()
            return task
        except Exception as exc:
            logger.error("Online task dequeue failed: %s", redact_sensitive_text(exc), exc_info=True)
            return None

    async def complete_task(self, task_id: str, result: dict[str, Any]) -> bool:
        task = await self.get_task(task_id)
        if not task:
            return False
        if task.status == OnlineTaskStatus.CANCELLED:
            await self.redis.zrem(PROCESSING_KEY, task_id)
            return False
        try:
            from services.task_credit_billing_service import settle_task_credits

            await settle_task_credits(
                task_id=task_id,
                task_data=task.data,
                user_id=task.user_id,
            )
        except Exception as exc:
            logger.error("Online task credit settlement pending: %s", redact_sensitive_text(exc), exc_info=True)

        task.status = OnlineTaskStatus.COMPLETED
        task.completed_at = datetime.now().isoformat()
        task.progress = 100.0
        task.result = dict(result or {})
        await self._save_task(task)
        await self.redis.zrem(PROCESSING_KEY, task_id)
        await self.redis.zadd(COMPLETED_KEY, {task_id: int(time.time())})
        await self._persist_status(task, result_data=task.result)
        await self._publish(task, "task_complete")
        return True

    async def fail_task(self, task_id: str, error: str, retry: bool = True) -> bool:
        task = await self.get_task(task_id)
        if not task:
            return False
        if task.status == OnlineTaskStatus.CANCELLED:
            await self.redis.zrem(PROCESSING_KEY, task_id)
            return False

        safe_error = redact_sensitive_text(error, max_chars=500)
        task.error = safe_error
        task.retries += 1
        retry_limit = _env_int("ONLINE_PROVIDER_TASK_MAX_RETRIES", task.max_retries, 1)
        if retry and task.retries < retry_limit:
            task.status = OnlineTaskStatus.QUEUED
            await self._save_task(task)
            await self.redis.zrem(PROCESSING_KEY, task_id)
            delay = _env_int("ONLINE_PROVIDER_TASK_RETRY_DELAY_SECONDS", 10, 0)
            if delay:
                await asyncio.sleep(delay)
            await self.redis.zadd(PENDING_KEY, {task_id: self._priority_score(task, int(time.time()))})
            return True

        task.status = OnlineTaskStatus.FAILED
        task.completed_at = datetime.now().isoformat()
        await self._save_task(task)
        await self.redis.zrem(PENDING_KEY, task_id)
        await self.redis.zrem(PROCESSING_KEY, task_id)
        await self.redis.zadd(FAILED_KEY, {task_id: int(time.time())})
        try:
            from services.task_credit_billing_service import release_task_credits

            await release_task_credits(
                task_id=task_id,
                task_data=task.data,
                user_id=task.user_id,
                reason="task_failed",
            )
        except Exception as exc:
            logger.error("Online task credit release failed: %s", redact_sensitive_text(exc), exc_info=True)
        await self._persist_status(task, error_message=safe_error)
        await self._publish(task, "task_failed", error=safe_error)
        return True

    async def update_progress(self, task_id: str, progress: float, message: str = "") -> bool:
        task = await self.get_task(task_id)
        if not task:
            return False
        task.progress = min(100.0, max(0.0, float(progress)))
        if message:
            task.data["progress_message"] = redact_sensitive_text(message, max_chars=200)
        await self._save_task(task)
        await self.redis.publish(
            f"task_progress:{task_id}",
            json.dumps(
                {
                    "task_id": task_id,
                    "progress": task.progress,
                    "message": task.data.get("progress_message", ""),
                },
                ensure_ascii=False,
            ),
        )
        return True

    async def begin_submission(self, task_id: str) -> bool:
        return await begin_submission(self.redis, f"{TASK_PREFIX}{task_id}")

    async def cancel_task(self, task_id: str) -> bool:
        if not await cancel_before_submission(self.redis, f"{TASK_PREFIX}{task_id}", f"{TASK_PREFIX}cancel_refunds", task_id):
            return False
        task = await self.get_task(task_id)
        if not task:
            raise RuntimeError("Cancelled task state is unavailable")
        await finish_cancellation(self, task, TASK_PREFIX)
        return True

    async def _cleanup_cancelled_task(self, task: OnlineProviderTask) -> None:
        await self.redis.zrem(PENDING_KEY, task.task_id)
        await self.redis.zrem(PROCESSING_KEY, task.task_id)

    async def delete_task(self, task_id: str) -> bool:
        task = await self.get_task(task_id)
        if not task:
            return False
        if task.status in {OnlineTaskStatus.PENDING, OnlineTaskStatus.QUEUED, OnlineTaskStatus.PROCESSING} or getattr(task, "refund_status", "") == "pending":
            return False
        for key in (PENDING_KEY, PROCESSING_KEY, COMPLETED_KEY, FAILED_KEY):
            await self.redis.zrem(key, task_id)
        if task.user_id:
            await self.redis.zrem(f"{USER_TASK_PREFIX}{task.user_id}", task_id)
        await self.redis.delete(f"{TASK_PREFIX}{task_id}")
        return True

    async def get_task(self, task_id: str) -> Optional[OnlineProviderTask]:
        try:
            values = await self.redis.hgetall(f"{TASK_PREFIX}{task_id}")
            if not values:
                return None
            normalized = {
                (key.decode("utf-8") if isinstance(key, bytes) else str(key)): (
                    value.decode("utf-8") if isinstance(value, bytes) else value
                )
                for key, value in values.items()
            }
            return OnlineProviderTask.from_dict(normalized)
        except Exception as exc:
            logger.error("Online task read failed: %s", redact_sensitive_text(exc))
            return None

    async def get_user_tasks(
        self,
        user_id: str,
        *,
        limit: int = 100,
        status: Optional[str] = None,
    ) -> list[OnlineProviderTask]:
        raw_ids = await self.redis.zrange(
            f"{USER_TASK_PREFIX}{user_id}",
            0,
            max(0, int(limit) - 1),
            desc=True,
        )
        requested = str(status or "").strip().lower()
        tasks: list[OnlineProviderTask] = []
        for raw_id in raw_ids:
            task_id = raw_id.decode("utf-8") if isinstance(raw_id, bytes) else str(raw_id)
            task = await self.get_task(task_id)
            if task and (not requested or task.status.value == requested):
                tasks.append(task)
        return tasks

    async def get_external_queue_length(self) -> int:
        return int(await self.redis.zcard(PENDING_KEY))

    async def get_external_processing_count(self) -> int:
        return int(await self.redis.zcard(PROCESSING_KEY))

    async def _save_task(self, task: OnlineProviderTask) -> None:
        values = task.to_dict()
        values["data"] = json.dumps(values["data"] or {}, ensure_ascii=False)
        values["result"] = json.dumps(values["result"], ensure_ascii=False) if values["result"] else ""
        mapping = {
            key: "" if value is None else str(value)
            for key, value in values.items()
        }
        await save_task_unless_cancelled(self.redis, f"{TASK_PREFIX}{task.task_id}", mapping, TASK_EXPIRE_SECONDS)

    async def _persist_create(self, task: OnlineProviderTask) -> None:
        try:
            from dao_task import TaskDAO
            from db_manager import get_db_manager

            if get_db_manager():
                await TaskDAO.create_task(
                    task_id=task.task_id,
                    user_id=task.user_id or "system",
                    task_type=task.task_type,
                    task_data=task.data,
                    priority=task.priority,
                )
        except Exception as exc:
            logger.warning("Online task database create failed: %s", redact_sensitive_text(exc))

    async def _persist_status(self, task: OnlineProviderTask, **fields: Any) -> None:
        try:
            from dao_task import TaskDAO
            from db_manager import get_db_manager

            if get_db_manager():
                await TaskDAO.update_task_status(
                    task_id=task.task_id,
                    status=task.status.value,
                    **fields,
                )
        except Exception as exc:
            logger.warning("Online task database update failed: %s", redact_sensitive_text(exc))

    async def _publish(self, task: OnlineProviderTask, event_type: str, **extra: Any) -> None:
        if not task.user_id:
            return
        payload = {**_task_event(task, event_type), **extra}
        await self.redis.publish(
            f"{event_type}:{task.user_id}",
            json.dumps(payload, ensure_ascii=False),
        )
