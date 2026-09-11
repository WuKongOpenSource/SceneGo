"""Keep online-worker lifecycle coverage runnable without the mixed runtime."""
from unittest.mock import Mock

import pytest

from core.online_provider_worker import OnlineProviderWorker
from worker_lifespan_contract import WorkerHeartbeatContract, heartbeat_fixture


@pytest.fixture
async def worker(monkeypatch):
    instance = OnlineProviderWorker("fixture", Mock(), Mock(), register_signals=False)
    async with heartbeat_fixture(instance, monkeypatch) as instance:
        yield instance


class TestOnlineWorkerHeartbeat(WorkerHeartbeatContract):
    pass
