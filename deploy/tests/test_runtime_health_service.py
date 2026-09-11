from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from services import runtime_health_service
from services.runtime_health_service import collect_database_health, read_release_metadata


@pytest.mark.parametrize("pending,processing,snapshot,expected", [
    (None, 0, {}, "unavailable"),
    (0, None, {}, "unavailable"),
    (0, 0, None, "unavailable"),
    (-1, 0, {}, "unhealthy"),
    (0, -1, {}, "unhealthy"),
    (0, 0, {}, "healthy"),
    (0, 0, {"processing_count": 1}, "inconsistent"),
    (0, 1, {"pending_count": 1}, "healthy"),
    (1, 0, {"oldest_pending_age_seconds": 3600}, "healthy"),
    (1, 0, {"oldest_pending_age_seconds": 3601}, "stalled"),
    (0, 1, {"oldest_processing_age_seconds": 7200}, "healthy"),
    (0, 1, {"oldest_processing_age_seconds": 7201}, "stalled"),
])
def test_online_queue_health_uses_explicit_age_and_availability_rules(monkeypatch, pending, processing, snapshot, expected):
    monkeypatch.delenv("HEALTH_QUEUE_MAX_AGE_SECONDS", raising=False)
    monkeypatch.delenv("HEALTH_PROCESSING_MAX_AGE_SECONDS", raising=False)
    assert runtime_health_service.online_queue_health_status(pending, processing, snapshot) == expected


@pytest.mark.parametrize("value", ["not-an-integer", "", "0", "-1"])
def test_invalid_queue_health_thresholds_cannot_disable_stall_detection(monkeypatch, value):
    monkeypatch.setenv("HEALTH_QUEUE_MAX_AGE_SECONDS", value)
    monkeypatch.setenv("HEALTH_PROCESSING_MAX_AGE_SECONDS", value)
    assert runtime_health_service.online_queue_health_status(1, 0, {"oldest_pending_age_seconds": 3601}) == "stalled"
    assert runtime_health_service.online_queue_health_status(0, 1, {"oldest_processing_age_seconds": 7201}) == "stalled"


class HealthyDatabase:
    async def fetchval(self, query: str):
        if query == "SELECT 1":
            return 1
        assert "schema_migrations" in query
        return True

    async def fetchrow(self, query: str):
        if "FROM schema_migrations" in query:
            return {
                "migration_id": "sql/001.sql",
                "checksum_sha256": "a" * 64,
                "applied_at": datetime(2026, 7, 18, 3, 4, 5, tzinfo=timezone.utc),
                "execution_ms": 12,
                "git_sha": "abc123",
                "applied_count": 4,
            }
        raise AssertionError(query)

    async def fetch(self, query: str):
        assert "FROM tasks" in query
        now = datetime.now(timezone.utc)
        return [
            {
                "task_type": "i2v",
                "status": "pending",
                "task_count": 2,
                "oldest_created_at": now,
                "oldest_started_at": None,
            },
            {
                "task_type": "i2v",
                "status": "processing",
                "task_count": 1,
                "oldest_created_at": now,
                "oldest_started_at": now,
            },
            {
                "task_type": "seedance_t2v",
                "status": "processing",
                "task_count": 3,
                "oldest_created_at": now,
                "oldest_started_at": now,
            },
        ]


async def test_collect_database_health_includes_latest_migration():
    result = await collect_database_health(HealthyDatabase())

    assert result["status"] == "healthy"
    assert result["migrations"]["applied_count"] == 4
    assert result["migrations"]["latest"]["migration_id"] == "sql/001.sql"
    assert result["migrations"]["latest"]["applied_at"] == "2026-07-18T03:04:05+00:00"
    assert result["task_queue"]["pending_count"] == 2
    assert result["task_queue"]["oldest_pending_age_seconds"] <= 1
    assert result["task_queue"]["processing_count"] == 1
    assert result["api_tasks"]["processing_count"] == 3


async def test_collect_database_health_reports_missing_ledger():
    class DatabaseWithoutLedger:
        async def fetchval(self, query: str):
            return 1 if query == "SELECT 1" else False

        async def fetchrow(self, query: str):
            raise AssertionError(query)

        async def fetch(self, query: str):
            assert "FROM tasks" in query
            return []

    result = await collect_database_health(DatabaseWithoutLedger())

    assert result["status"] == "healthy"
    assert result["migrations"] == {"status": "uninitialized", "applied_count": 0}
    assert result["task_queue"]["pending_count"] == 0


async def test_collect_database_health_degrades_without_database():
    result = await collect_database_health(None)

    assert result["status"] == "unhealthy"
    assert result["migrations"]["status"] == "unknown"


def test_read_release_metadata(tmp_path):
    path = tmp_path / "release_metadata.json"
    path.write_text(
        json.dumps(
            {
                "git_sha": "abc123",
                "backend_source_sha256": "b" * 64,
                "frontend_source_sha256": "f" * 64,
                "released_at": "2026-07-18T03:04:05Z",
            }
        ),
        encoding="utf-8",
    )

    result = read_release_metadata(path)

    assert result["status"] == "available"
    assert result["git_sha"] == "abc123"
    assert result["frontend_source_sha256"] == "f" * 64


def test_read_release_metadata_reports_invalid_json(tmp_path):
    path = tmp_path / "release_metadata.json"
    path.write_text("not-json", encoding="utf-8")

    result = read_release_metadata(path)

    assert result["status"] == "invalid"
    assert result["error"] == "JSONDecodeError"


async def test_collect_provider_health_uses_cache_without_running_generation(monkeypatch):
    calls = []

    async def cached(providers):
        calls.append(providers)
        return [
            {
                "provider": "seedance",
                "model_name": "seedance-2.0",
                "status": "ok",
                "cached_at": "2026-07-18T03:04:05Z",
            }
        ]

    monkeypatch.setenv("HEALTH_CRITICAL_PROVIDERS", "seedance,minimax")
    monkeypatch.setattr(
        "services.runtime_health_service.ApiConfigDAO.list_enabled",
        lambda: _async_result(
            [{"provider": "seedance", "api_key_encrypted": "encrypted"}]
        ),
    )
    monkeypatch.setattr(
        "services.api_provider_health_monitor.list_cached_provider_health",
        cached,
    )
    monkeypatch.setattr(
        "services.api_provider_health_monitor.provider_health_monitor_state",
        lambda: {"loop_running": True},
    )

    result = await runtime_health_service.collect_provider_health()

    assert calls == [["seedance", "minimax"]]
    assert result["status"] == "healthy"
    assert result["summary"]["ok"] == 1
    assert result["channels"][0]["checked_at"] == "2026-07-18T03:04:05Z"


def test_critical_provider_ids_falls_back_to_configured_providers_when_env_is_blank(monkeypatch):
    monkeypatch.setenv("HEALTH_CRITICAL_PROVIDERS", "")

    result = runtime_health_service.critical_provider_ids(
        ["DeepSeek", "minimax", "deepseek", ""],
    )

    assert result == ["deepseek", "minimax"]


async def _async_result(value):
    return value


@pytest.mark.parametrize("task_type", [
    "minimax_tts", "minimax_i2v", "sora2_i2v", "veo_morph", "wan26_i2v",
    "seedance_i2v", "kling_t2v", "vidu_r2v", "happyhorse_r2v", "video_reverse_prompt",
])
def test_provider_health_counts_use_shared_task_catalog(task_type):
    rows = [{"task_type": task_type, "status": "queued", "task_count": 2},
            {"task_type": task_type, "status": "processing", "task_count": 3},
            {"task_type": "unrecognized-work", "status": "pending", "task_count": 4}]
    online = runtime_health_service._task_channel_snapshot(rows, external=True)
    other = runtime_health_service._task_channel_snapshot(rows, external=False)
    assert (online["pending_count"], online["processing_count"]) == (2, 3)
    assert (other["pending_count"], other["processing_count"]) == (4, 0)
