"""Shared heartbeat assertions with no concrete runtime or provider dependency."""
import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import Mock

import pytest


@asynccontextmanager
async def heartbeat_fixture(instance, monkeypatch):
    monkeypatch.setattr("signal.signal", Mock())
    instance.test_tasks = []

    async def heartbeat():
        instance.test_tasks.append(asyncio.current_task())
        await asyncio.Future()

    instance._heartbeat_loop = heartbeat
    try:
        yield instance
    finally:
        for task in instance.test_tasks:
            task.cancel()
        await asyncio.gather(*instance.test_tasks, return_exceptions=True)


class WorkerHeartbeatContract:
    @pytest.mark.parametrize("error", [None, RuntimeError("process failed"), asyncio.CancelledError()])
    async def test_process_exit_joins_heartbeat(self, worker, error):
        async def process():
            await asyncio.sleep(0)
            if error:
                raise error

        worker._process_loop = process
        if error:
            with pytest.raises(type(error)):
                await worker.start()
        else:
            await worker.start()
        assert worker.running is False
        assert worker._heartbeat_task is None
        assert all(task.done() for task in worker.test_tasks)

    async def test_cancelled_graceful_stop_still_joins_heartbeat(self, worker):
        worker.current_task = SimpleNamespace(task_id="fixture")
        worker._heartbeat_task = asyncio.create_task(worker._heartbeat_loop())
        await asyncio.sleep(0)
        stop = asyncio.create_task(worker.stop())
        await asyncio.sleep(0)
        stop.cancel()
        with pytest.raises(asyncio.CancelledError):
            await stop
        assert worker.running is False
        assert worker._heartbeat_task is None
        assert all(task.done() for task in worker.test_tasks)
