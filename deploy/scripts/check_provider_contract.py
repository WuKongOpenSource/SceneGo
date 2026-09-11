#!/usr/bin/env python3
"""Verify OSTORY external API provider registry and resolver contract."""
from __future__ import annotations

import ast
import json
import os
import sys
from pathlib import Path
from typing import Any, Iterable


EXPECTED_RUNTIME_WIRING: dict[str, set[str]] = {
    "services/ai_proxy_deepseek_service.py": {"deepseek"},
    "services/ai_proxy_doubao_image_service.py": {"doubao"},
    "services/ai_proxy_gemini_text_service.py": {"gemini-text"},
    "services/ai_proxy_gemini_image_service.py": {"gemini-image"},
    "external_api/audio/minimax_audio.py": {"minimax"},
    "external_api/video/minimax.py": {"minimax"},
    "external_api/video/sora2.py": {"sora2"},
    "external_api/video/veo.py": {"veo"},
    "external_api/video/seedance.py": {"seedance"},
    "external_api/video/dashscope.py": {"dashscope"},
    "external_api/video/wan2.py": {"dashscope"},
}

EXPECTED_RUNTIME_DELEGATION: dict[str, tuple[str, ...]] = {
    "services/ai_proxy_gpt_image_service.py": (
        'provider = tier_config["provider"]',
        'model = tier_config["model"]',
        "config = resolve_provider(provider, model)",
    ),
    "services/video_reverse_service.py": (
        "generate_gemini_chat_result(",
        "allow_failover=False",
    ),
}

EXTERNAL_API_RUNTIME_REFRESH_METHODS: dict[str, dict[str, Any]] = {
    "external_api/audio/minimax_audio.py": {
        "class": "MinimaxAudioClient",
        "methods": {
            "voice_design",
            "voice_clone",
            "list_voices",
            "delete_voice",
            "tts_sync",
            "tts_async",
            "tts_query",
            "tts_wait_and_download",
            "music_generate",
            "lyrics_generate",
            "file_upload",
            "file_retrieve",
            "file_delete",
        },
        "refresh_via": {"_refresh_runtime_config", "_url", "_request_json", "_download_bytes"},
    },
    "external_api/video/minimax.py": {
        "class": "MinimaxClient",
        "methods": {"generate_video", "query_task", "download_video"},
        "refresh_via": {"_refresh_runtime_config"},
    },
    "external_api/video/sora2.py": {
        "class": "Sora2Client",
        "methods": {"create_video_task", "query_task", "download_video"},
        "refresh_via": {"_refresh_runtime_config"},
    },
    "external_api/video/veo.py": {
        "class": "VeoClient",
        "methods": {"create_video_task", "query_task", "get_video_content", "download_video"},
        "refresh_via": {"_refresh_runtime_config"},
    },
    "external_api/video/seedance.py": {
        "class": "SeedanceClient",
        "methods": {"create_video_task", "query_task", "download_video"},
        "refresh_via": {"_refresh_runtime_config"},
        "pinned_methods": {"query_task", "download_video"},
    },
    "external_api/video/dashscope.py": {
        "class": "DashScopeVideoClient",
        "methods": {"create_task", "query_task"},
        "refresh_via": {"_refresh_runtime_config"},
    },
    "external_api/video/wan2.py": {
        "class": "Wan26Client",
        "methods": {"create_video_task", "query_task", "download_video"},
        "refresh_via": {"_refresh_runtime_config"},
    },
}

EXPECTED_GPT_IMAGE_TIER_PROVIDERS = {"laozhang-gpt-image", "laozhang-sora2"}


def deploy_root() -> Path:
    return Path(__file__).resolve().parents[1]


def import_registry_modules():
    root = deploy_root()
    sys.path.insert(0, str(root))
    from services import api_provider_registry as registry  # noqa: PLC0415
    from services.api_provider_runtime import (  # noqa: PLC0415
        build_effective_provider_config_sources,
        build_provider_runtime_status,
        normalize_provider_health_map,
        resolve_provider,
        resolve_provider_with_failover,
    )

    return (
        registry,
        resolve_provider,
        resolve_provider_with_failover,
        build_provider_runtime_status,
        build_effective_provider_config_sources,
        normalize_provider_health_map,
    )


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def managed_env_keys(registry) -> set[str]:
    keys: set[str] = set()
    for field_map in getattr(registry, "PROVIDER_EXTRA_ENV_MAP", {}).values():
        keys.update(field_map.values())
    for env_key in registry.PROVIDER_ENV_MAP.values():
        keys.add(env_key)
        keys.add(registry.get_endpoint_env_key(env_key))
        keys.add(registry.get_proxy_mode_env_key(env_key))
        keys.add(registry.get_custom_proxy_env_key(env_key))
        keys.add(registry.get_model_env_key(env_key))
    return keys


def isolated_env(registry):
    keys = managed_env_keys(registry)
    saved = {key: os.environ.get(key) for key in keys}

    class EnvGuard:
        def __enter__(self):
            for key in keys:
                os.environ.pop(key, None)
            return self

        def __exit__(self, exc_type, exc, tb):
            for key, value in saved.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    return EnvGuard()


def check_registry_shape(registry) -> None:
    registry_text = (deploy_root() / "services" / "api_provider_registry.py").read_text(encoding="utf-8")
    runtime_text = (deploy_root() / "services" / "api_provider_runtime.py").read_text(encoding="utf-8")
    ai_proxy_text = (deploy_root() / "services" / "ai_proxy_service.py").read_text(encoding="utf-8")
    external_operation_clients = {
        "external_api/video/minimax.py": (
            'self._url_for_operation("video_generation")',
            'self._url_for_operation("query_video_generation")',
            'self._url_for_operation("files_retrieve")',
        ),
        "external_api/video/sora2.py": (
            'self._url_for_operation("videos")',
            'self._url_for_operation("video", video_id=video_id)',
            'self._url_for_operation("video_content", video_id=video_id)',
        ),
        "external_api/video/veo.py": (
            'self._url_for_operation("chat_completions")',
            'self._url_for_operation("video", video_id=video_id)',
            'self._url_for_operation("video_content", video_id=video_id)',
        ),
        "external_api/video/seedance.py": (
            'config.url_for_operation("task", task_id=task_id)',
        ),
        "external_api/audio/minimax_audio.py": (
            "url = self._runtime_config.url_for_operation(operation)",
            '"voice_clone"',
            '"tts_sync"',
            '"files_upload"',
            '"files_retrieve"',
        ),
    }
    external_direct_path_snippets = (
        'f"{self.base_url}/video_generation"',
        'f"{self.base_url}/query/video_generation"',
        'f"{self.base_url}/files/retrieve"',
        'f"{self.base_url}/videos"',
        'f"{self.base_url}/videos/{video_id}"',
        'f"{self.base_url}/videos/{video_id}/content"',
        'f"{self.base_url}/chat/completions"',
        'f"{self.base_url.rstrip(\'/\')}/{task_id}"',
        'f"{self.base_url}{path}"',
    )
    if "PROVIDER_HEALTH_CHECK_URLS" in registry_text:
        fail("Provider health URLs must be derived from preset endpoints, not a duplicate PROVIDER_HEALTH_CHECK_URLS map")
    if "PROVIDER_HEALTH_CHECKS" in registry_text:
        fail("Provider health checks must use default metadata plus PROVIDER_HEALTH_CHECK_OVERRIDES")
    if "PROVIDER_CREDENTIAL_LINKS" in registry_text:
        fail("Provider credential docs/console links must use VENDOR_CREDENTIAL_LINKS plus PROVIDER_KEY_HELP")
    if "derive_models_health_urls" not in registry_text:
        fail("api_provider_registry.py must derive provider health URLs from services.api_provider_endpoints")
    if "PROVIDER_API_PATHS" not in registry_text:
        fail("api_provider_registry.py must define provider API operation paths")
    if "def get_provider_api_path" not in registry_text:
        fail("api_provider_registry.py must expose get_provider_api_path()")
    if "def get_provider_operation_paths" not in registry_text:
        fail("api_provider_registry.py must expose get_provider_operation_paths() for admin catalog metadata")
    if "def build_provider_operation_url_templates" not in registry_text:
        fail("api_provider_registry.py must expose build_provider_operation_url_templates() for admin URL previews")
    if '"operation_paths": get_provider_operation_paths(provider)' not in registry_text:
        fail("api_provider_registry.py must expose operation_paths in provider catalog responses")
    if '"default_operation_url_templates": build_provider_operation_url_templates(' not in registry_text:
        fail("api_provider_registry.py must expose default_operation_url_templates in provider catalog responses")
    if "def url_for_operation" not in runtime_text or "get_provider_api_path" not in runtime_text:
        fail("api_provider_runtime.py must expose ResolvedProviderConfig.url_for_operation()")
    if "def operation_url_templates" not in runtime_text or '"operation_urls": resolved.operation_url_templates()' not in runtime_text:
        fail("api_provider_runtime.py must expose resolved operation URL templates in runtime status")
    for forbidden in (
        'url_for("chat/completions"',
        'url_for("images/edits"',
        'url_for("images/generations"',
        'url_for(f"models/{model}:generateContent"',
    ):
        if forbidden in ai_proxy_text:
            fail(f"ai_proxy_service.py must use url_for_operation(), not direct provider path {forbidden}")
    for relative_path, required_snippets in external_operation_clients.items():
        path = deploy_root() / relative_path
        text = path.read_text(encoding="utf-8")
        for snippet in required_snippets:
            if snippet not in text:
                fail(f"{relative_path} must resolve provider operation paths through registry: {snippet}")
        for forbidden in external_direct_path_snippets:
            if forbidden in text:
                fail(f"{relative_path} must not build provider API paths directly: {forbidden}")
    if "out.setdefault(\"endpoint\", get_provider_default_endpoint(provider))" not in registry_text:
        fail("api_provider_registry.py must enrich preset endpoints from get_provider_default_endpoint()")
    if "out.setdefault(\"category\", get_provider_default_category(provider))" not in registry_text:
        fail("api_provider_registry.py must enrich preset category from provider capabilities")
    if "DEFAULT_PROVIDER_PROXY_MODE = \"direct\"" not in registry_text:
        fail("api_provider_registry.py must define DEFAULT_PROVIDER_PROXY_MODE")
    if "DEFAULT_PROVIDER_SUPPORTS_PROXY = True" not in registry_text:
        fail("api_provider_registry.py must define DEFAULT_PROVIDER_SUPPORTS_PROXY")
    if "_provider_meta.setdefault(\"default_proxy_mode\", DEFAULT_PROVIDER_PROXY_MODE)" not in registry_text:
        fail("api_provider_registry.py must apply provider default_proxy_mode through setdefault")
    if "_provider_meta.setdefault(\"supports_proxy\", DEFAULT_PROVIDER_SUPPORTS_PROXY)" not in registry_text:
        fail("api_provider_registry.py must apply provider supports_proxy through setdefault")
    if "_provider_meta.setdefault(\"required_env\", [PROVIDER_ENV_MAP[_provider_id]])" not in registry_text:
        fail("api_provider_registry.py must derive provider required_env from PROVIDER_ENV_MAP")
    if "\"required_env\": [" in registry_text:
        fail("Provider catalog entries must not repeat required_env; use PROVIDER_ENV_MAP")
    if "DEFAULT_PROVIDER_FALLBACK_ENV" not in registry_text:
        fail("api_provider_registry.py must define DEFAULT_PROVIDER_FALLBACK_ENV")
    if "PROVIDER_FALLBACK_ENV_OVERRIDES" not in registry_text:
        fail("api_provider_registry.py must define provider fallback env overrides")
    if "PROVIDER_FALLBACK_ENV_OVERRIDES.get(_provider_id, DEFAULT_PROVIDER_FALLBACK_ENV)" not in registry_text:
        fail("api_provider_registry.py must derive fallback_env from default plus provider overrides")
    if "\"fallback_env\": []" in registry_text or "\"fallback_env\": [\"" in registry_text:
        fail("Provider catalog entries must not repeat fallback_env; use PROVIDER_FALLBACK_ENV_OVERRIDES")
    if "VENDOR_CREDENTIAL_LINKS" not in registry_text:
        fail("api_provider_registry.py must define VENDOR_CREDENTIAL_LINKS")
    if "PROVIDER_KEY_HELP" not in registry_text:
        fail("api_provider_registry.py must define PROVIDER_KEY_HELP")
    if "VENDOR_CREDENTIAL_LINKS.get(_provider_meta.get(\"vendor\", \"\"), {})" not in registry_text:
        fail("api_provider_registry.py must derive docs/console links from provider vendor")
    if "_credential_links[\"key_help\"] = PROVIDER_KEY_HELP[_provider_id]" not in registry_text:
        fail("api_provider_registry.py must derive key_help from PROVIDER_KEY_HELP")
    if "DEFAULT_PROVIDER_HEALTH_CHECK" not in registry_text:
        fail("api_provider_registry.py must define DEFAULT_PROVIDER_HEALTH_CHECK")
    if "PROVIDER_HEALTH_CHECK_OVERRIDES" not in registry_text:
        fail("api_provider_registry.py must define provider health check overrides")
    if "_health_check.update(PROVIDER_HEALTH_CHECK_OVERRIDES.get(_provider_id, {}))" not in registry_text:
        fail("api_provider_registry.py must merge provider health check overrides into the default health check")
    if "\"default_proxy_mode\": \"direct\"" in registry_text:
        fail("Provider catalog entries must not repeat the default proxy mode literal")
    if "\"supports_proxy\": True" in registry_text:
        fail("Provider catalog entries must not repeat the default supports_proxy literal")
    if "out.setdefault(\"proxy_mode\", meta.get(\"default_proxy_mode\", DEFAULT_PROVIDER_PROXY_MODE))" not in registry_text:
        fail("api_provider_registry.py must enrich preset proxy_mode from provider default_proxy_mode")
    if "out.setdefault(\"supports_proxy\", meta.get(\"supports_proxy\", DEFAULT_PROVIDER_SUPPORTS_PROXY))" not in registry_text:
        fail("api_provider_registry.py must enrich preset supports_proxy from provider supports_proxy")

    provider_env_keys = set(registry.PROVIDER_ENV_MAP)
    catalog_keys = set(registry.PROVIDER_CATALOG)
    if provider_env_keys != catalog_keys:
        fail(
            "Provider catalog/env map mismatch: "
            f"env_only={sorted(provider_env_keys - catalog_keys)}, "
            f"catalog_only={sorted(catalog_keys - provider_env_keys)}"
        )

    default_endpoint_keys = set(getattr(registry, "PROVIDER_DEFAULT_ENDPOINTS", {}))
    if default_endpoint_keys != catalog_keys:
        fail(
            "Provider default endpoint map mismatch: "
            f"endpoint_only={sorted(default_endpoint_keys - catalog_keys)}, "
            f"catalog_only={sorted(catalog_keys - default_endpoint_keys)}"
        )
    for provider, endpoint in getattr(registry, "PROVIDER_DEFAULT_ENDPOINTS", {}).items():
        if not endpoint:
            fail(f"{provider} default endpoint is empty")
        if registry.get_provider_default_endpoint(provider) != endpoint:
            fail(f"get_provider_default_endpoint({provider!r}) did not return map value")
    for provider, operations in getattr(registry, "PROVIDER_API_PATHS", {}).items():
        if provider not in registry.PROVIDER_CATALOG:
            fail(f"Provider API path map references unknown provider {provider}")
        for operation, path in operations.items():
            if not operation:
                fail(f"{provider} API path operation is empty")
            if not isinstance(path, str):
                fail(f"{provider}.{operation} API path must be a string")
        copied = registry.get_provider_operation_paths(provider)
        if copied != operations:
            fail(f"get_provider_operation_paths({provider!r}) should return provider operation map")
        copied["__mutation_check__"] = "x"
        if "__mutation_check__" in registry.PROVIDER_API_PATHS.get(provider, {}):
            fail("get_provider_operation_paths() must return a copy, not the registry dict")
        default_endpoint = registry.get_provider_default_endpoint(provider)
        url_templates = registry.build_provider_operation_url_templates(provider, default_endpoint)
        for operation, path in operations.items():
            base = default_endpoint.rstrip("/")
            suffix = path.strip("/") if path else ""
            if not suffix:
                expected_url = base
            elif base.endswith(f"/{suffix}"):
                expected_url = base
            else:
                expected_url = f"{base}/{suffix}"
            if url_templates.get(operation) != expected_url:
                fail(f"{provider}.{operation} default operation URL mismatch: {url_templates.get(operation)} != {expected_url}")
    for preset in getattr(registry, "API_MODEL_PRESETS", []):
        provider = registry.normalize_provider(preset.get("provider", ""))
        if "endpoint" in preset:
            fail("Raw API_MODEL_PRESETS entries must not carry endpoint; use PROVIDER_DEFAULT_ENDPOINTS")
        if "proxy_mode" in preset:
            fail("Raw API_MODEL_PRESETS entries must not carry proxy_mode; use PROVIDER_CATALOG.default_proxy_mode")
        raw_category = str(preset.get("category") or "").strip()
        if raw_category:
            default_category = registry.get_provider_default_category(provider)
            if raw_category == default_category:
                fail("Raw API_MODEL_PRESETS entries must not repeat provider default category")
            capabilities = set(registry.PROVIDER_CATALOG.get(provider, {}).get("capabilities") or [])
            if raw_category not in capabilities:
                fail(f"Raw preset category override {raw_category!r} is not in {provider} capabilities")

    env_values = list(registry.PROVIDER_ENV_MAP.values())
    if len(env_values) != len(set(env_values)):
        fail("Duplicate provider env values found")
    extra_env_values = [
        value
        for field_map in getattr(registry, "PROVIDER_EXTRA_ENV_MAP", {}).values()
        for value in field_map.values()
    ]
    if len(extra_env_values) != len(set(extra_env_values)):
        fail("Duplicate provider extra env values found")
    for provider in getattr(registry, "PROVIDER_EXTRA_ENV_MAP", {}):
        if provider not in registry.PROVIDER_CATALOG:
            fail(f"Extra env map references unknown provider {provider}")
    for provider, fields in getattr(registry, "PROVIDER_EXTRA_FIELD_CATALOG", {}).items():
        if provider not in registry.PROVIDER_CATALOG:
            fail(f"Extra field catalog references unknown provider {provider}")
        env_map = registry.get_provider_extra_env_keys(provider)
        seen_fields: set[str] = set()
        for item in fields:
            field = str(item.get("field") or "").strip().lower()
            if not field:
                fail(f"{provider} extra field missing field id")
            if field in seen_fields:
                fail(f"{provider} duplicate extra field {field}")
            seen_fields.add(field)
            if field not in env_map:
                fail(f"{provider} extra field {field} missing env mapping")
            if item.get("target") not in {None, "request_template", "headers"}:
                fail(f"{provider} extra field {field} has unsupported target {item.get('target')}")

    for provider, meta in registry.PROVIDER_CATALOG.items():
        if not meta.get("label"):
            fail(f"{provider} missing label")
        if not meta.get("capabilities"):
            fail(f"{provider} missing capabilities")
        vendor_links = registry.VENDOR_CREDENTIAL_LINKS.get(meta.get("vendor"), {})
        if not vendor_links:
            fail(f"{provider} vendor {meta.get('vendor')} missing credential links")
        if provider not in registry.PROVIDER_KEY_HELP:
            fail(f"{provider} missing provider key_help text")
        for link_key in ("docs_url", "console_url"):
            if meta.get(link_key) != vendor_links.get(link_key):
                fail(f"{provider} {link_key} should be derived from vendor credential links")
        if meta.get("key_help") != registry.PROVIDER_KEY_HELP[provider]:
            fail(f"{provider} key_help should be derived from PROVIDER_KEY_HELP")
        if registry.PROVIDER_ENV_MAP[provider] not in (meta.get("required_env") or []):
            fail(f"{provider} required_env must include primary env key")
        if meta.get("required_env") != [registry.PROVIDER_ENV_MAP[provider]]:
            fail(f"{provider} required_env should be derived from PROVIDER_ENV_MAP")
        if provider in {"gemini-text", "gemini-image"} and meta.get("fallback_env"):
            fail(f"{provider} must not fallback to shared GEMINI_API_KEY env")
        expected_fallback_env = registry.PROVIDER_FALLBACK_ENV_OVERRIDES.get(
            provider,
            registry.DEFAULT_PROVIDER_FALLBACK_ENV,
        )
        if meta.get("fallback_env") != list(expected_fallback_env):
            fail(f"{provider} fallback_env should be derived from provider fallback overrides")
        health_check = meta.get("health_check") or {}
        if not health_check.get("method") or not health_check.get("path"):
            fail(f"{provider} missing health_check metadata")
        expected_health_check = dict(registry.DEFAULT_PROVIDER_HEALTH_CHECK)
        expected_health_check.update(registry.PROVIDER_HEALTH_CHECK_OVERRIDES.get(provider, {}))
        if health_check != expected_health_check:
            fail(f"{provider} health_check should come from default plus overrides: {health_check} != {expected_health_check}")
        for link_key in ("docs_url", "console_url", "key_help"):
            if not meta.get(link_key):
                fail(f"{provider} missing credential metadata: {link_key}")
        for fallback in meta.get("fallback") or []:
            fallback_provider = registry.normalize_provider(
                fallback if isinstance(fallback, str) else str((fallback or {}).get("provider") or "")
            )
            if fallback_provider not in registry.PROVIDER_CATALOG:
                fail(f"{provider} fallback references unknown provider {fallback_provider}")
            primary_caps = set(meta.get("capabilities") or [])
            fallback_caps = set(registry.PROVIDER_CATALOG[fallback_provider].get("capabilities") or [])
            if not primary_caps.intersection(fallback_caps):
                fail(f"{provider} fallback {fallback_provider} has incompatible capabilities")


def check_presets(registry, resolve_provider) -> tuple[int, int]:
    presets = registry.get_api_model_presets()
    if not presets:
        fail("No API model presets configured")

    raw_presets = {
        (
            registry.normalize_provider(preset.get("provider", "")),
            str(preset.get("model_name") or ""),
        ): preset
        for preset in getattr(registry, "API_MODEL_PRESETS", [])
    }
    seen: set[tuple[str, str]] = set()
    providers_with_presets: set[str] = set()

    with isolated_env(registry):
        for preset in presets:
            provider = registry.normalize_provider(preset.get("provider", ""))
            model = str(preset.get("model_name") or "")
            key = (provider, model)
            if key in seen:
                fail(f"Duplicate preset provider/model pair: {key}")
            seen.add(key)
            providers_with_presets.add(provider)

            if provider not in registry.PROVIDER_CATALOG:
                fail(f"Preset {preset.get('name')} references unknown provider {provider}")
            if not preset.get("endpoint"):
                fail(f"Preset {preset.get('name')} missing endpoint")
            expected_endpoint = registry.get_provider_default_endpoint(provider)
            if preset.get("endpoint") != expected_endpoint:
                fail(
                    f"Preset {preset.get('name')} endpoint should come from PROVIDER_DEFAULT_ENDPOINTS: "
                    f"{preset.get('endpoint')} != {expected_endpoint}"
                )
            expected_proxy_mode = registry.PROVIDER_CATALOG[provider].get(
                "default_proxy_mode",
                registry.DEFAULT_PROVIDER_PROXY_MODE,
            )
            if preset.get("proxy_mode") != expected_proxy_mode:
                fail(
                    f"Preset {preset.get('name')} proxy_mode should come from provider default_proxy_mode: "
                    f"{preset.get('proxy_mode')} != {expected_proxy_mode}"
                )
            expected_supports_proxy = registry.PROVIDER_CATALOG[provider].get(
                "supports_proxy",
                registry.DEFAULT_PROVIDER_SUPPORTS_PROXY,
            )
            if preset.get("supports_proxy") != expected_supports_proxy:
                fail(
                    f"Preset {preset.get('name')} supports_proxy should come from provider supports_proxy: "
                    f"{preset.get('supports_proxy')} != {expected_supports_proxy}"
                )
            expected_category = raw_presets.get(key, {}).get("category") or registry.get_provider_default_category(provider)
            if preset.get("category") != expected_category:
                fail(
                    f"Preset {preset.get('name')} category should come from provider capabilities: "
                    f"{preset.get('category')} != {expected_category}"
                )
            if not preset.get("category"):
                fail(f"Preset {preset.get('name')} missing category")
            if not preset.get("required_key"):
                fail(f"Preset {preset.get('name')} missing required_key")
            if not preset.get("health_check_url"):
                fail(f"Preset {preset.get('name')} missing health_check_url")
            derived_health_urls = registry.derive_models_health_urls(preset.get("endpoint", ""), provider)
            if not derived_health_urls:
                fail(f"Preset {preset.get('name')} cannot derive health_check_url from endpoint")
            if preset.get("health_check_url") != derived_health_urls[0]:
                fail(
                    f"Preset {preset.get('name')} health_check_url should be derived from endpoint: "
                    f"{preset.get('health_check_url')} != {derived_health_urls[0]}"
                )

            resolved = resolve_provider(provider, model)
            if resolved.provider != provider:
                fail(f"Resolver provider mismatch for {key}: {resolved.provider}")
            if resolved.model_name != model:
                fail(f"Resolver model mismatch for {key}: {resolved.model_name}")
            if not resolved.endpoint:
                fail(f"Resolver endpoint missing for {key}")
            if resolved.endpoint != preset.get("endpoint"):
                fail(f"Resolver default endpoint mismatch for {key}: {resolved.endpoint} != {preset.get('endpoint')}")
            if resolved.has_key:
                fail(f"Resolver should not find key in isolated env for {key}")

    missing_presets = sorted(set(registry.PROVIDER_CATALOG) - providers_with_presets)
    if missing_presets:
        fail(f"Providers without presets: {missing_presets}")

    catalog_by_provider = {item.get("provider"): item for item in registry.get_api_provider_catalog()}
    for provider in providers_with_presets:
        item = catalog_by_provider.get(provider) or {}
        first_preset = next(
            preset
            for preset in presets
            if registry.normalize_provider(preset.get("provider", "")) == provider
        )
        if item.get("health_check_url") != first_preset.get("health_check_url"):
            fail(
                f"Catalog health_check_url for {provider} should come from its default preset: "
                f"{item.get('health_check_url')} != {first_preset.get('health_check_url')}"
            )
        if item.get("default_endpoint") != registry.get_provider_default_endpoint(provider):
            fail(
                f"Catalog default_endpoint for {provider} should come from PROVIDER_DEFAULT_ENDPOINTS: "
                f"{item.get('default_endpoint')} != {registry.get_provider_default_endpoint(provider)}"
            )
        expected_paths = registry.get_provider_operation_paths(provider)
        if item.get("operation_paths") != expected_paths:
            fail(
                f"Catalog operation_paths for {provider} should come from PROVIDER_API_PATHS: "
                f"{item.get('operation_paths')} != {expected_paths}"
            )
        expected_urls = registry.build_provider_operation_url_templates(
            provider,
            registry.get_provider_default_endpoint(provider),
        )
        if item.get("default_operation_url_templates") != expected_urls:
            fail(
                f"Catalog default_operation_url_templates for {provider} should be derived from default endpoint: "
                f"{item.get('default_operation_url_templates')} != {expected_urls}"
            )

    return len(presets), len(providers_with_presets)


def check_failover_contract(registry, resolve_provider_with_failover, build_provider_runtime_status) -> int:
    with isolated_env(registry):
        os.environ["DEEPSEEK_API_KEY"] = "deepseek-test-key"
        config, info = resolve_provider_with_failover(
            "gemini-text",
            "gemini-2.5-flash",
            provider_health=[
                {"provider": "gemini-text", "status": "error"},
                {"provider": "deepseek", "status": "ok"},
            ],
        )
        if config.provider != "deepseek":
            fail(f"Expected gemini-text to fail over to deepseek, got {config.provider}")
        if not info.get("active") or info.get("reason") != "missing_key":
            fail(f"Unexpected missing-key failover info: {info}")

        os.environ["GEMINI_TEXT_API_KEY"] = "gemini-test-key"
        config, info = resolve_provider_with_failover(
            "gemini-text",
            "gemini-2.5-flash",
            provider_health=[
                {"provider": "gemini-text", "status": "error"},
                {"provider": "deepseek", "status": "ok"},
            ],
        )
        if config.provider != "deepseek" or not info.get("active") or info.get("reason") != "health_error":
            fail(f"Expected health-error failover to deepseek, got provider={config.provider} info={info}")

        config, info = resolve_provider_with_failover(
            "gemini-text",
            "gemini-2.5-flash",
            provider_health=[
                {"provider": "gemini-text", "status": "ok"},
                {"provider": "deepseek", "status": "ok"},
            ],
        )
        if config.provider != "gemini-text" or info.get("active"):
            fail(f"Healthy primary should not fail over: provider={config.provider} info={info}")

        statuses = build_provider_runtime_status(
            [],
            provider_health=[
                {"provider": "gemini-text", "status": "error"},
                {"provider": "deepseek", "status": "ok"},
            ],
        )
        gemini = next(
            (s for s in statuses if s["provider"] == "gemini-text" and s["model_name"] == "gemini-2.5-flash"),
            None,
        )
        if not gemini:
            fail("Runtime status did not include gemini-text preset")
        if not gemini.get("fallback"):
            fail(f"Runtime status missing fallback metadata: {gemini}")
        if not gemini.get("failover_active") or gemini.get("failover_selected_provider") != "deepseek":
            fail(f"Runtime status missing active failover diagnostics: {gemini.get('failover')}")

    return 1


def check_fallback_env_is_key_only(registry, resolve_provider) -> int:
    """Fallback env keys must not pull endpoint/proxy config from another provider."""
    with isolated_env(registry):
        os.environ["ARK_API_KEY"] = "ark-shared-key"
        os.environ["ARK_ENDPOINT"] = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
        os.environ["ARK_PROXY_MODE"] = "custom"
        os.environ["ARK_CUSTOM_PROXY"] = "http://ark-proxy.example.invalid:7890"

        seedance = resolve_provider("seedance", "doubao-seedance-2-0-260128")
        seedance_preset = registry.get_api_model_preset("seedance", "doubao-seedance-2-0-260128") or {}
        if seedance.api_key_env != "ARK_API_KEY":
            fail(f"Seedance should borrow ARK_API_KEY only, got {seedance.api_key_env}")
        if seedance.endpoint != seedance_preset.get("endpoint"):
            fail(
                "Seedance fallback borrowed ARK endpoint instead of its own preset endpoint: "
                f"{seedance.endpoint}"
            )
        if seedance.endpoint_env:
            fail(f"Seedance fallback should not report ARK endpoint env, got {seedance.endpoint_env}")
        if seedance.proxy_config.get("mode") != "direct":
            fail(f"Seedance fallback borrowed ARK proxy mode: {seedance.proxy_config}")
        if seedance.proxy_config.get("custom_proxy"):
            fail("Seedance fallback borrowed ARK custom proxy")

        os.environ["SORA2_API_KEY"] = "sora2-shared-key"
        os.environ["SORA2_ENDPOINT"] = "https://sora2-only.example.invalid/v1"
        veo = resolve_provider("veo", "veo-3")
        veo_preset = registry.get_api_model_preset("veo", "veo-3") or {}
        if veo.api_key_env != "SORA2_API_KEY":
            fail(f"Veo should borrow SORA2_API_KEY only, got {veo.api_key_env}")
        if veo.endpoint != veo_preset.get("endpoint"):
            fail(f"Veo fallback borrowed Sora2 endpoint instead of Veo preset endpoint: {veo.endpoint}")

    return 2


def check_provider_health_map_contract(normalize_provider_health_map) -> int:
    health_map = normalize_provider_health_map(
        {
            "gemini-text": {"provider": "gemini-text", "status": "ok"},
            "bad-value": "error",
            "deepseek": {
                "provider": "deepseek",
                "model_name": "deepseek-reasoner",
                "status": "error",
            },
        }
    )
    if sorted(health_map) != ["deepseek::deepseek-reasoner", "gemini-text"]:
        fail(f"Mixed provider health map dropped valid rows: {health_map}")
    return 1


def string_arg(node: ast.Call, index: int) -> str | None:
    if len(node.args) <= index:
        return None
    arg = node.args[index]
    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
        return arg.value
    return None


def iter_python_files(root: Path) -> Iterable[Path]:
    skipped = {".venv", ".codex_backups", "__pycache__", "node_modules"}
    for path in root.rglob("*.py"):
        if any(part in skipped for part in path.parts):
            continue
        yield path


RUNTIME_RESOLVER_CALLS = {"resolve_provider", "resolve_provider_with_failover", "resolve_ai_proxy_provider"}
THIRD_PARTY_ENDPOINT_MARKERS = (
    "https://api.laozhang.ai",
    "https://api.minimaxi.com",
    "https://dashscope.aliyuncs.com",
    "https://ark.cn-beijing.volces.com",
    "https://generativelanguage.googleapis.com",
    "https://api.deepseek.com",
)

PROVIDER_CONFIG_AUTHORITY_FILES = {
    "services/api_provider_registry.py",
    "services/api_provider_runtime.py",
    "services/api_config_runtime_loader.py",
    "services/api_config_health_service.py",
    "services/api_config_import_service.py",
}
PROVIDER_CONTRACT_SKIP_DIRS = {"scripts", "tests", "docs", "__pycache__"}


def dotted_call_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        prefix = dotted_call_name(node.value)
        return f"{prefix}.{node.attr}" if prefix else node.attr
    return None


def docstring_constant_nodes(tree: ast.AST) -> set[ast.Constant]:
    nodes: set[ast.Constant] = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if not getattr(node, "body", None):
            continue
        first = node.body[0]
        if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
            nodes.add(first.value)
    return nodes


def function_by_name(tree: ast.AST, name: str) -> ast.FunctionDef | ast.AsyncFunctionDef | None:
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    return None


def class_by_name(tree: ast.AST, name: str) -> ast.ClassDef | None:
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == name:
            return node
    return None


def class_method_by_name(
    class_node: ast.ClassDef,
    name: str,
) -> ast.FunctionDef | ast.AsyncFunctionDef | None:
    for node in class_node.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    return None


def method_calls_self_helper(node: ast.AST, helper_names: set[str]) -> bool:
    for item in ast.walk(node):
        if not isinstance(item, ast.Call):
            continue
        func = item.func
        if not isinstance(func, ast.Attribute) or func.attr not in helper_names:
            continue
        if isinstance(func.value, ast.Name) and func.value.id == "self":
            return True
    return False


def return_dict_keys(node: ast.AST) -> set[str]:
    keys: set[str] = set()
    for item in ast.walk(node):
        if not isinstance(item, ast.Return) or not isinstance(item.value, ast.Dict):
            continue
        for key_node in item.value.keys:
            if isinstance(key_node, ast.Constant) and isinstance(key_node.value, str):
                keys.add(key_node.value)
    return keys


def call_uses_keyword(node: ast.AST, call_name: str, keyword_name: str) -> bool:
    for item in ast.walk(node):
        if not isinstance(item, ast.Call):
            continue
        if dotted_call_name(item.func) != call_name:
            continue
        if any(keyword.arg == keyword_name for keyword in item.keywords):
            return True
    return False


def check_resolve_provider_references(registry) -> int:
    root = deploy_root()
    references: list[tuple[Path, int, str, str | None]] = []
    unknown: list[str] = []
    for path in iter_python_files(root):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except Exception as exc:
            fail(f"Unable to parse {path}: {exc}")

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if not isinstance(func, ast.Name) or func.id not in RUNTIME_RESOLVER_CALLS:
                continue
            provider = string_arg(node, 0)
            model = string_arg(node, 1)
            if provider is None:
                continue
            normalized = registry.normalize_provider(provider)
            references.append((path.relative_to(root), node.lineno, normalized, model))
            if normalized not in registry.PROVIDER_CATALOG:
                unknown.append(f"{path.relative_to(root)}:{node.lineno} -> {provider}")

    if unknown:
        fail("Unknown resolve_provider references:\n" + "\n".join(unknown))
    if not references:
        fail("No resolve_provider references found")
    return len(references)


def resolve_provider_references_in_file(root: Path, relative_path: str, registry) -> set[str]:
    path = root / relative_path
    if not path.exists():
        fail(f"Runtime-wired provider file is missing: {relative_path}")
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except Exception as exc:
        fail(f"Unable to parse {relative_path}: {exc}")

    providers: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not isinstance(func, ast.Name) or func.id not in RUNTIME_RESOLVER_CALLS:
            continue
        provider = string_arg(node, 0)
        if provider:
            providers.add(registry.normalize_provider(provider))
    return providers


def check_expected_runtime_wiring(registry) -> int:
    root = deploy_root()
    missing: list[str] = []
    for relative_path, expected_providers in EXPECTED_RUNTIME_WIRING.items():
        found = resolve_provider_references_in_file(root, relative_path, registry)
        missing_providers = sorted(expected_providers - found)
        if missing_providers:
            missing.append(f"{relative_path}: missing resolve_provider calls for {missing_providers}; found={sorted(found)}")
    for relative_path, snippets in EXPECTED_RUNTIME_DELEGATION.items():
        path = root / relative_path
        text = path.read_text(encoding="utf-8")
        missing_snippets = [snippet for snippet in snippets if snippet not in text]
        if missing_snippets:
            missing.append(f"{relative_path}: missing delegated runtime wiring snippets {missing_snippets}")
    if missing:
        fail("Provider runtime wiring contract failed:\n" + "\n".join(missing))
    return len(EXPECTED_RUNTIME_WIRING) + len(EXPECTED_RUNTIME_DELEGATION)


def check_external_api_clients_have_no_endpoint_literals() -> int:
    """External API clients must read endpoints from resolve_provider/registry."""
    root = deploy_root()
    external_root = root / "external_api"
    violations: list[str] = []
    scanned = 0
    for path in external_root.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        scanned += 1
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except Exception as exc:
            fail(f"Unable to parse {path.relative_to(root)}: {exc}")

        docstrings = docstring_constant_nodes(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Constant) or not isinstance(node.value, str):
                continue
            if node in docstrings:
                continue
            if any(marker in node.value for marker in THIRD_PARTY_ENDPOINT_MARKERS):
                violations.append(f"{path.relative_to(root)}:{node.lineno} hardcodes endpoint {node.value!r}")

    if violations:
        fail(
            "external_api clients must not hardcode third-party endpoints; use provider registry presets:\n"
            + "\n".join(violations)
        )
    return scanned


def check_external_api_clients_refresh_runtime_config() -> int:
    """New requests refresh config; accepted task reads retain their owning account."""
    root = deploy_root()
    violations: list[str] = []
    checked = 0

    for relative_path, spec in EXTERNAL_API_RUNTIME_REFRESH_METHODS.items():
        path = root / relative_path
        if not path.exists():
            violations.append(f"{relative_path}: file is missing")
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except Exception as exc:
            fail(f"Unable to parse {relative_path}: {exc}")

        class_name = spec["class"]
        class_node = class_by_name(tree, class_name)
        if class_node is None:
            violations.append(f"{relative_path}: missing class {class_name}")
            continue

        refresh_method = class_method_by_name(class_node, "_refresh_runtime_config")
        if refresh_method is None:
            violations.append(f"{relative_path}:{class_node.lineno} {class_name} is missing _refresh_runtime_config()")

        refresh_via = set(spec["refresh_via"])
        if "_url" in refresh_via:
            url_method = class_method_by_name(class_node, "_url")
            if url_method is None:
                violations.append(f"{relative_path}:{class_node.lineno} {class_name} refresh_via includes _url but _url() is missing")
            elif not method_calls_self_helper(url_method, {"_refresh_runtime_config"}):
                violations.append(f"{relative_path}:{url_method.lineno} {class_name}._url() must refresh runtime config")
        if "_request_json" in refresh_via:
            request_json_method = class_method_by_name(class_node, "_request_json")
            if request_json_method is None:
                violations.append(
                    f"{relative_path}:{class_node.lineno} {class_name} refresh_via includes _request_json but _request_json() is missing"
                )
            elif not method_calls_self_helper(request_json_method, {"_url"}):
                violations.append(f"{relative_path}:{request_json_method.lineno} {class_name}._request_json() must use _url()")
        if "_download_bytes" in refresh_via:
            download_method = class_method_by_name(class_node, "_download_bytes")
            if download_method is None:
                violations.append(
                    f"{relative_path}:{class_node.lineno} {class_name} refresh_via includes _download_bytes but _download_bytes() is missing"
                )
            elif not method_calls_self_helper(download_method, {"_refresh_runtime_config"}):
                violations.append(
                    f"{relative_path}:{download_method.lineno} {class_name}._download_bytes() must refresh runtime config"
                )

        for method_name in sorted(spec["methods"]):
            method = class_method_by_name(class_node, method_name)
            if method is None:
                violations.append(f"{relative_path}: missing {class_name}.{method_name}()")
                continue
            checked += 1
            if method_name in spec.get("pinned_methods", set()):
                if not method_calls_self_helper(method, {"_task_context"}):
                    violations.append(f"{relative_path}:{method.lineno} {method_name} must use its accepted task context")
                if method_calls_self_helper(method, {"_refresh_runtime_config", "_url_for_operation"}):
                    violations.append(f"{relative_path}:{method.lineno} {method_name} must not switch to current default credentials")
                continue
            if not method_calls_self_helper(method, refresh_via):
                helpers = ", ".join(sorted(refresh_via))
                violations.append(
                    f"{relative_path}:{method.lineno} {class_name}.{method_name}() "
                    f"must call one of: {helpers}"
                )

    if violations:
        fail(
            "External API clients must refresh provider runtime config before shared requests:\n"
            + "\n".join(violations)
        )
    return checked


def check_provider_endpoint_helpers() -> int:
    root = deploy_root()
    sys.path.insert(0, str(root))
    from services.api_provider_endpoints import derive_dashscope_video_urls  # noqa: PLC0415

    cases = [
        (
            "https://dashscope.example.test/compatible-mode/v1",
            (
                "https://dashscope.example.test/api/v1",
                "https://dashscope.example.test/api/v1/services/aigc/video-generation/video-synthesis",
            ),
        ),
        (
            "https://dashscope.example.test/api/v1",
            (
                "https://dashscope.example.test/api/v1",
                "https://dashscope.example.test/api/v1/services/aigc/video-generation/video-synthesis",
            ),
        ),
        (
            "https://dashscope.example.test/api/v1/services/aigc/video-generation/video-synthesis",
            (
                "https://dashscope.example.test/api/v1",
                "https://dashscope.example.test/api/v1/services/aigc/video-generation/video-synthesis",
            ),
        ),
        (
            "https://self-hosted.example.test/dashscope",
            (
                "https://self-hosted.example.test/dashscope",
                "https://self-hosted.example.test/dashscope/services/aigc/video-generation/video-synthesis",
            ),
        ),
    ]
    for endpoint, expected in cases:
        got = derive_dashscope_video_urls(endpoint)
        if got != expected:
            fail(f"DashScope endpoint helper changed for {endpoint}: {got} != {expected}")

    try:
        derive_dashscope_video_urls("")
        fail("DashScope endpoint helper should reject empty endpoints")
    except ValueError:
        pass

    duplicate_defs: list[str] = []
    for relative_path in ("external_api/video/dashscope.py", "external_api/video/wan2.py"):
        path = root / relative_path
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name == "_derive_dashscope_video_urls":
                duplicate_defs.append(f"{relative_path}:{node.lineno}")
    if duplicate_defs:
        fail("DashScope endpoint URL derivation must stay in services/api_provider_endpoints.py:\n" + "\n".join(duplicate_defs))

    return len(cases)


def check_cluster_main_has_no_api_key_env_cache(registry) -> int:
    root = deploy_root()
    path = root / "cluster_main.py"
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except Exception as exc:
        fail(f"Unable to parse cluster_main.py: {exc}")

    forbidden_envs = managed_env_keys(registry)
    violations: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = dotted_call_name(node.func)
        if name not in {"os.getenv", "os.environ.get"}:
            continue
        env_key = string_arg(node, 0)
        if env_key in forbidden_envs:
            violations.append(f"cluster_main.py:{node.lineno} reads managed provider env {env_key}")

    if violations:
        fail(
            "cluster_main.py must not cache provider API env vars; use resolver/runtime loader instead:\n"
            + "\n".join(violations)
        )
    return 1


def check_cluster_main_has_no_provider_resolver_calls() -> int:
    root = deploy_root()
    path = root / "cluster_main.py"
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except Exception as exc:
        fail(f"Unable to parse cluster_main.py: {exc}")

    violations: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = dotted_call_name(node.func)
        if name in RUNTIME_RESOLVER_CALLS:
            violations.append(f"cluster_main.py:{node.lineno} calls {name}()")

    if violations:
        fail(
            "cluster_main.py must not call provider runtime resolvers directly; "
            "move provider HTTP logic into services/routers:\n"
            + "\n".join(violations)
        )
    return 1


def check_runtime_code_has_no_managed_provider_env_reads(registry) -> int:
    """Only provider config authority modules may read managed provider env vars directly."""
    root = deploy_root()
    forbidden_envs = managed_env_keys(registry)
    violations: list[str] = []
    scanned = 0

    for path in iter_python_files(root):
        relative = path.relative_to(root).as_posix()
        if relative in PROVIDER_CONFIG_AUTHORITY_FILES:
            continue
        if any(part in PROVIDER_CONTRACT_SKIP_DIRS for part in path.relative_to(root).parts):
            continue

        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except Exception as exc:
            fail(f"Unable to parse {relative}: {exc}")
        scanned += 1

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = dotted_call_name(node.func)
            if name not in {"os.getenv", "os.environ.get"}:
                continue
            env_key = string_arg(node, 0)
            if env_key in forbidden_envs:
                violations.append(f"{relative}:{node.lineno} reads managed provider env {env_key}")

    if violations:
        fail(
            "Runtime code must use resolve_provider()/provider registry instead of direct managed env reads:\n"
            + "\n".join(violations)
        )
    return scanned


def check_runtime_code_has_no_third_party_endpoint_literals() -> int:
    """Third-party endpoints belong in the provider registry/health config only."""
    root = deploy_root()
    violations: list[str] = []
    scanned = 0

    for path in iter_python_files(root):
        relative = path.relative_to(root).as_posix()
        if relative in PROVIDER_CONFIG_AUTHORITY_FILES:
            continue
        if any(part in PROVIDER_CONTRACT_SKIP_DIRS for part in path.relative_to(root).parts):
            continue

        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except Exception as exc:
            fail(f"Unable to parse {relative}: {exc}")
        scanned += 1

        docstrings = docstring_constant_nodes(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Constant) or not isinstance(node.value, str):
                continue
            if node in docstrings:
                continue
            if any(marker in node.value for marker in THIRD_PARTY_ENDPOINT_MARKERS):
                violations.append(f"{relative}:{node.lineno} hardcodes endpoint {node.value!r}")

    if violations:
        fail(
            "Runtime code must not hardcode third-party provider endpoints; use provider registry presets:\n"
            + "\n".join(violations)
        )
    return scanned


def check_api_config_write_env_refresh_contract() -> int:
    """API config writes must expose whether the runtime env hot reload worked."""
    root = deploy_root()
    service_path = root / "services" / "api_config_service.py"
    import_path = root / "services" / "api_config_import_service.py"
    reload_path = root / "services" / "api_config_reload_service.py"
    cache_path = root / "services" / "api_config_health_cache_service.py"
    route_path = root / "admin_api_config_routes.py"

    service_text = service_path.read_text(encoding="utf-8")
    import_text = import_path.read_text(encoding="utf-8")
    reload_text = reload_path.read_text(encoding="utf-8")
    cache_text = cache_path.read_text(encoding="utf-8")
    service_tree = ast.parse(service_text, filename=str(service_path))
    import_tree = ast.parse(import_text, filename=str(import_path))
    reload_tree = ast.parse(reload_text, filename=str(reload_path))
    cache_tree = ast.parse(cache_text, filename=str(cache_path))
    route_text = route_path.read_text(encoding="utf-8")
    route_tree = ast.parse(route_text, filename=str(route_path))

    violations: list[str] = []
    service_write_functions = {
        "create_api_config",
        "update_api_config",
        "delete_api_config",
        "repair_api_config_provider_conflicts",
    }
    for name in service_write_functions:
        func = function_by_name(service_tree, name)
        if not func:
            violations.append(f"services/api_config_service.py missing {name}()")
            continue
        if "env_refreshed" not in return_dict_keys(func):
            violations.append(f"services/api_config_service.py:{func.lineno} {name}() response lacks env_refreshed")
        source = ast.get_source_segment(service_text, func) or ""
        if "reload_api_env_after_config_change" not in source:
            violations.append(f"services/api_config_service.py:{func.lineno} {name}() must own default API env reload")
        if "invalidate_provider_health_for_items" not in source:
            violations.append(f"services/api_config_service.py:{func.lineno} {name}() must invalidate provider health via helper")

    reload_service_func = function_by_name(reload_tree, "reload_api_env_runtime")
    if not reload_service_func:
        violations.append("services/api_config_reload_service.py missing reload_api_env_runtime()")
    elif "env_refreshed" not in return_dict_keys(reload_service_func):
        violations.append(
            f"services/api_config_reload_service.py:{reload_service_func.lineno} reload_api_env_runtime() response lacks env_refreshed"
        )
    if "clear_all_provider_health_cache" not in reload_text:
        violations.append("services/api_config_reload_service.py must call clear_all_provider_health_cache() from helper")
    if "from services.api_config_runtime_loader import load_api_configs_to_env" not in reload_text:
        violations.append("services/api_config_reload_service.py must own runtime loader import")
    if not function_by_name(reload_tree, "reload_api_env_after_config_change"):
        violations.append("services/api_config_reload_service.py missing default config-change reload helper")
    if "from utils.config_helpers import _config_get" not in service_text:
        violations.append("services/api_config_service.py must import shared _config_get helper")
    for helper_name in ("_row_provider", "_row_model_name", "_row_config_id", "_row_enabled", "_row_has_key"):
        helper = function_by_name(service_tree, helper_name)
        if not helper:
            violations.append(f"services/api_config_service.py missing {helper_name}()")
            continue
        helper_source = ast.get_source_segment(service_text, helper) or ""
        if "_config_get" not in helper_source:
            violations.append(f"services/api_config_service.py:{helper.lineno} {helper_name}() must use shared _config_get")

    import_func = function_by_name(import_tree, "import_preset_api_configs")
    if not import_func:
        violations.append("services/api_config_import_service.py missing import_preset_api_configs()")
    elif "env_refreshed" not in return_dict_keys(import_func):
        violations.append(
            f"services/api_config_import_service.py:{import_func.lineno} import response lacks env_refreshed"
        )
    elif "reload_api_env_after_config_change" not in (ast.get_source_segment(import_text, import_func) or ""):
        violations.append(
            f"services/api_config_import_service.py:{import_func.lineno} import must own default API env reload"
        )
    elif "invalidate_provider_health_for_items" not in (ast.get_source_segment(import_text, import_func) or ""):
        violations.append(
            f"services/api_config_import_service.py:{import_func.lineno} import must invalidate provider health via helper"
        )
    if "from services.api_config_reload_service import ReloadCallback, reload_api_env_after_config_change" not in import_text:
        violations.append("services/api_config_import_service.py must use api_config_reload_service for runtime reload")
    if "from services.api_config_service import" in import_text:
        violations.append("services/api_config_import_service.py must not import API config CRUD service")
    if function_by_name(import_tree, "_row_get"):
        violations.append("services/api_config_import_service.py must use utils.config_helpers._config_get, not local _row_get()")
    if "from utils.config_helpers import _config_get" not in import_text:
        violations.append("services/api_config_import_service.py must import shared _config_get helper")
    if function_by_name(route_tree, "_reload_api_env"):
        violations.append("admin_api_config_routes.py must not own private _reload_api_env(); write services reload by default")
    if "from services.api_config_reload_service import ApiConfigReloadFailed, reload_api_env_runtime" not in route_text:
        violations.append("admin_api_config_routes.py must import manual reload runtime from api_config_reload_service")
    if not function_by_name(cache_tree, "invalidate_provider_health_for_items"):
        violations.append("services/api_config_health_cache_service.py missing invalidate_provider_health_for_items()")
    if not function_by_name(cache_tree, "clear_all_provider_health_cache"):
        violations.append("services/api_config_health_cache_service.py missing clear_all_provider_health_cache()")

    forbidden_health_cache_details = (
        "delete_cached_provider_health_many",
        "delete_cached_provider_health_targets",
        "clear_all_cached_provider_health",
    )
    for relative, text in {
        "services/api_config_service.py": service_text,
        "services/api_config_import_service.py": import_text,
    }.items():
        for snippet in forbidden_health_cache_details:
            if snippet in text:
                violations.append(f"{relative} should use api_config_health_cache_service, not {snippet}")

    route_write_calls = {
        "admin_create_api_config": "create_api_config",
        "admin_import_preset_configs": "import_preset_api_configs",
        "admin_repair_api_config_conflicts": "repair_api_config_provider_conflicts",
        "admin_update_api_config": "update_api_config",
        "admin_delete_api_config": "delete_api_config",
    }
    for route_name, service_call in route_write_calls.items():
        func = function_by_name(route_tree, route_name)
        if not func:
            violations.append(f"admin_api_config_routes.py missing {route_name}()")
            continue
        if call_uses_keyword(func, service_call, "reload_api_env"):
            violations.append(
                f"admin_api_config_routes.py:{func.lineno} {route_name}() must let {service_call}() own API env reload"
            )

    manual_reload = function_by_name(route_tree, "admin_reload_api_env")
    if not manual_reload:
        violations.append("admin_api_config_routes.py missing admin_reload_api_env()")
    else:
        manual_source = ast.get_source_segment(route_text, manual_reload) or ""
        if "env_refreshed" not in return_dict_keys(manual_reload) and '"env_refreshed"' not in manual_source:
            violations.append(
                f"admin_api_config_routes.py:{manual_reload.lineno} manual reload response lacks env_refreshed"
            )
        if "reload_api_env_runtime(clear_health_cache=True)" not in manual_source:
            violations.append(
                f"admin_api_config_routes.py:{manual_reload.lineno} manual reload must delegate runtime reload to service"
            )
        if "raise HTTPException(status_code=500" not in manual_source:
            violations.append(
                f"admin_api_config_routes.py:{manual_reload.lineno} manual reload must return HTTP 500 on reload failure"
            )

    route_forbidden_runtime_details = (
        "load_api_configs_to_env",
        "clear_all_cached_provider_health",
        "delete_cached_provider_health_many",
        "PROVIDER_CATALOG",
        "_clear_all_provider_health_cache",
    )
    for snippet in route_forbidden_runtime_details:
        if snippet in route_text:
            violations.append(f"admin_api_config_routes.py should not own API env reload/cache internals: {snippet}")

    if violations:
        fail("API config write operations must expose hot-reload status:\n" + "\n".join(violations))
    return len(service_write_functions) + 18 + len(route_write_calls) + 1 + len(route_forbidden_runtime_details) + (
        2 * len(forbidden_health_cache_details)
    )


def check_api_config_service_dao_import_contract() -> int:
    """API management services should depend on canonical DAO package modules."""
    root = deploy_root()
    required_imports = {
        "services/api_config_service.py": "from dao.admin.api_config import ApiConfigDAO",
        "services/api_config_runtime_loader.py": "from dao.admin.api_config import ApiConfigDAO",
        "services/api_config_import_service.py": "from dao.admin.api_config import ApiConfigDAO",
        "services/api_config_health_service.py": "from dao.admin.system_settings import SystemSettingsDAO",
    }
    forbidden_imports = (
        "from dao_api_config import ApiConfigDAO",
        "import dao_api_config",
        "from dao_system_settings import SystemSettingsDAO",
        "import dao_system_settings",
    )
    checks = 0
    violations: list[str] = []
    for relative, required in required_imports.items():
        text = (root / relative).read_text(encoding="utf-8")
        if required not in text:
            violations.append(f"{relative} must import canonical DAO: {required}")
        checks += 1
        for forbidden in forbidden_imports:
            if forbidden in text:
                violations.append(f"{relative} must not import compatibility DAO shim: {forbidden}")
            checks += 1
    if violations:
        fail("API config service DAO import contract failed:\n" + "\n".join(violations))
    return checks


def check_gpt_image_tier_wiring(registry) -> int:
    path = deploy_root() / "services" / "ai_proxy_gpt_image_service.py"
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except Exception as exc:
        fail(f"Unable to parse services/ai_proxy_gpt_image_service.py: {exc}")

    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        if not any(isinstance(target, ast.Name) and target.id == "GPT_IMAGE_TIERS" for target in node.targets):
            continue
        fail("GPT_IMAGE_TIERS must live in services/api_provider_registry.py, not services/ai_proxy_gpt_image_service.py")

    tiers = registry.get_gpt_image_tiers()
    if not isinstance(tiers, dict) or not tiers:
        fail("Registry GPT_IMAGE_TIERS mapping is missing")

    providers = {
        registry.normalize_provider(item.get("provider", ""))
        for item in tiers.values()
        if isinstance(item, dict)
    }
    missing = sorted(EXPECTED_GPT_IMAGE_TIER_PROVIDERS - providers)
    if missing:
        fail(f"Registry GPT_IMAGE_TIERS missing providers: {missing}; found={sorted(providers)}")

    unknown = sorted(provider for provider in providers if provider not in registry.PROVIDER_CATALOG)
    if unknown:
        fail(f"Registry GPT_IMAGE_TIERS references unknown providers: {unknown}")

    for tier, item in tiers.items():
        if not isinstance(item, dict):
            fail(f"Registry GPT_IMAGE_TIERS[{tier!r}] must be a mapping")
        if not item.get("model"):
            fail(f"Registry GPT_IMAGE_TIERS[{tier!r}] missing model")
        if not item.get("key_hint"):
            fail(f"Registry GPT_IMAGE_TIERS[{tier!r}] missing key_hint")
        if registry.get_api_model_preset(item.get("provider", ""), item.get("model")) is None:
            fail(f"Registry GPT_IMAGE_TIERS[{tier!r}] has no matching preset")

    return len(providers)


def check_gemini_image_alias_wiring(registry) -> int:
    path = deploy_root() / "services" / "ai_proxy_gemini_image_service.py"
    text = path.read_text(encoding="utf-8")
    try:
        tree = ast.parse(text, filename=str(path))
    except Exception as exc:
        fail(f"Unable to parse services/ai_proxy_gemini_image_service.py: {exc}")

    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "GEMINI_IMAGE_MODEL_ALIASES":
                    fail("GEMINI_IMAGE_MODEL_ALIASES must live in services/api_provider_registry.py, not services/ai_proxy_service.py")
        if isinstance(node, ast.FunctionDef) and node.name == "normalize_gemini_image_model":
            fail("normalize_gemini_image_model must live in services/api_provider_registry.py, not services/ai_proxy_service.py")

    aliases = getattr(registry, "GEMINI_IMAGE_MODEL_ALIASES", None)
    if not isinstance(aliases, dict) or not aliases:
        fail("Registry GEMINI_IMAGE_MODEL_ALIASES mapping is missing")
    expected_target = "gemini-3.1-flash-image-preview"
    for alias in ("gemini-3-pro-image-preview", "nanobanana"):
        if aliases.get(alias) != expected_target:
            fail(f"Gemini image alias {alias!r} should resolve to {expected_target!r}, got {aliases.get(alias)!r}")
    if registry.normalize_gemini_image_model(None) is not None:
        fail("Gemini image alias helper should return None for empty model")
    if registry.normalize_gemini_image_model("custom-model") != "custom-model":
        fail("Gemini image alias helper should preserve unknown explicit models")
    if "normalize_gemini_image_model," not in text and "normalize_gemini_image_model" not in text:
        fail("ai_proxy_gemini_image_service.py must import/use registry normalize_gemini_image_model")
    return len(aliases) + 3


def check_video_default_model_registry_wiring(registry) -> int:
    root = deploy_root()
    checks = 0
    expected = [
        (
            "external_api/video/minimax.py",
            "DEFAULT_MINIMAX_VIDEO_MODEL",
            "MINIMAX_DEFAULT_VIDEO_MODEL",
            registry.MINIMAX_DEFAULT_VIDEO_MODEL,
        ),
        (
            "external_api/video/sora2.py",
            "DEFAULT_SORA2_VIDEO_MODEL",
            "SORA2_DEFAULT_VIDEO_MODEL",
            registry.SORA2_DEFAULT_VIDEO_MODEL,
        ),
        (
            "external_api/video/veo.py",
            "DEFAULT_VEO_VIDEO_MODEL",
            "VEO_DEFAULT_VIDEO_MODEL",
            registry.VEO_DEFAULT_VIDEO_MODEL,
        ),
        (
            "external_api/video/wan2.py",
            "DEFAULT_WAN26_VIDEO_MODEL",
            'DASHSCOPE_DEFAULT_MODEL_MAP["wan26"]',
            registry.DASHSCOPE_DEFAULT_MODEL_MAP["wan26"],
        ),
    ]
    for rel, local_name, registry_name, literal in expected:
        path = root / rel
        text = path.read_text(encoding="utf-8")
        if registry_name not in text:
            fail(f"{rel} must source {local_name} from registry via {registry_name}")
        if f"{local_name} = {registry_name}" not in text:
            fail(f"{rel} must keep {local_name} as a registry-backed compatibility alias")
        if literal in text:
            fail(f"{rel} must not hardcode video default model literal {literal!r}")
        checks += 3

    video_alias_cases = [
        (
            "minimax",
            registry.MINIMAX_DEFAULT_VIDEO_MODEL,
            registry.MINIMAX_LEGACY_VIDEO_MODELS,
            registry.minimax_runtime_model_override,
            registry.normalize_minimax_video_model,
            root / "external_api" / "video" / "minimax.py",
            ("def _runtime_model_override", "_normalize_minimax_model"),
        ),
        (
            "sora2",
            registry.SORA2_DEFAULT_VIDEO_MODEL,
            registry.SORA2_LEGACY_VIDEO_MODELS,
            registry.sora2_runtime_model_override,
            registry.normalize_sora2_video_model,
            root / "external_api" / "video" / "sora2.py",
            ("LEGACY_SORA2_VIDEO_MODELS", "_normalize_sora2_model", "def _runtime_model_override"),
        ),
        (
            "veo",
            registry.VEO_DEFAULT_VIDEO_MODEL,
            registry.VEO_LEGACY_VIDEO_MODELS,
            registry.veo_runtime_model_override,
            registry.normalize_veo_video_model,
            root / "external_api" / "video" / "veo.py",
            ("LEGACY_VEO_VIDEO_MODELS", "_normalize_veo_model", "def _runtime_model_override"),
        ),
    ]
    for provider, default_model, legacy_models, override_fn, normalize_fn, client_path, forbidden in video_alias_cases:
        if override_fn(None) is not None or override_fn(default_model) is not None:
            fail(f"Registry runtime override helper should ignore empty/default model for {provider}")
        if normalize_fn(None) != default_model or normalize_fn(default_model) != default_model:
            fail(f"Registry normalize helper should map empty/default {provider} model to default")
        if legacy_models:
            legacy_model = next(iter(legacy_models))
            if override_fn(legacy_model) is not None:
                fail(f"Registry runtime override helper should ignore legacy model {legacy_model!r} for {provider}")
            if normalize_fn(legacy_model) != default_model:
                fail(f"Registry normalize helper should map legacy {provider} model to default")
        custom_model = f"{provider}-custom-runtime-model"
        if override_fn(custom_model) != custom_model or normalize_fn(custom_model) != custom_model:
            fail(f"Registry helpers should preserve custom explicit {provider} models")

        client_text = client_path.read_text(encoding="utf-8")
        for snippet in forbidden:
            if snippet in client_text:
                fail(f"{client_path.relative_to(root)} must not define local video alias helper: {snippet}")
        checks += 6 + len(forbidden)
        if legacy_models:
            checks += 2

    runtime_loader = (root / "services" / "api_config_runtime_loader.py").read_text(encoding="utf-8")
    for legacy_name in ("SORA2_LEGACY_VIDEO_MODELS", "VEO_LEGACY_VIDEO_MODELS"):
        if legacy_name not in runtime_loader:
            fail(f"api_config_runtime_loader.py must use registry {legacy_name}")
        checks += 1

    dashscope_client = (root / "external_api" / "video" / "dashscope.py").read_text(encoding="utf-8")
    dashscope_runtime = (root / "services" / "api_provider_runtime.py").read_text(encoding="utf-8")
    for registry_name in (
        "DASHSCOPE_VIDU_REFERENCE_SUB_MODEL_MAP",
        "DASHSCOPE_VIDU_STARTEND_SUB_MODEL_MAP",
    ):
        if not hasattr(registry, registry_name):
            fail(f"Registry missing DashScope Vidu map: {registry_name}")
        checks += 1
    if registry.dashscope_vidu_reference_sub_model("q3-mix") != "vidu-reference-q3-mix":
        fail("Registry DashScope Vidu reference helper should resolve q3-mix")
    if registry.dashscope_vidu_reference_sub_model("unknown") != "vidu-reference-q3":
        fail("Registry DashScope Vidu reference helper should fall back to q3")
    if registry.dashscope_vidu_startend_sub_model("q3-pro") != "vidu-startend-q3-pro":
        fail("Registry DashScope Vidu start/end helper should resolve q3-pro")
    if registry.dashscope_vidu_startend_sub_model("unknown") != "vidu-startend-q3-turbo":
        fail("Registry DashScope Vidu start/end helper should fall back to q3-turbo")
    checks += 4
    for forbidden in (
        "VIDU_REFERENCE_SUB_MODEL_MAP =",
        "VIDU_STARTEND_SUB_MODEL_MAP =",
        "DEFAULT_DASHSCOPE_MODEL_TO_SUB_MODEL",
        "def _resolve_default_dashscope_model",
    ):
        if forbidden in dashscope_client:
            fail(f"external_api/video/dashscope.py must not define local DashScope model mapping: {forbidden}")
        checks += 1
    for required in (
        "dashscope_vidu_reference_sub_model",
        "dashscope_vidu_startend_sub_model",
        "resolve_dashscope_default_model_name",
    ):
        if required not in dashscope_client:
            fail(f"external_api/video/dashscope.py must use {required}")
        checks += 1
    if "def resolve_dashscope_default_model_name" not in dashscope_runtime:
        fail("api_provider_runtime.py must own resolve_dashscope_default_model_name")
    if "dashscope_sub_model_for_model(model_name)" not in dashscope_runtime:
        fail("resolve_dashscope_default_model_name must use registry dashscope_sub_model_for_model")
    checks += 2

    audio_provider = (root / "services" / "audio_provider.py").read_text(encoding="utf-8")
    if "GeminiAudioProvider" in audio_provider:
        fail("services/audio_provider.py must not expose the retired Gemini TTS provider")
    if hasattr(registry, "GEMINI_TTS_DEFAULT_MODEL"):
        fail("Registry must not expose the retired GEMINI_TTS_DEFAULT_MODEL")
    if any(item.get("provider") == "gemini-tts" for item in registry.get_api_provider_catalog()):
        fail("Provider catalog must not expose retired provider=gemini-tts")
    if any(item.get("provider") == "gemini-tts" for item in registry.get_api_model_presets()):
        fail("Model presets must not expose retired provider=gemini-tts")
    if 'provider != "gemini-tts"' not in runtime_loader or "ApiConfigDAO.delete" not in runtime_loader:
        fail("api_config_runtime_loader.py must retire existing Gemini TTS rows")
    checks += 5

    audio_client = (root / "external_api" / "audio" / "minimax_audio.py").read_text(encoding="utf-8")
    if not hasattr(registry, "MINIMAX_DEFAULT_PROVIDER_MODEL"):
        fail("Registry missing MINIMAX_DEFAULT_PROVIDER_MODEL")
    if registry.MINIMAX_DEFAULT_PROVIDER_MODEL != registry.MINIMAX_DEFAULT_VIDEO_MODEL:
        fail("MINIMAX_DEFAULT_PROVIDER_MODEL should alias the current MiniMax provider default")
    if "MINIMAX_DEFAULT_PROVIDER_MODEL" not in audio_client:
        fail("external_api/audio/minimax_audio.py must resolve MiniMax preset through registry MINIMAX_DEFAULT_PROVIDER_MODEL")
    if "MINIMAX_DEFAULT_VIDEO_MODEL" in audio_client:
        fail("external_api/audio/minimax_audio.py must not depend on video-named MiniMax defaults")
    if registry.MINIMAX_DEFAULT_VIDEO_MODEL in audio_client:
        fail(
            "external_api/audio/minimax_audio.py must not hardcode "
            f"MiniMax default model literal {registry.MINIMAX_DEFAULT_VIDEO_MODEL!r}"
        )
    checks += 5

    for registry_name, literal in (
        ("SORA2_DEFAULT_VIDEO_MODEL", registry.SORA2_DEFAULT_VIDEO_MODEL),
        ("VEO_DEFAULT_VIDEO_MODEL", registry.VEO_DEFAULT_VIDEO_MODEL),
    ):
        if registry_name not in runtime_loader:
            fail(f"api_config_runtime_loader.py must use registry {registry_name} for legacy model upgrades")
        if literal in runtime_loader:
            fail(f"api_config_runtime_loader.py must not hardcode video default model literal {literal!r}")
        checks += 2

    return checks


def check_env_key_helpers(registry) -> int:
    derived: set[str] = set()
    for env_key in registry.PROVIDER_ENV_MAP.values():
        for helper in (
            registry.get_endpoint_env_key,
            registry.get_proxy_mode_env_key,
            registry.get_custom_proxy_env_key,
            registry.get_model_env_key,
        ):
            value = helper(env_key)
            if value in derived:
                fail(f"Duplicate derived env key: {value}")
            derived.add(value)
    for field_map in getattr(registry, "PROVIDER_EXTRA_ENV_MAP", {}).values():
        for value in field_map.values():
            if value in derived:
                fail(f"Provider extra env key collides with derived env key: {value}")
            derived.add(value)
    return len(derived)


def check_provider_extra_env_contract(registry, resolve_provider) -> int:
    minimax_extras = registry.get_provider_extra_env_keys("minimax")
    if minimax_extras.get("group_id") != "MINIMAX_GROUP_ID":
        fail(f"MiniMax group_id extra env mapping changed: {minimax_extras}")
    minimax_fields = registry.get_provider_extra_fields("minimax")
    if not minimax_fields or minimax_fields[0].get("field") != "group_id":
        fail(f"MiniMax group_id extra field metadata missing: {minimax_fields}")
    catalog = {item["provider"]: item for item in registry.get_api_provider_catalog()}
    catalog_fields = catalog.get("minimax", {}).get("extra_fields") or []
    if not catalog_fields or catalog_fields[0].get("env_key") != "MINIMAX_GROUP_ID":
        fail(f"Provider catalog did not expose MiniMax extra_fields metadata: {catalog_fields}")
    for provider, item in catalog.items():
        for link_key in ("docs_url", "console_url", "key_help"):
            if not item.get(link_key):
                fail(f"Provider catalog did not expose {provider} credential metadata: {link_key}")

    with isolated_env(registry):
        os.environ["MINIMAX_API_KEY"] = "minimax-test-key"
        os.environ["MINIMAX_GROUP_ID"] = "minimax-runtime-group"
        config = resolve_provider("minimax", "MiniMax-Hailuo-02")
        if config.extra.get("group_id") != "minimax-runtime-group":
            fail(f"Resolver did not expose MiniMax group_id extra config: {config.extra}")
        if config.source.get("extra", {}).get("group_id") != "MINIMAX_GROUP_ID":
            fail(f"Resolver did not report MiniMax group_id source: {config.source}")

    return 1


def check_provider_catalog_defaults(registry) -> int:
    catalog = {item["provider"]: item for item in registry.get_api_provider_catalog()}
    presets_by_provider: dict[str, dict] = {}
    for preset in registry.get_api_model_presets():
        provider = registry.normalize_provider(preset.get("provider", ""))
        if provider:
            presets_by_provider.setdefault(provider, preset)

    missing: list[str] = []
    for provider, preset in presets_by_provider.items():
        item = catalog.get(provider) or {}
        for field, preset_key in (
            ("default_config_name", "name"),
            ("default_endpoint", "endpoint"),
            ("default_model_name", "model_name"),
            ("default_category", "category"),
        ):
            if item.get(field) != preset.get(preset_key):
                missing.append(f"{provider}.{field}")
        if not item.get("default_proxy_mode"):
            missing.append(f"{provider}.default_proxy_mode")

    if missing:
        fail(f"Provider catalog default fields missing or mismatched: {missing}")
    return len(presets_by_provider)


def check_runtime_status(
    registry,
    build_provider_runtime_status,
    build_effective_provider_config_sources,
    preset_count: int,
) -> int:
    secret = "test-placeholder-credential"
    custom_proxy = "http://secret-proxy.example.invalid:7890"
    provider = "gemini-text"
    env_key = registry.get_provider_env_key(provider)
    endpoint_env = registry.get_endpoint_env_key(env_key)
    proxy_mode_env = registry.get_proxy_mode_env_key(env_key)
    custom_proxy_env = registry.get_custom_proxy_env_key(env_key)
    model_env = registry.get_model_env_key(env_key)

    class RecordLike:
        def __init__(self, data: dict[str, Any]):
            self.data = data

        def __getitem__(self, key: str) -> Any:
            return self.data[key]

    fake_configs = [
        RecordLike({
            "config_id": "apicfg_old",
            "name": "A old config",
            "provider": provider,
            "model_name": "gemini-2.5-flash",
            "endpoint": "https://old-runtime.example.test/v1",
            "proxy_mode": "direct",
            "category": "text",
            "enabled": True,
            "api_key_encrypted": "encrypted-old-key",
        }),
        RecordLike({
            "config_id": "apicfg_new",
            "name": "Z new config",
            "provider": provider,
            "model_name": "gemini-2.5-flash",
            "endpoint": "https://runtime.example.test/v1",
            "proxy_mode": "custom",
            "category": "text",
            "enabled": True,
            "api_key_encrypted": "encrypted-new-key",
        }),
    ]

    with isolated_env(registry):
        os.environ[env_key] = secret
        os.environ[endpoint_env] = "https://runtime.example.test/v1"
        os.environ[proxy_mode_env] = "custom"
        os.environ[custom_proxy_env] = custom_proxy
        os.environ[model_env] = "gemini-runtime-from-env"
        statuses = build_provider_runtime_status(
            fake_configs,
            provider_health=[
                {
                    "provider": provider,
                    "status": "error",
                    "latency_ms": 123,
                    "checked_at": "2026-06-19T00:00:00Z",
                    "cached_at": "2026-06-19T00:00:01Z",
                    "health": {"error": "probe failed"},
                }
            ],
        )
        sources = build_effective_provider_config_sources(fake_configs)
        rendered = json.dumps(statuses, ensure_ascii=False)

    if len(statuses) != preset_count:
        fail(f"Runtime status count changed: expected {preset_count}, got {len(statuses)}")
    if secret in rendered:
        fail("Runtime status leaked API key value")
    if custom_proxy in rendered:
        fail("Runtime status leaked custom proxy value")
    if "encrypted-new-key" in rendered or "encrypted-old-key" in rendered:
        fail("Runtime status leaked encrypted API key value")

    row = next((item for item in statuses if item.get("provider") == provider), None)
    if not row:
        fail(f"Runtime status missing provider {provider}")
    if not row.get("has_key"):
        fail(f"Runtime status did not detect env key for {provider}")
    if row.get("api_key_source") != env_key:
        fail(f"Runtime api_key_source mismatch: {row.get('api_key_source')} != {env_key}")
    if row.get("endpoint_source") != endpoint_env:
        fail(f"Runtime endpoint_source mismatch: {row.get('endpoint_source')} != {endpoint_env}")
    if row.get("operation_urls", {}).get("chat_completions") != "https://runtime.example.test/v1/chat/completions":
        fail(f"Runtime operation_urls did not derive from resolved endpoint: {row.get('operation_urls')}")
    if row.get("runtime_model_name") != row.get("model_name"):
        fail(f"Runtime status should resolve the row model_name explicitly: {row}")
    if row.get("model_source") != "request":
        fail(f"Runtime model_source should be request for preset status rows: {row.get('model_source')}")
    if row.get("model_env") != model_env:
        fail(f"Runtime model_env mismatch: {row.get('model_env')} != {model_env}")
    if not row.get("custom_proxy_configured"):
        fail("Runtime status did not mark custom proxy as configured")
    if row.get("custom_proxy_env") != custom_proxy_env:
        fail(f"Runtime custom_proxy_env mismatch: {row.get('custom_proxy_env')} != {custom_proxy_env}")
    if row.get("runtime_source") != "db":
        fail(f"Runtime source mismatch: {row.get('runtime_source')} != db")
    if row.get("db_effective_config_id") != "apicfg_new":
        fail(f"Runtime db_effective_config_id mismatch: {row.get('db_effective_config_id')}")
    if row.get("db_keyed_enabled_config_count") != 2:
        fail(f"Runtime db_keyed_enabled_config_count mismatch: {row.get('db_keyed_enabled_config_count')}")
    if "db_multiple_keyed_enabled_configs" not in (row.get("issues") or []):
        fail("Runtime status did not flag multiple keyed DB configs")
    if row.get("health_status") != "error":
        fail(f"Runtime status did not include provider health status: {row}")
    if row.get("health_latency_ms") != 123:
        fail(f"Runtime status did not include provider health latency: {row}")
    if row.get("health_checked_at") != "2026-06-19T00:00:00Z":
        fail(f"Runtime status did not include provider health checked_at: {row}")
    if row.get("health_error") != "probe failed":
        fail(f"Runtime status did not include provider health error: {row}")
    if "health_error" not in (row.get("issues") or []):
        fail(f"Runtime status did not flag provider health error: {row.get('issues')}")
    if sources.get(provider, {}).get("effective", {}).get("config_id") != "apicfg_new":
        fail("Effective DB source helper did not pick the last keyed config")
    return len(statuses)


def main() -> int:
    (
        registry,
        resolve_provider,
        resolve_provider_with_failover,
        build_provider_runtime_status,
        build_effective_provider_config_sources,
        normalize_provider_health_map,
    ) = import_registry_modules()
    check_registry_shape(registry)
    preset_count, provider_count = check_presets(registry, resolve_provider)
    reference_count = check_resolve_provider_references(registry)
    runtime_wired_file_count = check_expected_runtime_wiring(registry)
    external_endpoint_literal_checks = check_external_api_clients_have_no_endpoint_literals()
    external_runtime_refresh_checks = check_external_api_clients_refresh_runtime_config()
    endpoint_helper_checks = check_provider_endpoint_helpers()
    cluster_main_env_cache_checks = check_cluster_main_has_no_api_key_env_cache(registry)
    cluster_main_resolver_checks = check_cluster_main_has_no_provider_resolver_calls()
    runtime_env_read_checks = check_runtime_code_has_no_managed_provider_env_reads(registry)
    runtime_endpoint_literal_checks = check_runtime_code_has_no_third_party_endpoint_literals()
    api_config_env_refresh_checks = check_api_config_write_env_refresh_contract()
    api_config_dao_import_checks = check_api_config_service_dao_import_contract()
    gpt_image_tier_provider_count = check_gpt_image_tier_wiring(registry)
    gemini_image_alias_checks = check_gemini_image_alias_wiring(registry)
    video_default_model_checks = check_video_default_model_registry_wiring(registry)
    derived_env_count = check_env_key_helpers(registry)
    provider_extra_env_checks = check_provider_extra_env_contract(registry, resolve_provider)
    provider_catalog_default_checks = check_provider_catalog_defaults(registry)
    runtime_status_count = check_runtime_status(
        registry,
        build_provider_runtime_status,
        build_effective_provider_config_sources,
        preset_count,
    )
    failover_count = check_failover_contract(
        registry,
        resolve_provider_with_failover,
        build_provider_runtime_status,
    )
    fallback_env_key_only_checks = check_fallback_env_is_key_only(registry, resolve_provider)
    health_map_count = check_provider_health_map_contract(normalize_provider_health_map)

    print("Provider contract OK")
    print(f"  providers={provider_count}")
    print(f"  presets={preset_count}")
    print(f"  resolve_provider_references={reference_count}")
    print(f"  runtime_wired_files={runtime_wired_file_count}")
    print(f"  external_endpoint_literal_checks={external_endpoint_literal_checks}")
    print(f"  external_runtime_refresh_checks={external_runtime_refresh_checks}")
    print(f"  endpoint_helper_checks={endpoint_helper_checks}")
    print(f"  cluster_main_env_cache_checks={cluster_main_env_cache_checks}")
    print(f"  cluster_main_resolver_checks={cluster_main_resolver_checks}")
    print(f"  runtime_env_read_checks={runtime_env_read_checks}")
    print(f"  runtime_endpoint_literal_checks={runtime_endpoint_literal_checks}")
    print(f"  api_config_env_refresh_checks={api_config_env_refresh_checks}")
    print(f"  api_config_dao_import_checks={api_config_dao_import_checks}")
    print(f"  gpt_image_tier_providers={gpt_image_tier_provider_count}")
    print(f"  gemini_image_alias_checks={gemini_image_alias_checks}")
    print(f"  video_default_model_checks={video_default_model_checks}")
    print(f"  derived_env_keys={derived_env_count}")
    print(f"  provider_extra_env_checks={provider_extra_env_checks}")
    print(f"  provider_catalog_default_checks={provider_catalog_default_checks}")
    print(f"  runtime_status_rows={runtime_status_count}")
    print(f"  failover_checks={failover_count}")
    print(f"  fallback_env_key_only_checks={fallback_env_key_only_checks}")
    print(f"  health_map_checks={health_map_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
