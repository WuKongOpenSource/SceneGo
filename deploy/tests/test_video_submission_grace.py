import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import fakeredis.aioredis
import pytest

from core import video_submission_grace as grace
from core import task_dispatch_guard as guard
from core.online_provider_task_model import OnlineProviderTask
from core.online_provider_queue import OnlineProviderQueue, TASK_PREFIX, PENDING_KEY


@pytest.mark.parametrize('kind', ['seedance_morph', 'seedance_multi', 'kling_i2v', 'happyhorse_r2v'])
def test_deadline_is_server_owned_and_ten_seconds(monkeypatch, kind):
    monkeypatch.setattr(grace.time, 'time', lambda: 1000)
    data = {'cancel_deadline': 1}
    grace.set_video_submission_grace(kind, data)
    assert data['cancel_deadline'] == 1010
    grace.set_video_submission_grace('i2i_fj', data)
    assert 'cancel_deadline' not in data


@pytest.mark.asyncio
async def test_refresh_worker_restart_and_atomic_submission_cancel_boundary(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(grace.time, 'time', lambda: clock[0])
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    queue = OnlineProviderQueue(redis)
    queue._persist_create = AsyncMock()
    tasks = []
    for name in ['cancelled', 'generate']:
        data = {}
        grace.set_video_submission_grace('seedance_morph', data)
        task = OnlineProviderTask(name, 'seedance_morph', data)
        assert await queue.enqueue(task)
        tasks.append(task)
    assert await redis.zcard(PENDING_KEY) == 0
    assert await redis.zcard(PENDING_KEY + ':deferred') == 2
    assert await queue.dequeue() is None
    clock[0] = 1009.99
    assert guard.can_cancel_task(await queue.get_task('cancelled'))
    assert not await guard.claim_for_preparation(redis, TASK_PREFIX + 'generate', 'processing', 'generate')
    assert await guard.cancel_before_submission(redis, TASK_PREFIX + 'cancelled', 'refund', 'cancelled')
    clock[0] = 1010.0
    # Recreate runtime from persisted Redis records, just like a release/reload.
    restarted = OnlineProviderQueue(redis)
    assert not guard.can_cancel_task(await restarted.get_task('generate'))
    assert grace.public_execution_status(await restarted.get_task('generate')) == 'processing'
    assert not await guard.cancel_before_submission(redis, TASK_PREFIX + 'generate', 'refund', 'generate')
    result = await restarted.dequeue()
    assert result.task_id == 'generate'
    assert await guard.begin_submission(redis, TASK_PREFIX + 'generate')
    assert not await guard.cancel_before_submission(redis, TASK_PREFIX + 'generate', 'refund', 'generate')
    assert await restarted.dequeue() is None
    assert await redis.hget(TASK_PREFIX + 'cancelled', 'status') == 'cancelled'
    assert await redis.zcard(PENDING_KEY + ':deferred') == 0
    await redis.aclose()


@pytest.mark.asyncio
async def test_concurrent_promotion_only_claims_once(monkeypatch):
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(grace.time, 'time', lambda: 1000)
    key = 'task:one'
    await redis.hset(key, mapping={'status': 'queued', 'data': json.dumps({'cancel_deadline': 999})})
    await grace.enqueue_with_grace(redis, 'pending', key, 'one', 10, 999)
    await asyncio.gather(*(grace.promote_ready(redis, 'pending', 'task:') for _ in range(4)))
    assert await redis.zcard('pending') == 1
    claimed = await asyncio.gather(*(guard.claim_for_preparation(redis, key, 'processing', 'one') for _ in range(4)))
    assert sum(claimed) == 1
    await redis.aclose()
