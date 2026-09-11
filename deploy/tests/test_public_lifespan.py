"""Exercise startup rollback and shutdown without real services or workers."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

import public_main


@pytest.fixture
async def runtime(monkeypatch):
    state = SimpleNamespace(
        failure=None, clients=[], workers=[], running=[],
        db=SimpleNamespace(disconnect=AsyncMock()),
        app=SimpleNamespace(state=SimpleNamespace(redis_client=None)),
    )
    for name in ("database_manager", "main_event_loop", "online_task_service",
                 "redis_client", "pubsub_redis_client"):
        monkeypatch.setattr(public_main, name, None)
    monkeypatch.setattr(public_main, "online_workers", [])
    monkeypatch.setenv("ONLINE_PROVIDER_WORKERS_COUNT", "2")
    for name in ("validate_api_config_encryption_configuration", "validate_captcha_configuration",
                 "validate_auth_rate_limit_configuration", "validate_public_feedback_rate_limit_configuration",
                 "validate_runtime_provider_environment", "validate_redis_security"):
        monkeypatch.setattr(public_main, name, Mock())
    monkeypatch.setattr(public_main.jwt_auth, "init", Mock())
    monkeypatch.setattr(public_main, "init_db_manager", AsyncMock(return_value=state.db))
    for name in ("seed_default_api_providers", "_seed_admin_roles", "load_api_configs_to_env"):
        monkeypatch.setattr(public_main, name, AsyncMock())
    monkeypatch.setattr(public_main, "set_provider_health_redis", Mock())
    monkeypatch.setattr(public_main, "configure_presence_store", Mock())

    def fail(stage):
        if state.failure == stage:
            raise RuntimeError(stage)

    def client(**kwargs):
        number = len(state.clients) + 1
        fail(f"redis_factory_{number}")
        result = SimpleNamespace(ping=AsyncMock(), aclose=AsyncMock(), close=AsyncMock())
        if state.failure == f"redis_ping_{number}":
            result.ping.side_effect = RuntimeError(state.failure)
        state.clients.append(result)
        return result

    async def background(*args):
        state.running.append(asyncio.current_task())
        await asyncio.Future()

    def worker(*args, **kwargs):
        fail(f"worker_{len(state.workers) + 1}")
        result = SimpleNamespace(start=AsyncMock(side_effect=background), stop=AsyncMock())
        state.workers.append(result)
        return result

    def service(*args):
        fail("task_service")
        return SimpleNamespace(get_queue=lambda: object())

    monkeypatch.setattr(public_main.redis, "Redis", client)
    monkeypatch.setattr(public_main, "OnlineProviderWorker", worker)
    monkeypatch.setattr(public_main, "OnlineProviderTaskService", service)
    monkeypatch.setattr(public_main, "email_outbox_worker_loop", background)
    monkeypatch.setattr(public_main, "provider_health_monitor_loop", background)
    try:
        yield state
    finally:
        # Broken startup must not leave tasks running in the rest of the suite.
        for task in state.running:
            task.cancel()
        await asyncio.gather(*state.running, return_exceptions=True)


def assert_released(runtime):
    runtime.db.disconnect.assert_awaited_once()
    for client in runtime.clients:
        client.aclose.assert_awaited_once()
    for worker in runtime.workers:
        worker.stop.assert_awaited_once()
    assert all(task.done() for task in runtime.running)
    assert not public_main.online_workers
    assert runtime.app.state.redis_client is None
    for name in ("database_manager", "main_event_loop", "online_task_service",
                 "redis_client", "pubsub_redis_client"):
        assert getattr(public_main, name) is None, name
    public_main.set_provider_health_redis.assert_called_with(None)


@pytest.mark.parametrize("stage", [
    "seed_default_api_providers", "_seed_admin_roles", "load_api_configs_to_env",
    "validate_runtime_provider_environment", "validate_redis_security",
    "redis_factory_1", "redis_factory_2", "redis_ping_1", "redis_ping_2",
    "task_service", "worker_2",
])
async def test_startup_failure_releases_each_acquired_resource(runtime, stage):
    runtime.failure = stage
    if hasattr(public_main, stage):
        getattr(public_main, stage).side_effect = RuntimeError(stage)
    with pytest.raises(RuntimeError, match=stage):
        async with public_main.lifespan(runtime.app):
            pytest.fail("failed startup must not serve requests")
    assert_released(runtime)


async def test_successful_start_and_shutdown_clear_resources(runtime):
    async with public_main.lifespan(runtime.app):
        await asyncio.sleep(0)
        assert runtime.app.state.redis_client is runtime.clients[0]
        assert len(public_main.online_workers) == 2
        assert len(runtime.running) == 4
        runtime.db.disconnect.assert_not_awaited()
    assert_released(runtime)


async def test_body_failure_still_releases_resources(runtime):
    with pytest.raises(RuntimeError, match="application failure"):
        async with public_main.lifespan(runtime.app):
            await asyncio.sleep(0)
            raise RuntimeError("application failure")
    assert_released(runtime)


@pytest.mark.parametrize("target", ["database", "redis", "pubsub"])
async def test_one_cleanup_failure_does_not_skip_other_resources(runtime, target):
    with pytest.raises(RuntimeError, match="cleanup failure"):
        async with public_main.lifespan(runtime.app):
            await asyncio.sleep(0)
            resource = {"database": runtime.db.disconnect, "redis": runtime.clients[0].aclose,
                        "pubsub": runtime.clients[1].aclose}[target]
            resource.side_effect = RuntimeError("cleanup failure")
    assert_released(runtime)


async def test_startup_cancellation_releases_acquired_resources(runtime):
    public_main.load_api_configs_to_env.side_effect = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        async with public_main.lifespan(runtime.app):
            pytest.fail("cancelled startup must not serve requests")
    assert_released(runtime)


@pytest.mark.parametrize("stage", [
    "validate_api_config_encryption_configuration", "validate_captcha_configuration",
    "validate_auth_rate_limit_configuration", "validate_public_feedback_rate_limit_configuration",
    "jwt", "init_db_manager",
])
async def test_pre_connection_failure_does_not_allocate_or_close_unowned_resources(runtime, stage):
    target = public_main.jwt_auth.init if stage == "jwt" else getattr(public_main, stage)
    target.side_effect = RuntimeError(stage)
    with pytest.raises(RuntimeError, match=stage):
        async with public_main.lifespan(runtime.app):
            pytest.fail("invalid configuration must not serve requests")
    runtime.db.disconnect.assert_not_awaited()
    assert not runtime.clients and not runtime.workers
    assert public_main.main_event_loop is None
    assert public_main.database_manager is None
    assert runtime.app.state.redis_client is None


async def test_workers_stop_before_connections_close(runtime):
    def assert_consumers_stopped():
        assert all(worker.stop.await_count == 1 for worker in runtime.workers)
        assert all(task.done() for task in runtime.running)

    async with public_main.lifespan(runtime.app):
        await asyncio.sleep(0)
        runtime.db.disconnect.side_effect = assert_consumers_stopped
        for client in runtime.clients:
            client.aclose.side_effect = assert_consumers_stopped
    assert_released(runtime)
