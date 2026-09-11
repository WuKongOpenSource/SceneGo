import pytest

from services.task_stale_reaper import STALE_TASK_MESSAGE, reap_stale_tasks




class _Queue:
    def __init__(self):
        self.failed = []

    async def fail_task(self, task_id, error, retry=True):
        self.failed.append((task_id, error, retry))
        return True


@pytest.mark.asyncio
async def test_reaper_syncs_queue_and_releases_each_stale_task():
    queue = _Queue()
    released = []

    async def cleanup(hours):
        assert hours == 1
        return ["task-a", "task-b"]

    async def release(task_id, **kwargs):
        released.append((task_id, kwargs))

    cleaned = await reap_stale_tasks(
        1,
        task_queue=queue,
        cleanup_ids_fn=cleanup,
        release_fn=release,
    )

    assert cleaned == 2
    assert queue.failed == [
        ("task-a", STALE_TASK_MESSAGE, False),
        ("task-b", STALE_TASK_MESSAGE, False),
    ]
    assert [item[0] for item in released] == ["task-a", "task-b"]
    assert all(item[1]["operator"] == "task_stale_reaper" for item in released)


@pytest.mark.asyncio
async def test_reaper_keeps_processing_after_one_reconciliation_error():
    queue = _Queue()
    released = []

    async def cleanup(_hours):
        return ["task-bad", "task-good"]

    async def release(task_id, **_kwargs):
        released.append(task_id)
        if task_id == "task-bad":
            raise RuntimeError("temporary database error")

    cleaned = await reap_stale_tasks(
        1,
        task_queue=queue,
        cleanup_ids_fn=cleanup,
        release_fn=release,
    )

    assert cleaned == 2
    assert released == ["task-bad", "task-good"]
    assert [item[0] for item in queue.failed] == ["task-bad", "task-good"]
