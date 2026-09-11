"""Execute the shared atomic quota script through each queue's public methods."""
import asyncio

import pytest
from fakeredis.aioredis import FakeRedis


class DailyQuotaContract:
    @pytest.fixture
    async def quota(self):
        redis = FakeRedis(decode_responses=True)
        try:
            yield self.queue_type(redis), redis
        finally:
            await redis.aclose()

    @pytest.mark.asyncio
    async def test_concurrent_reservations_never_exceed_three(self, quota):
        queue, redis = quota
        results = await asyncio.gather(*[
            queue.reserve_daily_quota('test:quota:day', f'task-{i}', [], 3, 7200)
            for i in range(20)
        ])
        assert sum(results) == 3
        assert await redis.scard('test:quota:day') == 3
        assert 7190 <= await redis.ttl('test:quota:day') <= 7200

    @pytest.mark.asyncio
    async def test_restart_seeding_deduplicates_ids_and_preserves_limit(self, quota):
        queue, redis = quota
        key = 'test:quota:day'
        assert await queue.reserve_daily_quota(key, 'new', ['one', 'one', 'two'], 3, 120)
        assert await queue.reserve_daily_quota(key, 'new', ['one', 'two'], 3, 120)
        assert not await queue.reserve_daily_quota(key, 'fourth', ['one', 'two'], 3, 120)
        assert await redis.smembers(key) == {'one', 'two', 'new'}

    @pytest.mark.asyncio
    async def test_failure_rollback_releases_only_this_id_and_next_day_is_independent(self, quota):
        queue, redis = quota
        key = 'test:quota:day'
        assert await queue.reserve_daily_quota(key, 'failed', ['one', 'two'], 3, 120)
        await queue.release_daily_quota(key, 'failed')
        await queue.release_daily_quota(None, 'one')
        assert await redis.smembers(key) == {'one', 'two'}
        assert await queue.reserve_daily_quota(key, 'replacement', [], 3, 120)
        assert await queue.reserve_daily_quota('test:quota:next', 'next', [], 3, 120)
        assert await redis.scard(key) == 3
        assert await redis.scard('test:quota:next') == 1
