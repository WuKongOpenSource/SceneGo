#!/usr/bin/env python3
"""Verify admin API config CRUD service without touching a real database."""
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


async def main() -> int:
    root = deploy_root()
    os.chdir(root)
    sys.path.insert(0, str(root))

    from services import api_config_reload_service as reload_service  # noqa: PLC0415
    from services import api_provider_registry as registry  # noqa: PLC0415
    from services import api_config_service as service  # noqa: PLC0415
    service_source = (root / "services" / "api_config_service.py").read_text(encoding="utf-8")

    rows: list[dict[str, Any]] = [
        {
            "config_id": "apicfg_existing",
            "name": "Existing DeepSeek",
            "provider": "deepseek",
            "endpoint": "https://api.deepseek.com",
            "api_key_encrypted": "encrypted-key",
            "model_name": "deepseek-reasoner",
            "proxy_mode": "direct",
            "custom_proxy": "",
            "category": "text",
            "enabled": True,
            "request_template": {},
            "headers": {},
        },
        {
            "config_id": "apicfg_empty",
            "name": "Empty GPT Image",
            "provider": "laozhang-gpt-image",
            "endpoint": "https://api.laozhang.ai/v1",
            "api_key_encrypted": "",
            "model_name": "gpt-image-2-vip",
            "proxy_mode": "direct",
            "custom_proxy": "",
            "category": "image",
            "enabled": False,
            "request_template": {},
            "headers": {},
        },
    ]
    creates: list[dict[str, Any]] = []
    updates: list[tuple[str, dict[str, Any]]] = []
    deletes: list[str] = []
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
            return copy.deepcopy(row)

        @staticmethod
        async def get_by_id(config_id):
            for row in rows:
                if row["config_id"] == config_id:
                    return copy.deepcopy(row)
            return None

        @staticmethod
        async def get_decrypted_key(config_id):
            row = await FakeDAO.get_by_id(config_id)
            if not row or not row.get("api_key_encrypted"):
                return None
            return "decrypted-key"

        @staticmethod
        def decrypt_key(encrypted):
            if not encrypted:
                return ""
            if str(encrypted).startswith("encrypted:"):
                return str(encrypted).split(":", 1)[1]
            return "decrypted-key"

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
                    return copy.deepcopy(row)
            return None

        @staticmethod
        async def delete(config_id):
            deletes.append(config_id)
            for idx, row in enumerate(rows):
                if row["config_id"] == config_id:
                    rows.pop(idx)
                    return True
            return False

    async def fake_reload():
        nonlocal reload_calls
        reload_calls += 1
        return True

    async def fake_invalidate_items(items):
        providers: list[str] = []
        targets: list[dict[str, str | None]] = []
        seen_providers: set[str] = set()
        seen_targets: set[tuple[str, str | None]] = set()
        for item in items:
            provider = str(item.get("provider") if isinstance(item, dict) else getattr(item, "provider", "") or "")
            provider = provider.strip()
            if not provider:
                continue
            if provider not in seen_providers:
                providers.append(provider)
                seen_providers.add(provider)
            model_name = str(item.get("model_name") if isinstance(item, dict) else getattr(item, "model_name", "") or "")
            model_name = model_name.strip() or None
            for target_model in (None, model_name):
                target_key = (provider, target_model)
                if target_key in seen_targets:
                    continue
                seen_targets.add(target_key)
                targets.append({"provider": provider, "model_name": target_model})
        invalidations.append(tuple(providers))
        normalized = tuple(
            (
                str(item.get("provider") or ""),
                str(item.get("model_name") or "").strip() or None,
            )
            for item in targets
        )
        target_invalidations.append(normalized)
        return sorted(set(providers))

    original_dao = service.ApiConfigDAO
    original_invalidate_items = service.invalidate_provider_health_for_items
    original_test_health = service.test_api_config_health
    original_load_api_env = reload_service.load_api_configs_to_env
    original_clear_all_health = reload_service.clear_all_provider_health_cache
    service.ApiConfigDAO = FakeDAO
    service.invalidate_provider_health_for_items = fake_invalidate_items
    try:
        presets = service.get_api_config_presets()
        preset_count = len(presets.get("presets") or [])
        provider_count = len(presets.get("providers") or [])
        # This facade must return the complete registry, including independent
        # billing channels. Comparing contents catches dropped/changed entries
        # without freezing the catalog size whenever a supported model is added.
        if not preset_count or presets.get("presets") != registry.get_api_model_presets():
            fail("preset facade differs from the provider registry")
        if not provider_count or presets.get("providers") != registry.get_api_provider_catalog():
            fail("provider facade differs from the provider registry")

        listed = await service.list_api_configs()
        if listed["api_configs"][0].get("api_key_encrypted") != "***":
            fail("list_api_configs did not mask encrypted API key")
        if listed["api_configs"][1].get("api_key_encrypted") != "":
            fail("list_api_configs should keep empty API key marker empty")
        if not listed.get("providers") or not listed.get("provider_status") or not listed.get("runtime_status"):
            fail("list_api_configs response missing provider/runtime metadata")

        created = await service.create_api_config(
            name="  New Config  ",
            provider=" deepseek ",
            endpoint=" https://api.example.test/v1 ",
            api_key="test-placeholder-credential",
            model_name="deepseek-chat",
            request_template={"group_id": "runtime-group"},
            headers={"X-Test": "yes"},
            reload_api_env=fake_reload,
        )
        if created["api_config"]["name"] != "New Config":
            fail("create_api_config did not trim name")
        if created["api_config"]["provider"] != "deepseek":
            fail("create_api_config did not trim provider")
        if created["api_config"]["endpoint"] != "https://api.example.test/v1":
            fail("create_api_config did not trim endpoint")
        if created["api_config"]["api_key_encrypted"] != "***":
            fail("create_api_config did not mask API key")
        if created["api_config"].get("request_template") != {"group_id": "runtime-group"}:
            fail("create_api_config did not persist request_template")
        if created["api_config"].get("headers") != {"X-Test": "yes"}:
            fail("create_api_config did not persist headers")
        if created.get("env_refreshed") is not True:
            fail(f"create_api_config did not report env_refreshed=true: {created}")
        if created.get("disabled_conflicting_config_ids") != ["apicfg_existing"]:
            fail(f"create_api_config did not disable same-provider keyed conflict: {created}")
        existing_after_create = next(row for row in rows if row["config_id"] == "apicfg_existing")
        if existing_after_create.get("enabled") is not False:
            fail("create_api_config did not disable previous active DeepSeek config")
        if reload_calls != 1:
            fail(f"create_api_config should reload once, got {reload_calls}")
        if invalidations[-1] != ("deepseek",):
            fail(f"create_api_config should invalidate created provider health cache: {invalidations}")
        if ("deepseek", "deepseek-v4-flash") not in target_invalidations[-1]:
            fail(f"create_api_config should invalidate created model health cache: {target_invalidations}")
        if ("deepseek", "deepseek-reasoner") not in target_invalidations[-1]:
            fail(f"create_api_config should invalidate disabled conflicting model health cache: {target_invalidations}")

        empty_update = await service.update_api_config("apicfg_existing", {}, reload_api_env=fake_reload)
        if empty_update["api_config"]["config_id"] != "apicfg_existing":
            fail("empty update did not return existing config")
        if reload_calls != 1:
            fail("empty update should not reload API env")
        if len(invalidations) != 1:
            fail("empty update should not invalidate provider health cache")
        if len(target_invalidations) != 1:
            fail("empty update should not invalidate provider/model health cache")

        updated = await service.update_api_config(
            "apicfg_existing",
            {"enabled": True, "api_key": "changed-secret"},
            reload_api_env=fake_reload,
        )
        if updated["api_config"]["enabled"] is not True:
            fail("update_api_config did not apply enabled=true")
        if updated["api_config"]["api_key_encrypted"] != "***":
            fail("update_api_config did not mask updated API key")
        if updated.get("disabled_conflicting_config_ids") != ["created_1"]:
            fail(f"update_api_config did not disable same-provider keyed conflict: {updated}")
        created_after_update = next(row for row in rows if row["config_id"] == "created_1")
        if created_after_update.get("enabled") is not False:
            fail("update_api_config did not disable previous active created config")
        if updated.get("env_refreshed") is not True:
            fail(f"update_api_config did not report env_refreshed=true: {updated}")
        if reload_calls != 2:
            fail(f"update_api_config should reload once, got {reload_calls}")
        if "deepseek" not in invalidations[-1]:
            fail(f"update_api_config should invalidate updated provider health cache: {invalidations}")
        if ("deepseek", "deepseek-reasoner") not in target_invalidations[-1]:
            fail(f"update_api_config should invalidate updated model health cache: {target_invalidations}")
        if ("deepseek", "deepseek-v4-flash") not in target_invalidations[-1]:
            fail(f"update_api_config should invalidate disabled conflicting model health cache: {target_invalidations}")

        previous_gpt_image_key = os.environ.pop("GPT_IMAGE_API_KEY", None)
        try:
            health = await service.test_saved_api_config_health("apicfg_empty")
            test = health.get("test") or {}
            if test.get("ok") is not False or test.get("error") != "No API key configured":
                fail(f"health wrapper result changed: {test}")
            if test.get("key_source") != "missing" or test.get("used_runtime_key") is not False:
                fail(f"health wrapper should report missing key source without runtime env: {test}")
        finally:
            if previous_gpt_image_key is not None:
                os.environ["GPT_IMAGE_API_KEY"] = previous_gpt_image_key

        async def fake_test_health(row, api_key):
            if api_key != "runtime-secret":
                fail(f"runtime fallback did not pass resolved API key: {api_key!r}")
            return {
                "success": True,
                "test": {
                    "ok": True,
                    "reachable": True,
                    "auth_ok": True,
                    "status_code": 200,
                    "url": row.get("endpoint"),
                    "error": None,
                    "provider": row.get("provider"),
                    "model_name": row.get("model_name"),
                    "method": "GET",
                    "urls_tried": [row.get("endpoint")],
                    "checked_at": "2026-06-20T00:00:00Z",
                },
            }

        previous_gpt_image_key = os.environ.get("GPT_IMAGE_API_KEY")
        previous_gpt_image_endpoint = os.environ.get("GPT_IMAGE_ENDPOINT")
        service.test_api_config_health = fake_test_health
        os.environ["GPT_IMAGE_API_KEY"] = "runtime-secret"
        os.environ["GPT_IMAGE_ENDPOINT"] = "https://runtime-gpt-image.example.test/v1"
        try:
            health = await service.test_saved_api_config_health("apicfg_empty")
            test = health.get("test") or {}
            if test.get("ok") is not True:
                fail(f"runtime fallback health should pass: {test}")
            if test.get("key_source") != "runtime" or test.get("key_env") != "GPT_IMAGE_API_KEY":
                fail(f"runtime fallback key source not reported: {test}")
            if test.get("used_runtime_key") is not True:
                fail(f"runtime fallback flag not reported: {test}")
            if test.get("endpoint_source") != "db" or test.get("used_runtime_endpoint") is not False:
                fail(f"DB config test should keep DB endpoint when present: {test}")
            if test.get("runtime_endpoint") != "https://runtime-gpt-image.example.test/v1":
                fail(f"runtime endpoint diagnostic not reported: {test}")
            if test.get("runtime_endpoint_source") != "GPT_IMAGE_ENDPOINT" or test.get("runtime_endpoint_env") != "GPT_IMAGE_ENDPOINT":
                fail(f"runtime endpoint source not reported: {test}")
            if test.get("endpoint_matches_runtime") is not False:
                fail(f"endpoint mismatch diagnostic not reported: {test}")
        finally:
            service.test_api_config_health = original_test_health
            if previous_gpt_image_key is None:
                os.environ.pop("GPT_IMAGE_API_KEY", None)
            else:
                os.environ["GPT_IMAGE_API_KEY"] = previous_gpt_image_key
            if previous_gpt_image_endpoint is None:
                os.environ.pop("GPT_IMAGE_ENDPOINT", None)
            else:
                os.environ["GPT_IMAGE_ENDPOINT"] = previous_gpt_image_endpoint

        if "async def _test_api_config_row_health(" not in service_source:
            fail("api_config_service must keep config health test shaping in _test_api_config_row_health()")
        try:
            shared_health_helper_source = service_source.split("async def _test_api_config_row_health", 1)[1].split(
                "async def _disable_conflicting_provider_configs",
                1,
            )[0]
            single_health_source = service_source.split("async def test_saved_api_config_health", 1)[1].split(
                "async def test_saved_api_config_real_generation",
                1,
            )[0]
            batch_health_source = service_source.split("async def test_all_saved_api_config_health", 1)[1]
        except IndexError:
            fail("Could not locate API config health test functions")
        if shared_health_helper_source.count("await ApiConfigDAO.get_decrypted_key(") != 1:
            fail("API config health tests should decrypt keys in one shared helper only")
        if "return await _test_api_config_row_health(row)" not in single_health_source:
            fail("test_saved_api_config_health must delegate to _test_api_config_row_health()")
        if "result = await _test_api_config_row_health(row" not in batch_health_source:
            fail("test_all_saved_api_config_health must delegate each row to _test_api_config_row_health()")
        for forbidden in (
            "await ApiConfigDAO.get_decrypted_key(",
            "_annotate_config_health_test(",
            "_test_row_and_endpoint_source(",
        ):
            if forbidden in single_health_source or forbidden in batch_health_source:
                fail(f"API config health entrypoints must not duplicate helper internals: {forbidden}")

        deleted = await service.delete_api_config("apicfg_empty", reload_api_env=fake_reload)
        if deleted != {"success": True, "deleted": True, "env_refreshed": True}:
            fail(f"delete_api_config result changed: {deleted}")
        if reload_calls != 3:
            fail(f"delete_api_config should reload once, got {reload_calls}")
        if invalidations[-1] != ("laozhang-gpt-image",):
            fail(f"delete_api_config should invalidate deleted provider health cache: {invalidations}")
        if ("laozhang-gpt-image", "gpt-image-2-vip") not in target_invalidations[-1]:
            fail(f"delete_api_config should invalidate deleted model health cache: {target_invalidations}")

        try:
            await service.delete_api_config("missing", reload_api_env=fake_reload)
            fail("delete_api_config should raise ApiConfigNotFound for missing id")
        except service.ApiConfigNotFound:
            pass

        rows[:] = [
            {
                "config_id": "dup_old",
                "name": "A MiniMax old",
                "provider": "minimax",
                "endpoint": "https://minimax-old.example.test/v1",
                "api_key_encrypted": "encrypted:old-secret",
                "model_name": "MiniMax-Hailuo-02",
                "proxy_mode": "direct",
                "custom_proxy": "",
                "category": "video",
                "enabled": True,
                "headers": {},
            },
            {
                "config_id": "dup_winner",
                "name": "Z MiniMax winner",
                "provider": "minimax",
                "endpoint": "https://minimax-winner.example.test/v1",
                "api_key_encrypted": "encrypted:winner-secret",
                "model_name": "MiniMax-Hailuo-02",
                "proxy_mode": "direct",
                "custom_proxy": "",
                "category": "video",
                "enabled": True,
                "headers": {},
            },
            {
                "config_id": "dup_empty",
                "name": "MiniMax empty",
                "provider": "minimax",
                "endpoint": "https://minimax-empty.example.test/v1",
                "api_key_encrypted": "",
                "model_name": "MiniMax-Hailuo-02",
                "proxy_mode": "direct",
                "custom_proxy": "",
                "category": "video",
                "enabled": True,
                "headers": {},
            },
            {
                "config_id": "solo",
                "name": "Solo DeepSeek",
                "provider": "deepseek",
                "endpoint": "https://deepseek.example.test",
                "api_key_encrypted": "encrypted-solo",
                "model_name": "deepseek-reasoner",
                "proxy_mode": "direct",
                "custom_proxy": "",
                "category": "text",
                "enabled": True,
                "headers": {},
            },
        ]
        reload_before_repair = reload_calls
        dry = await service.repair_api_config_provider_conflicts(
            reload_api_env=fake_reload,
            dry_run=True,
        )
        if (
            dry.get("total_conflicts") != 1
            or dry.get("would_disable") != 1
            or dry.get("total_disabled") != 0
            or dry.get("would_absorb_placeholders") != 1
        ):
            fail(f"repair dry_run summary changed: {dry}")
        if any(row["config_id"] == "dup_old" and row.get("enabled") is False for row in rows):
            fail("repair dry_run disabled a row")
        if reload_calls != reload_before_repair:
            fail("repair dry_run should not reload API env")

        repaired = await service.repair_api_config_provider_conflicts(reload_api_env=fake_reload)
        if (
            repaired.get("total_conflicts") != 1
            or repaired.get("total_disabled") != 1
            or repaired.get("total_absorbed_placeholder_groups") != 1
        ):
            fail(f"repair summary changed: {repaired}")
        conflict = repaired.get("conflicts", [{}])[0]
        if conflict.get("kept_config_id") != "dup_winner" or conflict.get("disabled_config_ids") != ["dup_old"]:
            fail(f"repair kept/disabled wrong rows: {repaired}")
        if next(row for row in rows if row["config_id"] == "dup_old").get("enabled") is not False:
            fail("repair did not disable old duplicate")
        if next(row for row in rows if row["config_id"] == "dup_winner").get("enabled") is not True:
            fail("repair disabled winning duplicate")
        if any(row["config_id"] == "dup_empty" for row in rows):
            fail("repair should absorb and delete keyless model placeholders")
        if repaired.get("deleted_placeholder_config_ids") != ["dup_empty"]:
            fail(f"repair should report deleted placeholders: {repaired}")
        if reload_calls != reload_before_repair + 1:
            fail("repair should reload API env exactly once")
        if invalidations[-1] != ("minimax",):
            fail(f"repair should invalidate repaired provider health cache: {invalidations}")
        if ("minimax", "MiniMax-Hailuo-02") not in target_invalidations[-1]:
            fail(f"repair should invalidate repaired model health cache: {target_invalidations}")

        default_reload_calls = 0

        async def fake_default_load_api_env():
            nonlocal default_reload_calls
            default_reload_calls += 1
            return {
                "success": True,
                "loaded": 1,
                "loaded_providers": ["deepseek"],
                "error": None,
            }

        reload_service.load_api_configs_to_env = fake_default_load_api_env
        default_reloaded = await service.update_api_config("solo", {"enabled": False})
        if default_reloaded.get("env_refreshed") is not True:
            fail(f"default service reload did not report env_refreshed=true: {default_reloaded}")
        if default_reload_calls != 1:
            fail(f"default service reload should call runtime loader once, got {default_reload_calls}")

        reload_cache_clears = 0

        async def fake_load_api_env_success():
            return {
                "success": True,
                "loaded": 2,
                "loaded_providers": ["deepseek", "minimax"],
                "error": None,
            }

        async def fake_clear_all_health():
            nonlocal reload_cache_clears
            reload_cache_clears += 1
            return ["provider:health:deepseek"]

        reload_service.load_api_configs_to_env = fake_load_api_env_success
        reload_service.clear_all_provider_health_cache = fake_clear_all_health
        reload_result = await reload_service.reload_api_env_runtime(clear_health_cache=True)
        if reload_result.get("env_refreshed") is not True or reload_result.get("loaded") != 2:
            fail(f"reload_api_env_runtime success response changed: {reload_result}")
        if reload_result.get("health_cache_invalidated") != ["provider:health:deepseek"]:
            fail(f"reload_api_env_runtime did not clear health cache: {reload_result}")
        if reload_cache_clears != 1:
            fail(f"reload_api_env_runtime should clear health cache once on success, got {reload_cache_clears}")

        async def fake_load_api_env_failure():
            return {"success": False, "error": "reload exploded"}

        reload_service.load_api_configs_to_env = fake_load_api_env_failure
        try:
            await reload_service.reload_api_env_runtime(clear_health_cache=True)
            fail("reload_api_env_runtime should raise ApiConfigReloadFailed on unsuccessful loader result")
        except reload_service.ApiConfigReloadFailed:
            pass
        if reload_cache_clears != 2:
            fail(f"reload_api_env_runtime should clear health cache once on failure, got {reload_cache_clears}")

    finally:
        service.ApiConfigDAO = original_dao
        service.invalidate_provider_health_for_items = original_invalidate_items
        service.test_api_config_health = original_test_health
        reload_service.load_api_configs_to_env = original_load_api_env
        reload_service.clear_all_provider_health_cache = original_clear_all_health

    print("Admin API config CRUD contract OK")
    print("  list_masks_key=1")
    print(f"  presets_facade={preset_count}/{provider_count}")
    print("  create_update_delete_reload_calls=3")
    print("  empty_update_reload_calls=0")
    print("  same_provider_conflict_disabled=1")
    print("  historical_conflict_repair=1")
    print("  provider_health_invalidations=4")
    print("  provider_model_health_invalidations=4")
    print("  health_wrapper_no_key=1")
    print("  health_wrapper_runtime_key_fallback=1")
    print("  health_wrapper_endpoint_diagnostics=1")
    print("  shared_health_test_helper=1")
    print("  default_service_reload_checks=1")
    print("  reload_service_checks=2")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
