"""Durable, server-owned undo window for online video generation."""
import time

GRACE_SECONDS = 10


def set_video_submission_grace(task_type, data):
    # Never accept a client deadline (including an attempt to skip the window).
    data.pop("cancel_deadline", None)
    if str(task_type).startswith(("seedance_", "kling_", "vidu_", "happyhorse_", "wan26_", "minimax_i2v", "minimax_morph", "veo_", "sora_")):
        data["cancel_deadline"] = time.time() + GRACE_SECONDS


def cancel_deadline(task):
    try:
        return float((getattr(task, "data", None) or {}).get("cancel_deadline") or 0)
    except (TypeError, ValueError):
        return 0.0


def public_execution_status(task):
    status = getattr(task.status, "value", task.status)
    deadline = cancel_deadline(task)
    return "processing" if status in {"queued", "pending"} and deadline and time.time() >= deadline else status


async def enqueue_with_grace(redis, pending_key, state_key, task_id, priority_score, deadline):
    if not deadline:
        await redis.zadd(pending_key, {task_id: priority_score})
        return
    # State and deferred queue insertion share one atomic boundary. Cancellation
    # winning before enqueue cannot resurrect a paid generation.
    await redis.eval("""
    local status = redis.call('HGET', KEYS[1], 'status')
    if status ~= 'pending' and status ~= 'queued' then return 0 end
    redis.call('HSET', KEYS[1], 'deferred_priority', ARGV[2])
    redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
    return 1
    """, 2, state_key, pending_key + ':deferred', task_id, priority_score, deadline)


async def promote_ready(redis, pending_key, state_prefix):
    # Bound each pass and skip cancelled/missing records. Recreating the worker
    # after a release only resumes the same records; it never submits duplicates.
    await redis.eval("""
    local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 50)
    for _, id in ipairs(ids) do
        local key = ARGV[2] .. id
        local status = redis.call('HGET', key, 'status')
        if status == 'pending' or status == 'queued' then
            local priority = redis.call('HGET', key, 'deferred_priority')
            if priority then redis.call('ZADD', KEYS[2], priority, id) end
        end
        redis.call('ZREM', KEYS[1], id)
    end
    return #ids
    """, 2, pending_key + ':deferred', pending_key, time.time(), state_prefix)
