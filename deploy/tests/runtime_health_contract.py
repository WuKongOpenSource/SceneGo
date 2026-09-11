"""Shared readiness semantics; neither application may hide stalled online work."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient


class HealthDatabase:
    def __init__(self, rows=()):
        self.rows = list(rows)

    async def fetchval(self, query):
        return 1 if query == "SELECT 1" else False

    async def fetch(self, query):
        assert "FROM tasks" in query
        return self.rows

    async def fetchrow(self, query):
        raise AssertionError(query)


class HealthQueue:
    def __init__(self, pending=0, processing=0):
        self.pending, self.processing = pending, processing

    async def get_queue_length(self):
        return 0

    async def get_processing_count(self):
        return 0

    async def get_external_queue_length(self):
        return self.pending

    async def get_external_processing_count(self):
        return self.processing


class RuntimeHealthContract:
    async def health(self, monkeypatch, database, queue):
        app = self.application(monkeypatch, database, queue, lambda: "admin")
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            coarse = await client.get("/health")
            detail = await client.get("/api/admin/system/health")
        assert coarse.status_code == detail.status_code == 200
        assert coarse.json() == {"status": detail.json()["status"]}
        return detail.json()

    @pytest.mark.asyncio
    async def test_unavailable_database_degrades_readiness(self, monkeypatch):
        assert (await self.health(monkeypatch, None, HealthQueue()))["status"] == "degraded"

    @pytest.mark.asyncio
    async def test_healthy_coarse_probe_does_not_expose_admin_details(self, monkeypatch):
        def deny_admin():
            raise HTTPException(status_code=403, detail="admin required")

        app = self.application(monkeypatch, HealthDatabase(), HealthQueue(), deny_admin)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            coarse = await client.get("/health")
            detail = await client.get("/api/admin/system/health")
        assert coarse.status_code == 200 and coarse.json() == {"status": "healthy"}
        assert detail.status_code == 403

    @pytest.mark.asyncio
    @pytest.mark.parametrize("state", ["pending", "queued", "processing"])
    async def test_stalled_online_tasks_degrade_readiness(self, monkeypatch, state):
        monkeypatch.setenv("HEALTH_QUEUE_MAX_AGE_SECONDS", "60")
        monkeypatch.setenv("HEALTH_PROCESSING_MAX_AGE_SECONDS", "60")
        old = datetime.now(timezone.utc) - timedelta(minutes=5)
        rows = [{"task_type": "seedance_t2v", "status": state, "task_count": 1,
                 "oldest_created_at": old, "oldest_started_at": old if state == "processing" else None}]
        queue = HealthQueue(pending=int(state != "processing"), processing=int(state == "processing"))
        result = await self.health(monkeypatch, HealthDatabase(rows), queue)
        assert result["status"] == "degraded"
        assert result[self.queue_field]["status"] == "stalled"

    @pytest.mark.asyncio
    async def test_database_task_missing_from_redis_degrades_readiness(self, monkeypatch):
        rows = [{"task_type": "seedance_t2v", "status": "queued", "task_count": 1,
                 "oldest_created_at": datetime.now(timezone.utc)}]
        result = await self.health(monkeypatch, HealthDatabase(rows), HealthQueue())
        assert result["status"] == "degraded"
        assert result[self.queue_field]["status"] == "inconsistent"

    @pytest.mark.asyncio
    async def test_active_handoff_is_not_treated_as_a_lost_task(self, monkeypatch):
        rows = [{"task_type": "seedance_t2v", "status": "queued", "task_count": 1,
                 "oldest_created_at": datetime.now(timezone.utc)}]
        result = await self.health(monkeypatch, HealthDatabase(rows), HealthQueue(processing=1))
        assert result["status"] == "healthy"
        assert result[self.queue_field]["status"] == "healthy"
