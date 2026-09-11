"""Atomic online submission quotas, independent of task execution transport."""
from __future__ import annotations

from typing import Any


async def reserve_daily_quota(
    redis: Any, quota_key: str, task_id: str, seed_task_ids: list[str] | None,
    limit: int, ttl_seconds: int,
) -> bool:
    """Seed persisted IDs and reserve once; concurrent requests share one set."""
    script = """
        local key = KEYS[1]
        local current_id = ARGV[1]
        local max_count = tonumber(ARGV[2])
        local ttl = tonumber(ARGV[3])
        for i = 4, #ARGV do redis.call('SADD', key, ARGV[i]) end
        if redis.call('SISMEMBER', key, current_id) == 1 then
            redis.call('EXPIRE', key, ttl)
            return 1
        end
        if redis.call('SCARD', key) >= max_count then
            redis.call('EXPIRE', key, ttl)
            return 0
        end
        redis.call('SADD', key, current_id)
        redis.call('EXPIRE', key, ttl)
        return 1
        """
    seeds = [str(value) for value in (seed_task_ids or []) if value]
    result = await redis.eval(
        script, 1, quota_key, task_id, max(1, int(limit)), max(60, int(ttl_seconds)), *seeds,
    )
    return bool(int(result or 0))


async def release_daily_quota(redis: Any, quota_key: str | None, task_id: str) -> None:
    """Release only this submission ID when it failed before enqueue."""
    if quota_key:
        await redis.srem(quota_key, task_id)
