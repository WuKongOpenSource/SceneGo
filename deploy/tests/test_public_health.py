from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.public_health import create_public_health_router


class FakeDatabase:
    async def fetchval(self, query: str):
        if query == "SELECT 1":
            return 1
        if "to_regclass" in query:
            return True
        if "COUNT" in query:
            return 12
        raise AssertionError(query)

    async def fetchrow(self, query: str):
        assert "FROM schema_migrations" in query
        return {"migration_id": "fixture", "applied_count": 12}

    async def fetch(self, query: str):
        assert "FROM tasks" in query
        return []


class FakeRedis:
    async def ping(self):
        return True

    async def get(self, _key):
        return None


class FakeQueue:
    async def get_external_queue_length(self):
        return 2

    async def get_external_processing_count(self):
        return 1


def _client(*, admin_allowed: bool) -> TestClient:
    async def require_admin():
        if not admin_allowed:
            from fastapi import HTTPException

            raise HTTPException(status_code=401, detail="需要管理员登录")
        return "admin"

    app = FastAPI()
    app.include_router(
        create_public_health_router(
            require_admin_dependency=require_admin,
            get_database_manager=lambda: FakeDatabase(),
            get_redis_client=lambda: FakeRedis(),
            get_online_queue=lambda: FakeQueue(),
            get_online_workers=lambda: [object()],
        )
    )
    return TestClient(app)


def test_public_health_only_exposes_coarse_status() -> None:
    response = _client(admin_allowed=False).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


def test_detailed_health_requires_admin() -> None:
    response = _client(admin_allowed=False).get("/api/admin/system/health")
    assert response.status_code == 401


def test_admin_health_reports_only_online_runtime_components() -> None:
    response = _client(admin_allowed=True).get("/api/admin/system/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["database"]["migrations"]["applied_count"] == 12
    assert payload["online_queue"] == {"status": "healthy", "pending": 2, "processing": 1}
    assert "cluster" not in payload
    assert "nodes" not in payload


def test_public_health_database_failure_never_exposes_exception_text(monkeypatch):
    async def fail_probe(_self, _query):
        raise RuntimeError("private-connection-details")

    monkeypatch.setattr(FakeDatabase, "fetchval", fail_probe)
    client = _client(admin_allowed=True)
    coarse = client.get("/health")
    detail = client.get("/api/admin/system/health")
    assert coarse.json() == {"status": "degraded"}
    assert detail.json()["database"] == {"status": "unhealthy", "migrations": {"status": "unknown"}}
    assert "private-connection-details" not in detail.text
