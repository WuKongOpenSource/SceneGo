#!/usr/bin/env python3
"""Verify provider health monitor cache behavior without real Redis or HTTP."""
from __future__ import annotations

import asyncio
import copy
import json
import os
import sys
from pathlib import Path
from typing import Any


def deploy_root() -> Path:
    return Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


class FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}
        self.ttl: dict[str, int] = {}

    async def set(self, key: str, value: str, ex: int | None = None):
        self.store[key] = value
        if ex is not None:
            self.ttl[key] = ex
        return True

    async def get(self, key: str):
        return self.store.get(key)

    async def delete(self, key: str):
        existed = key in self.store
        self.store.pop(key, None)
        self.ttl.pop(key, None)
        return 1 if existed else 0

    async def scan_iter(self, match: str):
        prefix = match[:-1] if match.endswith("*") else match
        for key in list(self.store):
            if key.startswith(prefix):
                yield key


async def main() -> int:
    root = deploy_root()
    os.chdir(root)
    sys.path.insert(0, str(root))

    import admin_api_config_routes  # noqa: PLC0415
    from services import api_config_service as config_service  # noqa: PLC0415
    from services import api_config_health_cache_service as config_cache  # noqa: PLC0415
    from services import api_provider_health_monitor as monitor  # noqa: PLC0415

    fake_redis = FakeRedis()
    monitor.set_provider_health_redis(fake_redis)

    checker_calls: list[tuple[str, str]] = []

    async def fake_check(provider: str, model_name: str | None = None):
        checker_calls.append((provider, model_name or ""))
        return {
            "success": True,
            "provider": provider,
            "model_name": model_name or None,
            "status": "ok" if provider == "deepseek" else "no_key",
            "latency_ms": 12 if provider == "deepseek" else None,
            "checked_at": "2026-06-18T00:00:00Z",
            "health": {
                "ok": provider == "deepseek",
                "reachable": provider == "deepseek",
                "auth_ok": provider == "deepseek",
                "status_code": 200 if provider == "deepseek" else None,
                "url": "https://example.test/models" if provider == "deepseek" else None,
                "error": None if provider == "deepseek" else "No API key configured",
                "method": "GET",
                "urls_tried": ["https://example.test/models"],
            },
        }

    results = await monitor.run_provider_health_sweep(
        providers=["deepseek", "gemini-text"],
        redis_client=fake_redis,
        check_fn=fake_check,
        concurrency=2,
        record_state=True,
        sweep_source="manual",
    )
    if len(results) != 2:
        fail(f"Expected two sweep results, got {len(results)}")
    if sorted(item["provider"] for item in results) != ["deepseek", "gemini-text"]:
        fail(f"Unexpected sweep providers: {results}")
    if checker_calls[:2] != [("deepseek", ""), ("gemini-text", "")]:
        fail(f"Provider sweep did not preserve provider order/model args: {checker_calls}")
    if fake_redis.ttl.get(monitor.provider_health_cache_key("deepseek")) is None:
        fail("Health cache did not set a TTL")

    default_redis = FakeRedis()
    default_results = await monitor.run_provider_health_sweep(
        redis_client=default_redis,
        check_fn=fake_check,
        concurrency=8,
        record_state=False,
        sweep_source="background",
    )
    if len(default_results) <= len(monitor.PROVIDER_CATALOG):
        fail(f"Default sweep did not expand provider/model targets: {len(default_results)}")
    if not any(item.get("model_name") for item in default_results):
        fail(f"Default sweep did not include model-specific targets: {default_results[:3]}")
    if not await monitor.get_cached_provider_health(
        "deepseek",
        model_name="deepseek-v4-pro",
        redis_client=default_redis,
    ):
        fail("Default sweep did not cache the deepseek model-specific row")

    target_results = await monitor.run_provider_health_sweep(
        targets=[
            {"provider": "dashscope", "model_name": "wan2.6-i2v"},
            {"provider": "dashscope", "model_name": "kling/kling-v3-video-generation"},
            {"provider": "seedance", "model_name": "doubao-seedance-2-0-260128"},
        ],
        redis_client=fake_redis,
        check_fn=fake_check,
        concurrency=2,
        record_state=False,
        sweep_source="manual-targets",
    )
    if [(item.get("provider"), item.get("model_name")) for item in target_results] != [
        ("dashscope", "wan2.6-i2v"),
        ("dashscope", "kling/kling-v3-video-generation"),
        ("seedance", "doubao-seedance-2-0-260128"),
    ]:
        fail(f"Target sweep did not dedupe by provider/model and preserve model_name: {target_results}")
    if not await monitor.get_cached_provider_health(
        "dashscope",
        model_name="kling/kling-v3-video-generation",
        redis_client=fake_redis,
    ):
        fail("Model-specific provider health cache row was not written")
    await monitor.cache_provider_health_result(
        {
            "success": True,
            "provider": "minimax",
            "model_name": "speech-2.8-hd",
            "status": "ok",
            "latency_ms": 88,
            "checked_at": "2026-07-10T00:00:00Z",
            "health": {
                "ok": True,
                "reachable": True,
                "auth_ok": True,
                "status_code": 200,
                "method": "POST",
                "real_generation": True,
                "output_type": "audio",
            },
        },
        redis_client=fake_redis,
    )
    real_generation_key = monitor.provider_health_cache_key(
        "minimax",
        "speech-2.8-hd",
    )
    if fake_redis.ttl.get(real_generation_key) != monitor.DEFAULT_REAL_GENERATION_HEALTH_TTL_SECONDS:
        fail(
            "Real generation health cache did not use the long TTL: "
            f"{fake_redis.ttl.get(real_generation_key)}"
        )
    preserved = await monitor.cache_provider_health_result(
        {
            "success": True,
            "provider": "minimax",
            "model_name": "speech-2.8-hd",
            "status": "connectivity_ok",
            "latency_ms": 3,
            "checked_at": "2026-07-10T00:01:00Z",
            "health": {
                "ok": False,
                "reachable": True,
                "auth_ok": True,
                "status_code": 200,
                "method": "GET",
                "error": "Metadata endpoint reachable, but generation is not verified.",
            },
        },
        redis_client=fake_redis,
    )
    if preserved.get("status") != "ok" or not (preserved.get("health") or {}).get("real_generation"):
        fail(f"Connectivity-only health downgraded verified generation health: {preserved}")
    if fake_redis.ttl.get(real_generation_key) != monitor.DEFAULT_REAL_GENERATION_HEALTH_TTL_SECONDS:
        fail("Connectivity-only health shortened the verified generation cache TTL")
    await monitor.cache_provider_health_result(
        {
            "success": True,
            "provider": "dashscope",
            "model_name": "custom-admin-model",
            "status": "ok",
            "latency_ms": 9,
            "checked_at": "2026-06-18T00:00:01Z",
            "health": {"ok": True, "reachable": True, "auth_ok": True, "status_code": 200},
        },
        redis_client=fake_redis,
    )
    cleared_custom = await monitor.delete_cached_provider_health_targets(
        [{"provider": "dashscope", "model_name": "custom-admin-model"}],
        redis_client=fake_redis,
    )
    if not cleared_custom:
        fail("Exact provider/model health target delete did not report a cleared custom model row")
    if await monitor.get_cached_provider_health("dashscope", model_name="custom-admin-model", redis_client=fake_redis):
        fail("Exact provider/model health target delete did not remove custom model cache row")
    all_redis = FakeRedis()
    await monitor.cache_provider_health_result(
        {
            "success": True,
            "provider": "custom-provider",
            "model_name": "admin-custom-model",
            "status": "ok",
            "latency_ms": 7,
            "checked_at": "2026-06-18T00:00:02Z",
            "health": {"ok": True, "reachable": True, "auth_ok": True, "status_code": 200},
        },
        redis_client=all_redis,
    )
    all_redis.store["not-provider-health:keep"] = "{}"
    cleared_all = await monitor.clear_all_cached_provider_health(redis_client=all_redis)
    if not any("custom-provider" in key for key in cleared_all):
        fail(f"Global provider health clear did not remove custom provider/model cache: {cleared_all}")
    if any(key.startswith(monitor.HEALTH_CACHE_PREFIX) for key in all_redis.store):
        fail(f"Global provider health clear left managed keys behind: {all_redis.store}")
    if "not-provider-health:keep" not in all_redis.store:
        fail("Global provider health clear removed an unrelated Redis key")

    clear_calls = 0
    fallback_calls = 0
    original_clear_all = config_cache.clear_all_cached_provider_health
    original_delete_many = config_cache.delete_cached_provider_health_many

    async def fake_clear_all():
        nonlocal clear_calls
        clear_calls += 1
        return ["provider:health:custom-provider:admin-custom-model"]

    async def fake_delete_many(_providers):
        nonlocal fallback_calls
        fallback_calls += 1
        return ["fallback"]

    config_cache.clear_all_cached_provider_health = fake_clear_all
    config_cache.delete_cached_provider_health_many = fake_delete_many
    try:
        service_clear = await config_cache.clear_all_provider_health_cache()
    finally:
        config_cache.clear_all_cached_provider_health = original_clear_all
        config_cache.delete_cached_provider_health_many = original_delete_many
    if service_clear != ["provider:health:custom-provider:admin-custom-model"] or clear_calls != 1 or fallback_calls:
        fail(f"API config health cache service global clear did not prefer prefix clear: clear={service_clear} calls={clear_calls}/{fallback_calls}")

    async def fake_empty_clear_all():
        return []

    config_cache.clear_all_cached_provider_health = fake_empty_clear_all
    config_cache.delete_cached_provider_health_many = fake_delete_many
    try:
        service_fallback = await config_cache.clear_all_provider_health_cache()
    finally:
        config_cache.clear_all_cached_provider_health = original_clear_all
        config_cache.delete_cached_provider_health_many = original_delete_many
    if service_fallback != ["fallback"] or fallback_calls != 1:
        fail(f"API config health cache service global clear did not fall back to provider catalog clear: {service_fallback}, calls={fallback_calls}")
    await monitor.delete_cached_provider_health("dashscope", redis_client=fake_redis)
    await monitor.delete_cached_provider_health("seedance", redis_client=fake_redis)
    if await monitor.get_cached_provider_health("dashscope", model_name="wan2.6-i2v", redis_client=fake_redis):
        fail("Provider health delete did not clear model-specific cache rows")

    cached = await monitor.get_cached_provider_health("deepseek", redis_client=fake_redis)
    if not cached or cached.get("status") != "ok" or cached.get("latency_ms") != 12:
        fail(f"Cached deepseek health changed: {cached}")

    if not await monitor.delete_cached_provider_health("deepseek", redis_client=fake_redis):
        fail("Health cache delete returned false for existing key")
    if await monitor.get_cached_provider_health("deepseek", redis_client=fake_redis):
        fail("Health cache delete did not remove cached provider row")
    await monitor.cache_provider_health_result(results[0], redis_client=fake_redis)

    cached_list = await monitor.list_cached_provider_health(
        ["deepseek", "gemini-text", "missing-provider"],
        redis_client=fake_redis,
    )
    if len(cached_list) != 2:
        fail(f"Expected two cached provider rows, got {cached_list}")
    rendered = json.dumps(cached_list, ensure_ascii=False)
    if "secret" in rendered.lower():
        fail("Provider health cache must not include API secrets")
    summary = monitor.summarize_provider_health_results(cached_list)
    if summary.get("total") != 2 or summary.get("ok") != 1 or summary.get("no_key") != 1:
        fail(f"Cached provider health summary changed: {summary}")
    cache_response = await admin_api_config_routes.admin_get_provider_health_cache()
    full_summary = {
        "total": 3,
        "ok": 2,
        "error": 0,
        "no_key": 1,
        "blocked_region": 0,
        "connectivity_ok": 0,
        "unknown": 0,
    }
    if cache_response.get("summary") != full_summary:
        fail(f"Admin health cache endpoint summary changed: {cache_response}")
    if len(cache_response.get("provider_health") or []) != 3:
        fail(f"Admin health cache endpoint did not return cached rows: {cache_response}")
    if "ttl_seconds" not in (cache_response.get("settings") or {}):
        fail(f"Admin health cache endpoint missing monitor settings: {cache_response}")
    monitor_state = cache_response.get("monitor_state") or {}
    if monitor_state.get("last_sweep_source") != "manual":
        fail(f"Admin health cache endpoint missing manual sweep source: {monitor_state}")
    if not monitor_state.get("last_sweep_completed_at"):
        fail(f"Provider monitor state missing completion timestamp: {monitor_state}")
    if monitor_state.get("last_summary") != summary:
        fail(f"Provider monitor state summary changed: {monitor_state}")
    if monitor_state.get("redis_configured") is not True:
        fail(f"Provider monitor state should report configured Redis: {monitor_state}")

    rows = [
        {
            "config_id": "apicfg_deepseek",
            "name": "DeepSeek",
            "provider": "deepseek",
            "endpoint": "https://api.deepseek.com",
            "api_key_encrypted": "encrypted-key",
            "model_name": "deepseek-reasoner",
            "proxy_mode": "direct",
            "custom_proxy": "",
            "category": "text",
            "enabled": True,
            "headers": {},
        }
    ]

    class FakeDAO:
        @staticmethod
        def decrypt_key(_value):
            return "secret"

        @staticmethod
        async def list_all():
            return copy.deepcopy(rows)

    original_dao = config_service.ApiConfigDAO
    config_service.ApiConfigDAO = FakeDAO
    try:
        listed = await config_service.list_api_configs()
    finally:
        config_service.ApiConfigDAO = original_dao
        monitor.set_provider_health_redis(None)

    provider_health = listed.get("provider_health") or []
    if len(provider_health) != 3:
        fail(f"list_api_configs did not include cached provider health: {provider_health}")
    if not (listed.get("monitor_state") or {}).get("last_sweep_completed_at"):
        fail(f"list_api_configs did not include provider monitor state: {listed.get('monitor_state')}")

    print("Provider health monitor contract OK")
    print("  cached_provider_health=2")
    print("  admin_health_cache_endpoint=1")
    print("  sweep_results=2")
    print("  sweep_target_model_checks=4")
    print("  exact_model_cache_delete_checks=2")
    print("  verified_generation_not_downgraded=1")
    print("  global_cache_clear_checks=5")
    print("  admin_reload_cache_clear_checks=2")
    print("  default_model_sweep_checks=3")
    print("  api_config_response_provider_health=3")
    print("  provider_monitor_state=1")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
