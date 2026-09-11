#!/usr/bin/env python3
"""Verify admin API preset import behavior without touching a real database."""
from __future__ import annotations

import asyncio
import copy
import os
import sys
from pathlib import Path
from typing import Any


def deploy_root() -> Path:
    return Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def managed_env_keys(registry) -> set[str]:
    keys: set[str] = set()
    for env_key in registry.PROVIDER_ENV_MAP.values():
        keys.add(env_key)
        keys.add(registry.get_endpoint_env_key(env_key))
        keys.add(registry.get_proxy_mode_env_key(env_key))
        keys.add(registry.get_custom_proxy_env_key(env_key))
        keys.add(registry.get_model_env_key(env_key))
    return keys


async def main() -> int:
    root = deploy_root()
    os.chdir(root)
    sys.path.insert(0, str(root))

    from services import api_config_import_service as import_service  # noqa: PLC0415
    from services import api_provider_registry as registry  # noqa: PLC0415

    keys = managed_env_keys(registry)
    saved_env = {key: os.environ.get(key) for key in keys}
    for key in keys:
        os.environ.pop(key, None)

    rows: list[dict[str, Any]] = []
    creates: list[dict[str, Any]] = []
    updates: list[tuple[str, dict[str, Any]]] = []
    invalidations: list[tuple[str, ...]] = []
    target_invalidations: list[tuple[tuple[str, str | None], ...]] = []
    reload_calls = 0

    class FakeDAO:
        @staticmethod
        async def list_all():
            return copy.deepcopy(rows)

        @staticmethod
        async def create(**fields):
            creates.append(dict(fields))
            row = dict(fields)
            row["config_id"] = f"created_{len(creates)}"
            row["api_key_encrypted"] = f"encrypted:{fields.get('api_key')}" if fields.get("api_key") else ""
            row["enabled"] = True
            rows.append(row)
            return row

        @staticmethod
        async def update(config_id, **fields):
            updates.append((config_id, dict(fields)))
            for row in rows:
                if row["config_id"] == config_id:
                    if "api_key" in fields:
                        row["api_key_encrypted"] = f"encrypted:{fields['api_key']}"
                    for key, value in fields.items():
                        if key != "api_key":
                            row[key] = value
                    return row
            return None

    async def fake_reload():
        nonlocal reload_calls
        reload_calls += 1
        return True

    async def fake_invalidate_items(items):
        providers: set[str] = set()
        targets: list[tuple[str, str | None]] = []
        seen_targets: set[tuple[str, str | None]] = set()
        for item in items:
            provider = str(item.get("provider") if isinstance(item, dict) else getattr(item, "provider", "") or "")
            provider = provider.strip()
            if not provider:
                continue
            providers.add(provider)
            model_name = str(item.get("model_name") if isinstance(item, dict) else getattr(item, "model_name", "") or "")
            model_name = model_name.strip() or None
            target_key = (provider, model_name)
            if target_key not in seen_targets:
                targets.append(target_key)
                seen_targets.add(target_key)
        provider_tuple = tuple(sorted(providers))
        invalidations.append(provider_tuple)
        target_invalidations.append(tuple(targets))
        return list(provider_tuple)

    try:
        original_dao = import_service.ApiConfigDAO
        original_invalidate_items = import_service.invalidate_provider_health_for_items
        import_service.ApiConfigDAO = FakeDAO
        import_service.invalidate_provider_health_for_items = fake_invalidate_items

        plain = await import_service.import_preset_api_configs(reload_api_env=fake_reload)
        if plain["copy_runtime_env_keys"]:
            fail("Plain preset import should not copy runtime keys")
        if plain["env_keys_imported"] != 0:
            fail(f"Plain import copied keys: {plain['env_keys_imported']}")
        if any(item.get("api_key") for item in creates):
            fail("Plain import created rows with API keys")
        if not invalidations or "deepseek" not in invalidations[-1]:
            fail(f"Plain import did not invalidate provider health cache: {invalidations}")

        rows.clear()
        creates.clear()
        updates.clear()
        invalidations.clear()
        target_invalidations.clear()
        reload_calls = 0
        os.environ["DASHSCOPE_API_KEY"] = "dashscope-secret"
        os.environ["DASHSCOPE_ENDPOINT"] = "https://dashscope.example.test/api/v1/services/aigc/video-generation/video-synthesis"
        body = import_service.ApiConfigImportOptions(copy_runtime_env_keys=True)
        dry_run = await import_service.import_preset_api_configs(
            import_service.ApiConfigImportOptions(copy_runtime_env_keys=True, dry_run=True),
            reload_api_env=fake_reload,
        )
        if not dry_run["dry_run"]:
            fail("Dry-run response did not mark dry_run=true")
        if dry_run["env_keys_imported"] != 1:
            fail(f"Dry-run expected one importable key, got {dry_run['env_keys_imported']}")
        if creates or updates:
            fail("Dry-run mutated fake database")
        if reload_calls:
            fail("Dry-run should not reload API env")
        if invalidations:
            fail("Dry-run should not invalidate provider health cache")

        copied = await import_service.import_preset_api_configs(body, reload_api_env=fake_reload)
        dashscope_keyed_creates = [
            item
            for item in creates
            if item.get("provider") == "dashscope" and item.get("api_key")
        ]
        if len(dashscope_keyed_creates) != 1:
            fail(f"Expected exactly one keyed DashScope row, got {len(dashscope_keyed_creates)}")
        dashscope_cards = [item for item in creates if item.get("provider") == "dashscope"]
        if len(dashscope_cards) != 1:
            fail(f"Expected one DashScope API card, got {len(dashscope_cards)}")
        expected_dashscope_bindings = registry.get_provider_model_binding_options(
            "dashscope",
            include_scopes=True,
        )
        actual_dashscope_bindings = dashscope_cards[0].get("model_bindings") or []
        expected_binding_keys = {
            (item.get("scope"), item.get("operation"))
            for item in expected_dashscope_bindings
        }
        actual_binding_keys = {
            (item.get("scope"), item.get("operation"))
            for item in actual_dashscope_bindings
        }
        if actual_binding_keys != expected_binding_keys:
            fail(f"DashScope API card did not receive all model bindings: {dashscope_cards[0]}")
        if copied["env_keys_imported"] != 1:
            fail(f"Expected one imported env key, got {copied['env_keys_imported']}")
        if copied["env_keys_skipped_provider_claimed"] != 0:
            fail("Provider-grouped import should not create duplicate key claims")
        if reload_calls != 1:
            fail(f"Expected reload once after copied import, got {reload_calls}")
        if copied.get("env_refreshed") is not True:
            fail(f"Copied import did not report env_refreshed=true: {copied}")
        if not invalidations or "dashscope" not in invalidations[-1]:
            fail(f"Copied import did not invalidate provider health cache: {invalidations}")

        rows[:] = [
            {
                "config_id": "apicfg_existing",
                "name": "existing gpt image",
                "provider": "laozhang-gpt-image",
                "model_name": "gpt-image-2-vip",
                "endpoint": "https://old.example.test/v1",
                "proxy_mode": "direct",
                "category": "image",
                "enabled": False,
                "api_key_encrypted": "",
            }
        ]
        creates.clear()
        updates.clear()
        invalidations.clear()
        target_invalidations.clear()
        reload_calls = 0
        for key in keys:
            os.environ.pop(key, None)
        os.environ["GPT_IMAGE_API_KEY"] = "gpt-image-secret"
        os.environ["GPT_IMAGE_ENDPOINT"] = "https://gpt-image.example.test/v1"
        copied_existing = await import_service.import_preset_api_configs(body, reload_api_env=fake_reload)
        if copied_existing["updated_existing"] != 1:
            fail(f"Expected existing empty key row to be updated, got {copied_existing['updated_existing']}")
        if copied_existing["enabled_existing"] != 1:
            fail(f"Expected existing disabled row to be enabled, got {copied_existing['enabled_existing']}")
        target = rows[0]
        if target["enabled"] is not True:
            fail("Existing row was not enabled")
        if target["api_key_encrypted"] == "" or "gpt-image-secret" not in target["api_key_encrypted"]:
            fail("Existing row did not receive runtime key in fake DAO")
        if target["endpoint"] != "https://gpt-image.example.test/v1":
            fail(f"Existing row endpoint was not updated: {target['endpoint']}")
        if copied_existing.get("env_refreshed") is not True:
            fail(f"Existing empty-key import did not report env_refreshed=true: {copied_existing}")
        if not invalidations or "laozhang-gpt-image" not in invalidations[-1]:
            fail(f"Existing empty-key import did not invalidate updated provider: {invalidations}")
        if ("laozhang-gpt-image", "gpt-image-2-vip") not in target_invalidations[-1]:
            fail(f"Existing empty-key import did not invalidate updated model target: {target_invalidations}")

    finally:
        if "import_service" in locals() and "original_dao" in locals():
            import_service.ApiConfigDAO = original_dao
        if "import_service" in locals() and "original_invalidate_items" in locals():
            import_service.invalidate_provider_health_for_items = original_invalidate_items
        for key in keys:
            value = saved_env.get(key)
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    api_config_routes_text = (root / "admin_api_config_routes.py").read_text(encoding="utf-8")
    if "copy_runtime_env_keys: bool = True" not in api_config_routes_text:
        fail("HTTP import-presets body default must copy runtime env keys")

    print("Admin API config import contract OK")
    print("  plain_import_copies_keys=0")
    print("  dashscope_keyed_rows=1")
    print("  existing_empty_key_update=1")
    print("  http_default_copies_runtime_keys=1")
    print("  provider_health_invalidations=1")
    print("  provider_model_health_invalidations=1")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
