"""Submission identity and terminal guards shared by both task runtimes."""
from unittest.mock import AsyncMock, call

import pytest

from services import task_credit_billing_service


class TaskTerminalContract:
    @pytest.mark.asyncio
    async def test_task_service_uses_preallocated_task_id(self, monkeypatch):
        reserve = AsyncMock(return_value=False)
        monkeypatch.setattr(task_credit_billing_service, "reserve_task_credits", reserve)
        service = self.service_type(
            AsyncMock(), model_access_checker=AsyncMock(return_value={"accessMode": "inherit"}),
        )
        service.queue.enqueue = AsyncMock(return_value=True)
        task_id = await service.submit(
            task_type="video_reverse_prompt", task_data={"value": 1},
            user_id="user-1", prepare=False, task_id="task-reserved",
        )
        assert task_id == "task-reserved"
        service.queue.enqueue.assert_awaited_once()
        enqueued = service.queue.enqueue.await_args.args[0]
        assert enqueued.task_id == "task-reserved"
        reserve.assert_awaited_once()
        assert reserve.await_args.kwargs["task_id"] == "task-reserved"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("method_name", ["complete_task", "fail_task"])
    async def test_cancelled_task_rejects_late_terminal_write(self, monkeypatch, method_name):
        settle, release = AsyncMock(), AsyncMock()
        monkeypatch.setattr(task_credit_billing_service, "settle_task_credits", settle)
        monkeypatch.setattr(task_credit_billing_service, "release_task_credits", release)
        redis = AsyncMock()
        queue = self.queue_type(redis)
        task = self.task_type("task-cancelled", "video_reverse_prompt", {}, user_id="user-1")
        task.status = self.status_type.CANCELLED
        queue.get_task = AsyncMock(return_value=task)
        queue._save_task = AsyncMock()
        result = await getattr(queue, method_name)(
            task.task_id, {"result": True} if method_name == "complete_task" else "late failure",
        )
        assert result is False
        assert task.status == self.status_type.CANCELLED
        queue._save_task.assert_not_awaited()
        assert redis.zrem.await_args_list == [call(key, task.task_id) for key in self.processing_keys]
        redis.zadd.assert_not_awaited()
        redis.publish.assert_not_awaited()
        settle.assert_not_awaited()
        release.assert_not_awaited()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("method_name", ["complete_task", "fail_task"])
    async def test_missing_task_does_not_write_or_bill(self, monkeypatch, method_name):
        settle, release = AsyncMock(), AsyncMock()
        monkeypatch.setattr(task_credit_billing_service, "settle_task_credits", settle)
        monkeypatch.setattr(task_credit_billing_service, "release_task_credits", release)
        redis = AsyncMock()
        queue = self.queue_type(redis)
        queue.get_task = AsyncMock(return_value=None)
        queue._save_task = AsyncMock()
        assert await getattr(queue, method_name)("missing", {} if method_name == "complete_task" else "error") is False
        queue._save_task.assert_not_awaited()
        assert redis.mock_calls == []
        settle.assert_not_awaited()
        release.assert_not_awaited()
