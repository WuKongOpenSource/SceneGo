from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from core.online_provider_worker import OnlineProviderWorker
from core.online_provider_task_model import OnlineProviderTask


@pytest.fixture
def worker():
    redis_client = MagicMock()
    redis_client.hset = AsyncMock()
    redis_client.expire = AsyncMock()
    queue = MagicMock()
    queue.fail_task = AsyncMock()
    queue.begin_submission = AsyncMock(return_value=True)
    return OnlineProviderWorker("api-1", redis_client, queue)


@pytest.mark.asyncio
async def test_cancelled_task_never_reaches_provider(worker):
    worker.task_queue.begin_submission.return_value = False
    worker._record_task_start = AsyncMock()
    worker._process_minimax_task = AsyncMock()
    task = OnlineProviderTask("cancelled", "minimax_i2v", {})
    assert await worker._process_task(task)
    worker._record_task_start.assert_not_awaited()
    worker._process_minimax_task.assert_not_awaited()


@pytest.mark.asyncio
async def test_dispatches_online_task_without_cluster_manager(worker):
    task = OnlineProviderTask("task-1", "minimax_i2v", {"prompt": "test"}, user_id="user-1")
    worker._record_task_start = AsyncMock()
    worker._process_minimax_task = AsyncMock(return_value=True)

    assert await worker._process_task(task) is True
    worker._process_minimax_task.assert_awaited_once_with(task)


@pytest.mark.asyncio
async def test_rejects_local_node_task(worker):
    task = OnlineProviderTask("task-local", "i2i", {}, user_id="user-1")

    assert await worker._process_task(task) is False
    worker.task_queue.fail_task.assert_awaited_once_with(
        "task-local",
        "Task type is not supported by the online-provider worker",
        retry=False,
    )


def test_module_has_no_private_local_node_dependencies():
    source = Path(__file__).parents[1].joinpath("core", "online_provider_worker.py").read_text(
        encoding="utf-8"
    )
    forbidden_imports = ("cluster_manager", "comfyui_agent", "workflow_loader", "core.task_queue")
    assert not any(name in source.lower() for name in forbidden_imports)


@pytest.mark.asyncio
async def test_start_can_leave_process_signals_to_asgi_server(monkeypatch):
    redis_client = MagicMock()
    queue = MagicMock()
    worker = OnlineProviderWorker(
        "api-embedded",
        redis_client,
        queue,
        register_signals=False,
    )
    worker._heartbeat_loop = AsyncMock()
    worker._process_loop = AsyncMock()
    signal_spy = MagicMock()
    monkeypatch.setattr("core.online_provider_worker.signal.signal", signal_spy)

    await worker.start()

    signal_spy.assert_not_called()
