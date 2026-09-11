import json
from unittest.mock import AsyncMock, patch

import pytest

from core.online_provider_queue import (
    COMPLETED_KEY,
    PENDING_KEY,
    PROCESSING_KEY,
    TASK_PREFIX,
    OnlineProviderQueue,
)
from core.online_provider_task_model import OnlineProviderTask, OnlineTaskStatus


def _redis() -> AsyncMock:
    client = AsyncMock()
    client.hgetall.return_value = {}
    client.zpopmin.return_value = []
    client.zrange.return_value = []
    return client


@pytest.mark.asyncio
async def test_rejects_non_online_task_before_redis_write() -> None:
    queue = OnlineProviderQueue(_redis())

    with pytest.raises(ValueError):
        await queue.enqueue(OnlineProviderTask("local-1", "i2i", {}))

    queue.redis.hset.assert_not_awaited()


@pytest.mark.asyncio
async def test_enqueue_uses_online_only_namespace() -> None:
    redis = _redis()
    queue = OnlineProviderQueue(redis)
    task = OnlineProviderTask("online-1", "minimax_i2v", {}, user_id="user-1")

    with patch.object(queue, "_persist_create", new=AsyncMock()):
        assert await queue.enqueue(task) is True

    assert task.status == OnlineTaskStatus.QUEUED
    assert redis.eval.await_args.args[2] == f"{TASK_PREFIX}online-1"
    assert redis.zadd.await_args_list[-1].args[0] == PENDING_KEY


@pytest.mark.asyncio
async def test_dequeue_marks_processing_without_local_queue_fallback() -> None:
    redis = _redis()
    redis.zpopmin.return_value = [(b"online-2", 1.0)]
    queue = OnlineProviderQueue(redis)
    task = OnlineProviderTask("online-2", "seedance_standard", {}, user_id="user-1")
    queue.get_task = AsyncMock(return_value=task)
    queue._save_task = AsyncMock()

    result = await queue.dequeue(external_only=True)

    assert result is task
    assert task.status == OnlineTaskStatus.PROCESSING
    redis.zpopmin.assert_awaited_once_with(PENDING_KEY, count=1)
    assert redis.eval.await_args.args[3] == PROCESSING_KEY


@pytest.mark.asyncio
async def test_complete_publishes_metadata_not_result_body() -> None:
    redis = _redis()
    queue = OnlineProviderQueue(redis)
    task = OnlineProviderTask(
        "online-3",
        "wan26_i2v",
        {"provider": "dashscope", "model": "wan2.6"},
        user_id="user-1",
    )
    task.status = OnlineTaskStatus.PROCESSING
    queue.get_task = AsyncMock(return_value=task)
    queue._save_task = AsyncMock()
    queue._persist_status = AsyncMock()

    with patch(
        "services.task_credit_billing_service.settle_task_credits",
        new=AsyncMock(),
    ):
        assert await queue.complete_task("online-3", {"videos": [{"url": "/private"}]}) is True

    assert task.status == OnlineTaskStatus.COMPLETED
    assert redis.zadd.await_args.args[0] == COMPLETED_KEY
    payload = json.loads(redis.publish.await_args.args[1])
    assert payload["provider"] == "dashscope"
    assert "videos" not in payload


def test_online_queue_source_has_no_private_local_runtime_terms() -> None:
    source = __import__("pathlib").Path(__file__).parents[1].joinpath(
        "core", "online_provider_queue.py"
    ).read_text(encoding="utf-8").lower()
    for forbidden in ("comfyui", "cluster_manager", "workflow_json", "agent_routes"):
        assert forbidden not in source
