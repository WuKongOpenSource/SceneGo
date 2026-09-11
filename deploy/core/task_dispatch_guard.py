"""Atomic cancellation and dispatch boundaries shared by task runtimes."""
from __future__ import annotations

import json
import logging
import time
from core.video_submission_grace import cancel_deadline
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


def can_cancel_task(task: Any) -> bool:
    status = getattr(task, "status", "")
    status = getattr(status, "value", status)
    dispatch = getattr(task, "dispatch_state", "")
    if status == "cancelled":
        return getattr(task, "refund_status", "") == "pending"
    deadline = cancel_deadline(task)
    if deadline and time.time() >= deadline:
        return False
    if dispatch == "submitted" or getattr(task, "prompt_id", None):
        return False
    if status in {"pending", "queued"}:
        # Historical ownership markers still prevent a refund after handoff;
        # interpreting persisted state does not require implementing node claims.
        return not getattr(task, "node_id", None)
    return status == "processing" and dispatch == "preparing"


async def claim_for_preparation(redis: Any, key: str, processing_key: str, task_id: str) -> bool:
    script = """
    local status = redis.call('HGET', KEYS[1], 'status')
    if status ~= 'pending' and status ~= 'queued' then return 0 end
    local data = cjson.decode(redis.call('HGET', KEYS[1], 'data') or '{}')
    if tonumber(data.cancel_deadline or 0) > tonumber(ARGV[3]) then return 0 end
    redis.call('HSET', KEYS[1], 'status', 'processing', 'started_at', ARGV[2])
    if redis.call('HGET', KEYS[1], 'dispatch_state') ~= 'submitted' then
        redis.call('HSET', KEYS[1], 'dispatch_state', 'preparing')
    end
    redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
    return 1
    """
    return bool(await redis.eval(script, 2, key, processing_key, task_id,
                                 datetime.now().isoformat(), time.time()))


async def begin_submission(redis: Any, key: str) -> bool:
    script = """
    if redis.call('HGET', KEYS[1], 'status') ~= 'processing' then return 0 end
    local data = cjson.decode(redis.call('HGET', KEYS[1], 'data') or '{}')
    if tonumber(data.cancel_deadline or 0) > tonumber(ARGV[1]) then return 0 end
    redis.call('HSET', KEYS[1], 'dispatch_state', 'submitted')
    return 1
    """
    return bool(await redis.eval(script, 1, key, time.time()))


async def save_task_unless_cancelled(redis: Any, key: str, mapping: dict, ttl: int) -> None:
    script = """
    local fields = cjson.decode(ARGV[1])
    if redis.call('HGET', KEYS[1], 'status') == 'cancelled' then return 0 end
    for k, v in pairs(fields) do redis.call('HSET', KEYS[1], k, v) end
    redis.call('EXPIRE', KEYS[1], ARGV[2])
    return 1
    """
    await redis.eval(script, 1, key, json.dumps(mapping), ttl)


async def cancel_before_submission(redis: Any, key: str, refund_key: str, task_id: str) -> bool:
    script = """
    local status = redis.call('HGET', KEYS[1], 'status')
    if status == 'cancelled' then return 1 end
    local data = cjson.decode(redis.call('HGET', KEYS[1], 'data') or '{}')
    local deadline = tonumber(data.cancel_deadline or 0)
    if deadline > 0 and deadline <= tonumber(ARGV[3]) then return 0 end
    if redis.call('HGET', KEYS[1], 'dispatch_state') == 'submitted' then return 0 end
    local prompt = redis.call('HGET', KEYS[1], 'prompt_id')
    if prompt and prompt ~= '' then return 0 end
    if status == 'processing' then
        if redis.call('HGET', KEYS[1], 'dispatch_state') ~= 'preparing' then return 0 end
    elseif status == 'pending' or status == 'queued' then
        local node = redis.call('HGET', KEYS[1], 'node_id')
        if node and node ~= '' then return 0 end
    else return 0 end
    redis.call('HSET', KEYS[1], 'status', 'cancelled', 'completed_at', ARGV[2],
        'refund_status', 'pending')
    redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
    return 1
    """
    return bool(await redis.eval(script, 2, key, refund_key, task_id,
                                 datetime.now().isoformat(), time.time()))


async def finish_cancellation(queue: Any, task: Any, prefix: str) -> bool:
    """Retain the retry record until both SQL reconciliation and refund succeed."""
    from dao_task import TaskDAO
    from db_manager import get_db_manager
    from services.task_credit_billing_service import release_task_credits

    try:
        await queue._cleanup_cancelled_task(task)
        if get_db_manager():
            await TaskDAO.update_task_status(task.task_id, "cancelled")
        await release_task_credits(task_id=task.task_id, task_data=task.data,
                                   user_id=task.user_id, reason="task_cancelled")
        await queue.redis.hset(f"{prefix}{task.task_id}", mapping={"refund_status": "completed"})
        await queue.redis.zrem(f"{prefix}cancel_refunds", task.task_id)
        return True
    except Exception:
        logger.exception("Cancellation reconciliation pending for task %s", task.task_id)
        return False


async def retry_cancelled_refunds(queue: Any, prefix: str) -> None:
    now = time.monotonic()
    if now < getattr(queue, "_cancel_refund_retry_at", 0):
        return
    queue._cancel_refund_retry_at = now + 30
    for raw_id in await queue.redis.zrangebyscore(f"{prefix}cancel_refunds", "-inf", time.time(), start=0, num=20):
        task_id = raw_id.decode() if isinstance(raw_id, bytes) else str(raw_id)
        await queue.redis.zadd(f"{prefix}cancel_refunds", {task_id: time.time() + 30})
        task = await queue.get_task(task_id)
        if task and getattr(task.status, "value", task.status) == "cancelled":
            await finish_cancellation(queue, task, prefix)


async def cancellation_response(queue: Any, task_id: str) -> dict:
    task = await queue.get_task(task_id)
    pending = task is None or getattr(task, "refund_status", "pending") != "completed"
    return {
        "success": True,
        "status": "cancelled",
        "refund_status": "pending" if pending else "completed",
        "message": "任务已取消，积分退还处理中，系统将自动重试" if pending
                   else "任务已取消，已退还本次预扣积分",
    }
