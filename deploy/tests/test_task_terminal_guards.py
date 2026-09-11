"""Public terminal-state regressions independent of private queue protocols."""
from unittest.mock import AsyncMock, call

import pytest

from core.online_provider_queue import FAILED_KEY, PENDING_KEY, PROCESSING_KEY, OnlineProviderQueue
from core.online_provider_task_model import OnlineProviderTask, OnlineTaskStatus
from services.online_provider_task_service import OnlineProviderTaskService
from services import task_credit_billing_service
from task_terminal_contract import TaskTerminalContract


class TestOnlineTaskTerminalGuards(TaskTerminalContract):
    service_type = OnlineProviderTaskService
    queue_type = OnlineProviderQueue
    task_type = OnlineProviderTask
    status_type = OnlineTaskStatus
    processing_keys = (PROCESSING_KEY,)


@pytest.mark.asyncio
async def test_final_failure_removes_pending_and_processing_and_releases_credits(monkeypatch):
    release = AsyncMock()
    monkeypatch.setattr(task_credit_billing_service, "release_task_credits", release)
    redis = AsyncMock()
    queue = OnlineProviderQueue(redis)
    task = OnlineProviderTask("failed-task", "seedance_t2v", {}, user_id="user-1")
    queue.get_task = AsyncMock(return_value=task)
    queue._save_task = AsyncMock()
    queue._persist_status = AsyncMock()
    queue._publish = AsyncMock()

    assert await queue.fail_task(task.task_id, "terminal failure", retry=False) is True
    assert task.status == OnlineTaskStatus.FAILED
    assert task.completed_at
    queue._save_task.assert_awaited_once_with(task)
    assert redis.zrem.await_args_list == [call(PENDING_KEY, task.task_id), call(PROCESSING_KEY, task.task_id)]
    redis.zadd.assert_awaited_once()
    assert redis.zadd.await_args.args[0] == FAILED_KEY
    assert list(redis.zadd.await_args.args[1]) == [task.task_id]
    release.assert_awaited_once_with(
        task_id=task.task_id, task_data=task.data, user_id=task.user_id, reason="task_failed",
    )
    queue._persist_status.assert_awaited_once_with(task, error_message="terminal failure")
    queue._publish.assert_awaited_once_with(task, "task_failed", error="terminal failure")
