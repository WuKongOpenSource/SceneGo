#!/usr/bin/env python3
"""Verify API config DB->env hot-reload service without a real database."""
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

    from services import api_provider_registry as registry  # noqa: PLC0415

    managed_keys: set[str] = set()
    for env_key in registry.PROVIDER_ENV_MAP.values():
        managed_keys.add(env_key)
        managed_keys.add(registry.get_endpoint_env_key(env_key))
        managed_keys.add(registry.get_proxy_mode_env_key(env_key))
        managed_keys.add(registry.get_custom_proxy_env_key(env_key))
        managed_keys.add(registry.get_model_env_key(env_key))
    managed_keys.update(registry.SEEDANCE_SUB_MODEL_ENV_MAP.values())
    managed_keys.update(registry.DASHSCOPE_SUB_MODEL_ENV_MAP.values())
    for field_map in getattr(registry, "PROVIDER_EXTRA_ENV_MAP", {}).values():
        managed_keys.update(field_map.values())

    saved_env = {key: os.environ.get(key) for key in managed_keys}
    for key in managed_keys:
        os.environ.pop(key, None)

    os.environ["DEEPSEEK_API_KEY"] = "baseline-deepseek-key"
    os.environ["DEEPSEEK_ENDPOINT"] = "https://baseline.deepseek.example.test"

    from services import api_config_runtime_loader as loader  # noqa: PLC0415

    rows: list[dict[str, Any]] = [
        {
            "provider": "deepseek",
            "api_key_encrypted": "enc:db-deepseek-key",
            "endpoint": "https://db.deepseek.example.test",
            "model_name": "deepseek-runtime-model",
            "proxy_mode": "custom",
            "custom_proxy": "http://proxy.example.test:7890",
            "enabled": True,
        },
        {
            "provider": "gemini-text",
            "api_key_encrypted": "",
            "endpoint": "https://should-not-load.example.test",
            "proxy_mode": "direct",
            "custom_proxy": "",
            "enabled": True,
        },
        {
            "provider": "seedance",
            "api_key_encrypted": "enc:db-seedance-key",
            "endpoint": "https://db.seedance.example.test/tasks",
            "model_name": "doubao-seedance-standard-runtime",
            "proxy_mode": "direct",
            "custom_proxy": "",
            "enabled": True,
        },
        {
            "provider": "seedance",
            "api_key_encrypted": "enc:db-seedance-key",
            "endpoint": "https://db.seedance.example.test/tasks",
            "model_name": "doubao-seedance-fast-runtime",
            "proxy_mode": "direct",
            "custom_proxy": "",
            "enabled": True,
        },
        {
            "provider": "dashscope",
            "api_key_encrypted": "enc:db-dashscope-key",
            "endpoint": "https://db.dashscope.example.test/api/v1/services/aigc/video-generation/video-synthesis",
            "model_name": "wan2.6-runtime-i2v",
            "proxy_mode": "direct",
            "custom_proxy": "",
            "enabled": True,
        },
        {
            "provider": "dashscope",
            "api_key_encrypted": "enc:db-dashscope-key",
            "endpoint": "https://db.dashscope.example.test/api/v1/services/aigc/video-generation/video-synthesis",
            "model_name": "kling/kling-v3-video-generation",
            "proxy_mode": "direct",
            "custom_proxy": "",
            "enabled": True,
        },
        {
            "provider": "dashscope",
            "api_key_encrypted": "enc:db-dashscope-key",
            "endpoint": "https://db.dashscope.example.test/api/v1/services/aigc/video-generation/video-synthesis",
            "model_name": "kling/kling-v3-omni-video-generation",
            "proxy_mode": "direct",
            "custom_proxy": "",
            "enabled": True,
        },
        {
            "provider": "minimax",
            "api_key_encrypted": "enc:db-minimax-key",
            "endpoint": "https://db.minimax.example.test/v1",
            "model_name": "MiniMax-Hailuo-02",
            "proxy_mode": "direct",
            "custom_proxy": "",
            "request_template": {"group_id": "db-minimax-group"},
            "enabled": True,
        },
    ]
    rows.extend(
        {
            "provider": "dashscope",
            "api_key_encrypted": "enc:db-dashscope-key",
            "endpoint": "https://db.dashscope.example.test/api/v1/services/aigc/video-generation/video-synthesis",
            "model_name": model_name,
            "proxy_mode": "direct",
            "custom_proxy": "",
            "enabled": True,
        }
        for sub_model, model_name in registry.DASHSCOPE_DEFAULT_MODEL_MAP.items()
        if sub_model not in {"wan26", "kling-standard", "kling-omni"}
    )
    creates: list[dict[str, Any]] = []
    updates: list[tuple[str, dict[str, Any]]] = []

    class FakeDAO:
        @staticmethod
        async def list_enabled():
            return copy.deepcopy(rows)

        @staticmethod
        async def list_all():
            return copy.deepcopy(rows)

        @staticmethod
        def decrypt_key(value):
            if not value:
                return ""
            return str(value).replace("enc:", "", 1)

        @staticmethod
        async def create(**fields):
            creates.append(dict(fields))
            row = dict(fields)
            row["config_id"] = f"created_{len(creates)}"
            row["api_key_encrypted"] = ""
            rows.append(row)
            return copy.deepcopy(row)

        @staticmethod
        async def update(config_id, **fields):
            updates.append((config_id, dict(fields)))
            for row in rows:
                if row.get("config_id") == config_id:
                    row.update(fields)
                    return copy.deepcopy(row)
            return copy.deepcopy({"config_id": config_id, **fields})

    original_dao = loader.ApiConfigDAO
    loader.ApiConfigDAO = FakeDAO
    try:
        result = await loader.load_api_configs_to_env()
        if result.get("loaded") != 17:
            fail(f"Expected seventeen loaded keyed rows, got {result}")
        if os.environ.get("DEEPSEEK_API_KEY") != "db-deepseek-key":
            fail("DB key did not override baseline env key")
        if os.environ.get("DEEPSEEK_ENDPOINT") != "https://db.deepseek.example.test":
            fail("DB endpoint was not projected to env")
        if os.environ.get("DEEPSEEK_PROXY_MODE") != "custom":
            fail("DB proxy mode was not projected to env")
        if os.environ.get("DEEPSEEK_CUSTOM_PROXY") != "http://proxy.example.test:7890":
            fail("DB custom proxy was not projected to env")
        if os.environ.get("DEEPSEEK_MODEL") != "deepseek-runtime-model":
            fail("DB model_name was not projected to env")
        if os.environ.get("GEMINI_TEXT_API_KEY"):
            fail("Empty-key DB row should not load into env")
        if os.environ.get("SEEDANCE_MODEL_STANDARD") != "doubao-seedance-standard-runtime":
            fail("Seedance standard model was not projected to sub-model env")
        if os.environ.get("SEEDANCE_MODEL_FAST") != "doubao-seedance-fast-runtime":
            fail("Seedance fast model was not projected to sub-model env")
        if os.environ.get("DASHSCOPE_MODEL_WAN26") != "wan2.6-runtime-i2v":
            fail("DashScope Wan2.6 model was not projected to sub-model env")
        if os.environ.get("DASHSCOPE_MODEL_KLING_STANDARD") != "kling/kling-v3-video-generation":
            fail("DashScope Kling standard model was not projected to sub-model env")
        if os.environ.get("DASHSCOPE_MODEL_KLING_OMNI") != "kling/kling-v3-omni-video-generation":
            fail("DashScope Kling omni model was not projected to sub-model env")
        if os.environ.get("MINIMAX_GROUP_ID") != "db-minimax-group":
            fail("MiniMax group_id was not projected from request_template to env")
        for sub_model, model_name in registry.DASHSCOPE_DEFAULT_MODEL_MAP.items():
            if sub_model in {"wan26", "kling-standard", "kling-omni"}:
                continue
            env_key = registry.get_dashscope_sub_model_env_key(sub_model)
            if os.environ.get(env_key) != model_name:
                fail(f"DashScope {sub_model} model was not projected to {env_key}")

        rows[:] = [
            {
                "provider": "deepseek",
                "api_key_encrypted": "boom",
                "endpoint": "https://broken.example.test",
                "proxy_mode": "direct",
                "custom_proxy": "",
                "enabled": True,
            }
        ]
        before_error_key = os.environ.get("DEEPSEEK_API_KEY")
        before_error_endpoint = os.environ.get("DEEPSEEK_ENDPOINT")

        original_decrypt = FakeDAO.decrypt_key

        @staticmethod
        def broken_decrypt(value):
            raise RuntimeError("decrypt exploded")

        FakeDAO.decrypt_key = broken_decrypt
        failed = await loader.load_api_configs_to_env()
        FakeDAO.decrypt_key = original_decrypt
        if failed.get("success") is not False:
            fail(f"Expected failed reload result, got {failed}")
        if os.environ.get("DEEPSEEK_API_KEY") != before_error_key:
            fail("Failed reload changed existing DEEPSEEK_API_KEY")
        if os.environ.get("DEEPSEEK_ENDPOINT") != before_error_endpoint:
            fail("Failed reload changed existing DEEPSEEK_ENDPOINT")

        rows.clear()
        result = await loader.load_api_configs_to_env()
        if result.get("loaded") != 0:
            fail(f"Expected empty DB reload to load zero rows, got {result}")
        if os.environ.get("DEEPSEEK_API_KEY") != "baseline-deepseek-key":
            fail("Empty DB reload did not restore baseline env key")
        if os.environ.get("DEEPSEEK_ENDPOINT") != "https://baseline.deepseek.example.test":
            fail("Empty DB reload did not restore baseline endpoint")
        if os.environ.get("DEEPSEEK_CUSTOM_PROXY"):
            fail("Empty DB reload did not clear DB-only custom proxy")
        if os.environ.get("SEEDANCE_MODEL_STANDARD") or os.environ.get("SEEDANCE_MODEL_FAST"):
            fail("Empty DB reload did not clear Seedance sub-model env values")
        if os.environ.get("DASHSCOPE_MODEL_WAN26"):
            fail("Empty DB reload did not clear DashScope Wan2.6 sub-model env value")
        if os.environ.get("DASHSCOPE_MODEL_KLING_STANDARD") or os.environ.get("DASHSCOPE_MODEL_KLING_OMNI"):
            fail("Empty DB reload did not clear DashScope Kling sub-model env values")
        if os.environ.get("MINIMAX_GROUP_ID"):
            fail("Empty DB reload did not clear MiniMax group_id env value")
        for sub_model in registry.DASHSCOPE_DEFAULT_MODEL_MAP:
            if sub_model in {"wan26", "kling-standard", "kling-omni"}:
                continue
            env_key = registry.get_dashscope_sub_model_env_key(sub_model)
            if os.environ.get(env_key):
                fail(f"Empty DB reload did not clear DashScope {sub_model} sub-model env value")

        rows[:] = [
            {
                "config_id": "legacy_gemini",
                "provider": "gemini-image",
                "name": "Gemini 3 Pro Image",
                "model_name": "gemini-3-pro-image-preview",
                "endpoint": "https://api.laozhang.ai/v1beta",
                "api_key_encrypted": "",
                "enabled": False,
            },
            {
                "config_id": "legacy_sora2",
                "provider": "sora2",
                "name": "Sora2",
                "model_name": "sora-2",
                "endpoint": "https://api.laozhang.ai/v1",
                "api_key_encrypted": "",
                "enabled": False,
            },
            {
                "config_id": "legacy_veo",
                "provider": "veo",
                "name": "Veo",
                "model_name": "veo-3.1",
                "endpoint": "https://api.laozhang.ai/v1",
                "api_key_encrypted": "",
                "enabled": False,
            }
        ]
        creates.clear()
        updates.clear()
        seed = await loader.seed_default_api_providers()
        if seed.get("created") != 2:
            fail(f"Expected two GPT Image placeholders from registry, got {seed}")
        if seed.get("upgraded") != 3:
            fail(f"Expected three legacy model upgrades, got {seed}")
        created_providers = {item.get("provider") for item in creates}
        if created_providers != {"laozhang-gpt-image", "laozhang-sora2"}:
            fail(f"Unexpected seed providers: {created_providers}")
        disabled_updates = [fields for _, fields in updates if fields.get("enabled") is False]
        if len(disabled_updates) != 2:
            fail("Seed placeholders were not disabled")
        model_updates = [fields for _, fields in updates if fields.get("model_name") == loader.GEMINI_IMAGE_NEW_MODEL]
        if len(model_updates) != 1:
            fail("Legacy Gemini image model was not upgraded")
        sora2_updates = [fields for _, fields in updates if fields.get("model_name") == loader.SORA2_NEW_MODEL]
        if len(sora2_updates) != 1:
            fail("Legacy Sora2 model was not upgraded")
        veo_updates = [fields for _, fields in updates if fields.get("model_name") == loader.VEO_NEW_MODEL]
        if len(veo_updates) != 1:
            fail("Legacy Veo model was not upgraded")

    finally:
        loader.ApiConfigDAO = original_dao
        for key, value in saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    text = (root / "admin_routes.py").read_text(encoding="utf-8")
    if "from cluster_main import load_api_configs_to_env" in text:
        fail("admin_routes.py must not dynamically import cluster_main for API env reload")

    print("API config runtime loader contract OK")
    print("  hot_reload_loaded_rows=17")
    print("  seedance_sub_model_env_projection=2")
    print("  dashscope_wan26_env_projection=1")
    print("  dashscope_kling_env_projection=2")
    print("  dashscope_vidu_happyhorse_env_projection=10")
    print("  minimax_extra_env_projection=1")
    print("  baseline_restore=1")
    print("  seed_registry_placeholders=2")
    print("  legacy_model_upgrades=3")
    print("  admin_routes_no_cluster_import=1")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
