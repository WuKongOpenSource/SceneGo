"""Public HTTP readiness contract without a private cluster dependency."""
from fastapi import FastAPI

from routers.public_health import create_public_health_router
from runtime_health_contract import RuntimeHealthContract


class FakeRedis:
    async def ping(self):
        return True

    async def get(self, _key):
        return None


class TestPublicRuntimeHealth(RuntimeHealthContract):
    queue_field = "online_queue"

    def application(self, monkeypatch, database, queue, require_admin):
        app = FastAPI()
        app.include_router(create_public_health_router(
            require_admin_dependency=require_admin, get_database_manager=lambda: database,
            get_redis_client=lambda: FakeRedis(), get_online_queue=lambda: queue,
            get_online_workers=lambda: [object()],
        ))
        return app
