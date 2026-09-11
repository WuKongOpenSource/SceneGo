"""Cancellation/refund invariants shared without any node claim implementation."""
import asyncio
from unittest.mock import AsyncMock

import pytest
from fakeredis.aioredis import FakeRedis

from core.task_dispatch_guard import (
    begin_submission, can_cancel_task, cancel_before_submission,
    claim_for_preparation, retry_cancelled_refunds,
)


class CancellationContract:
    @pytest.fixture
    async def runtime(self, monkeypatch):
        import db_manager
        from dao_task import TaskDAO
        from services import task_credit_billing_service

        redis = FakeRedis(decode_responses=True)
        try:
            queue = self.queue_type(redis)
            task = self.task_type("task-cancel", "seedance_i2v", {
                "_credit_billing": {"owner_id": "u1", "amount": 10},
            }, user_id="u1")
            monkeypatch.setattr(db_manager, "get_db_manager", lambda: object())
            monkeypatch.setattr(TaskDAO, "create_task", AsyncMock())
            monkeypatch.setattr(TaskDAO, "update_task_status", AsyncMock())
            release = AsyncMock(return_value={"amount": 10})
            monkeypatch.setattr(task_credit_billing_service, "release_task_credits", release)
            yield queue, task, self.task_prefix, release
        finally:
            await redis.aclose()

    @pytest.mark.asyncio
    async def test_queued_cancel_refunds_and_cannot_be_dequeued_or_resurrected(self, runtime):
        queue, task, prefix, release = runtime
        assert await queue.enqueue(task)
        assert can_cancel_task(await queue.get_task(task.task_id))
        assert await queue.cancel_task(task.task_id)
        release.assert_awaited_once()
        cancelled = await queue.get_task(task.task_id)
        assert cancelled.status.value == "cancelled"
        assert cancelled.refund_status == "completed"
        assert await queue.dequeue(external_only=True) is None
        await queue._save_task(task)
        assert (await queue.get_task(task.task_id)).status.value == "cancelled"
        assert await queue.redis.zcard(f"{prefix}cancel_refunds") == 0

    @pytest.mark.asyncio
    async def test_preparing_cancel_wins_before_outbound_submission(self, runtime):
        queue, task, prefix, release = runtime
        await queue.enqueue(task)
        assert await queue.dequeue(external_only=True)
        assert can_cancel_task(await queue.get_task(task.task_id))
        assert await queue.cancel_task(task.task_id)
        assert not await queue.begin_submission(task.task_id)
        release.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_submitted_or_legacy_running_tasks_never_refund(self, runtime):
        queue, task, prefix, release = runtime
        await queue.enqueue(task)
        await queue.dequeue(external_only=True)
        assert await queue.begin_submission(task.task_id)
        assert not can_cancel_task(await queue.get_task(task.task_id))
        assert not await queue.cancel_task(task.task_id)
        await queue.redis.hdel(f"{prefix}{task.task_id}", "dispatch_state")
        assert not await queue.cancel_task(task.task_id)
        release.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_refund_failure_survives_queue_restart_and_retries(self, runtime):
        queue, task, prefix, release = runtime
        release.side_effect = RuntimeError("ledger temporarily unavailable")
        await queue.enqueue(task)
        assert await queue.cancel_task(task.task_id)
        assert (await queue.get_task(task.task_id)).refund_status == "pending"
        assert not await queue.delete_task(task.task_id)
        assert await queue.redis.zscore(f"{prefix}cancel_refunds", task.task_id) is not None
        release.side_effect = None
        restarted = type(queue)(queue.redis)
        await retry_cancelled_refunds(restarted, prefix)
        assert (await queue.get_task(task.task_id)).refund_status == "completed"
        assert await queue.redis.zcard(f"{prefix}cancel_refunds") == 0

    @pytest.mark.asyncio
    async def test_duplicate_cancel_uses_idempotent_ledger_release(self, runtime, monkeypatch):
        from services import task_credit_billing_service
        queue, task, prefix, _ = runtime
        balance = 90
        frozen = True
        async def release_once(*args, **kwargs):
            nonlocal balance, frozen
            if frozen:
                frozen = False
                balance += 10
        # Exercise duplicate requests with a ledger stub that has the production idempotency contract.
        monkeypatch.setattr(task_credit_billing_service, "release_task_credits", release_once)
        import db_manager
        monkeypatch.setattr(db_manager, "get_db_manager", lambda: None)
        await queue.enqueue(task)
        assert all(await asyncio.gather(*(queue.cancel_task(task.task_id) for _ in range(5))))
        assert balance == 100


class DispatchRaceContract:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("winner", ["cancel", "submit", "race"])
    async def test_atomic_cancel_dispatch_race(self, winner):
        redis = FakeRedis(decode_responses=True)
        try:
            key, refunds = "task:race", "refunds"
            await redis.hset(key, mapping={"status": "queued"})
            submit = await self.prepare_submission(redis, key)
            cancel = lambda: cancel_before_submission(redis, key, refunds, "race")
            if winner == "cancel":
                cancelled, submitted = await cancel(), await submit()
            elif winner == "submit":
                submitted, cancelled = await submit(), await cancel()
            else:
                cancelled, submitted = await asyncio.gather(cancel(), submit())
            assert cancelled != submitted
            assert await redis.hget(key, "status") == ("cancelled" if cancelled else "processing")
            assert bool(await redis.zscore(refunds, "race")) == cancelled
        finally:
            await redis.aclose()


class WorkerDispatchRaceContract(DispatchRaceContract):
    async def prepare_submission(self, redis, key):
        await claim_for_preparation(redis, key, "processing", "race")
        return lambda: begin_submission(redis, key)
