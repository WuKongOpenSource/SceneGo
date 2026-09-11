"""Service layer for admin API configuration CRUD and diagnostics."""
from __future__ import annotations

import asyncio
import hmac
import json
import logging
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional

from dao.admin.api_config import ApiConfigDAO
from services.api_config_health_cache_service import (
    invalidate_provider_health_for_items,
)
from services.api_config_health_service import test_api_config_health
from services.api_config_health_service import test_api_config_real_generation
from services.api_config_reload_service import (
    ApiConfigReloadFailed,
    ReloadCallback,
    reload_api_env_after_config_change,
    reload_api_env_runtime,
)
from services.api_provider_health_monitor import (
    list_cached_provider_health,
    provider_health_cache_key,
    provider_health_monitor_state,
)
from services.api_provider_registry import (
    get_api_model_presets,
    get_api_provider_catalog,
    normalize_doubao_image_endpoint,
    normalize_doubao_image_model_for_endpoint,
    normalize_model_bindings,
    normalize_provider,
    normalize_seedance_endpoint,
    normalize_seedance_model_for_endpoint,
    primary_model_name_for_bindings,
    provider_billing_channel,
    seedance_access_mode,
    summarize_api_provider_configs,
)
from services.api_provider_runtime import (
    build_effective_provider_config_sources,
    build_provider_runtime_status,
    resolve_provider,
)
from services.provider_endpoint_policy import (
    ProviderEndpointPolicyError,
    validate_provider_connection,
    validate_provider_headers,
)
from services.sensitive_data_redaction import redact_sensitive_text
from utils.config_helpers import _config_get


logger = logging.getLogger(__name__)


class ApiConfigServiceError(RuntimeError):
    pass


class ApiConfigNotFound(ApiConfigServiceError):
    pass


class ApiConfigCreateFailed(ApiConfigServiceError):
    pass


class ApiConfigImportFailed(ApiConfigServiceError):
    pass


class ApiConfigActivationFailed(ApiConfigServiceError):
    pass


def _row_to_jsonable(row: Any) -> Dict[str, Any]:
    if row is None:
        return {}
    if isinstance(row, dict):
        raw = dict(row)
    else:
        raw = dict(row)
    out: Dict[str, Any] = {}
    for key, value in raw.items():
        if isinstance(value, (datetime, date)):
            out[key] = value.isoformat()
        elif isinstance(value, Decimal):
            out[key] = float(value)
        else:
            out[key] = value
    return out


def mask_api_config_row(row: Any) -> Dict[str, Any]:
    data = _row_to_jsonable(row)
    provider = str(data.get("provider") or "")
    endpoint = str(data.get("endpoint") or "")
    provider_id = normalize_provider(provider)
    if provider_id == "doubao":
        endpoint = normalize_doubao_image_endpoint(endpoint)
        data["endpoint"] = endpoint
    elif provider_id == "seedance":
        endpoint = normalize_seedance_endpoint(endpoint)
        data["endpoint"] = endpoint
    bindings, primary_model = _normalized_model_fields(
        provider,
        data.get("model_bindings"),
        str(data.get("model_name") or ""),
        endpoint=endpoint,
    )
    data["model_bindings"] = bindings
    data["model_name"] = primary_model
    encrypted_key = data.get("api_key_encrypted")
    if "api_key_encrypted" in data:
        data["has_key"] = bool(encrypted_key)
        if encrypted_key:
            key = ApiConfigDAO.decrypt_key(str(encrypted_key))
            data["api_key_preview"] = f"****{key[-4:]}" if key else "****"
        else:
            data["api_key_preview"] = ""
        data["api_key_encrypted"] = "***" if encrypted_key else ""
    return data


def _row_provider(row: Any) -> str:
    if not row:
        return ""
    return str(_config_get(row, "provider", "") or "").strip()


def _provider_runtime_channel(row: Any) -> tuple[str, str]:
    provider = normalize_provider(_row_provider(row))
    endpoint = str(_config_get(row, "endpoint", "") or "")
    request_template = _config_get(row, "request_template", {})
    return provider, provider_billing_channel(provider, endpoint, request_template)


def _row_model_name(row: Any) -> str:
    if not row:
        return ""
    return str(_config_get(row, "model_name", "") or "").strip()


def _row_model_bindings(row: Any) -> List[Dict[str, str]]:
    bindings, _ = _normalized_model_fields(
        _row_provider(row),
        _config_get(row, "model_bindings", []),
        _row_model_name(row),
        endpoint=str(_config_get(row, "endpoint", "") or ""),
    )
    return bindings


def _row_config_id(row: Any) -> str:
    if not row:
        return ""
    return str(_config_get(row, "config_id", "") or "").strip()


def _row_enabled(row: Any) -> bool:
    if not row:
        return False
    return _config_get(row, "enabled", True) is not False


def _row_has_key(row: Any) -> bool:
    if not row:
        return False
    return bool(_config_get(row, "api_key_encrypted", ""))


def _row_plaintext_key(row: Any) -> str:
    encrypted = str(_config_get(row, "api_key_encrypted", "") or "")
    return ApiConfigDAO.decrypt_key(encrypted) if encrypted else ""


async def _find_duplicate_api_card(
    provider: str,
    api_key: str,
    *,
    endpoint: str = "",
    request_template: Optional[Dict[str, Any]] = None,
    exclude_config_id: str = "",
) -> Optional[Any]:
    provider_id = normalize_provider(provider)
    candidate_key = str(api_key or "").strip()
    if not provider_id or not candidate_key:
        return None
    for row in await ApiConfigDAO.list_all():
        if exclude_config_id and _row_config_id(row) == exclude_config_id:
            continue
        if normalize_provider(_row_provider(row)) != provider_id:
            continue
        row_endpoint = str(_config_get(row, "endpoint", "") or "")
        row_channel = provider_billing_channel(
            provider_id,
            row_endpoint,
            _config_get(row, "request_template", {}),
        )
        candidate_channel = provider_billing_channel(provider_id, endpoint, request_template)
        if row_channel != candidate_channel:
            continue
        existing_key = _row_plaintext_key(row)
        if existing_key and hmac.compare_digest(existing_key, candidate_key):
            return row
    return None


def _normalized_model_fields(
    provider: str,
    model_bindings: Any,
    model_name: str = "",
    *,
    endpoint: str = "",
) -> tuple[List[Dict[str, str]], str]:
    bindings = normalize_model_bindings(provider, model_bindings, model_name)
    provider_id = normalize_provider(provider)
    if provider_id == "doubao":
        bindings = normalize_model_bindings(
            provider,
            [
                {
                    **binding,
                    "model_name": normalize_doubao_image_model_for_endpoint(
                        binding.get("model_name"),
                        endpoint,
                    ),
                }
                for binding in bindings
            ],
        )
    elif provider_id == "seedance":
        bindings = normalize_model_bindings(
            provider,
            [
                {
                    **binding,
                    "model_name": normalize_seedance_model_for_endpoint(
                        binding.get("model_name"),
                        endpoint,
                        binding.get("operation"),
                    ),
                }
                for binding in bindings
            ],
        )
        allowed_operations = (
            {"agent_plan"}
            if seedance_access_mode(endpoint) == "agent_plan"
            else {"standard", "fast", "mini"}
        )
        bindings = [
            binding
            for binding in bindings
            if str(binding.get("operation") or "").strip().lower() in allowed_operations
        ]
    return bindings, primary_model_name_for_bindings(bindings, model_name)


def _normalized_endpoint(provider: str, endpoint: Any) -> str:
    value = str(endpoint or "").strip()
    provider_id = normalize_provider(provider)
    if provider_id == "doubao":
        return normalize_doubao_image_endpoint(value)
    if provider_id == "seedance":
        return normalize_seedance_endpoint(value)
    return value


def _validated_connection_fields(
    provider: str,
    endpoint: Any,
    proxy_mode: Any = "direct",
    custom_proxy: Any = "",
) -> tuple[str, str, str]:
    """Normalize and validate every administrator-controlled outbound target."""
    normalized_endpoint = _normalized_endpoint(provider, endpoint)
    try:
        return validate_provider_connection(
            normalized_endpoint,
            str(proxy_mode or "direct"),
            str(custom_proxy or ""),
        )
    except ProviderEndpointPolicyError as exc:
        raise ApiConfigCreateFailed(str(exc)) from exc


def _validated_headers(value: Any) -> Dict[str, str]:
    try:
        return validate_provider_headers(value)
    except ProviderEndpointPolicyError as exc:
        raise ApiConfigCreateFailed(str(exc)) from exc


def _endpoint_key(value: Any) -> str:
    return str(value or "").strip().rstrip("/").lower()


def _runtime_for_row(row: Any) -> Any:
    provider = normalize_provider(_row_provider(row))
    model_name = _row_model_name(row) or None
    return resolve_provider(provider, model_name)


def _test_row_and_endpoint_source(row: Any, runtime: Any) -> tuple[Dict[str, Any], str, bool]:
    test_row = _row_to_jsonable(row)
    row_endpoint = str(test_row.get("endpoint") or "").strip()
    if row_endpoint:
        return test_row, "db", False
    runtime_endpoint = str(getattr(runtime, "endpoint", "") or "").strip() if runtime else ""
    if not runtime_endpoint:
        return test_row, "missing", False
    test_row["endpoint"] = runtime_endpoint
    proxy_config = getattr(runtime, "proxy_config", {}) or {}
    test_row["proxy_mode"] = proxy_config.get("mode") or test_row.get("proxy_mode") or "direct"
    test_row["custom_proxy"] = proxy_config.get("custom_proxy") or test_row.get("custom_proxy") or ""
    return test_row, "runtime", True


def _annotate_config_health_test(
    test: Dict[str, Any],
    *,
    row: Any,
    runtime: Any,
    effective_config: Optional[Dict[str, Any]],
    key_source: str,
    key_env: Optional[str],
    endpoint_source: str,
    used_runtime_endpoint: bool,
) -> None:
    config_id = _row_config_id(row)
    effective_config_id = str((effective_config or {}).get("config_id") or "")
    test["key_source"] = key_source
    test["key_env"] = key_env
    test["used_runtime_key"] = key_source == "runtime"
    test["config_enabled"] = _row_enabled(row)
    test["runtime_effective_config_id"] = effective_config_id or None
    test["runtime_effective_config_name"] = (effective_config or {}).get("name") or None
    test["is_runtime_effective"] = bool(config_id and effective_config_id and config_id == effective_config_id)
    test["endpoint_source"] = endpoint_source
    test["used_runtime_endpoint"] = used_runtime_endpoint

    row_endpoint = str(_row_to_jsonable(row).get("endpoint") or "").strip()
    runtime_endpoint = str(getattr(runtime, "endpoint", "") or "").strip() if runtime else ""
    if runtime_endpoint:
        source = getattr(runtime, "source", {}) or {}
        test["runtime_endpoint"] = runtime_endpoint
        test["runtime_endpoint_source"] = source.get("endpoint") or "missing"
        test["runtime_endpoint_env"] = getattr(runtime, "endpoint_env", None)
        test["runtime_model_name"] = getattr(runtime, "model_name", "") or None
        test["endpoint_matches_runtime"] = (
            _endpoint_key(row_endpoint) == _endpoint_key(runtime_endpoint)
            if row_endpoint
            else used_runtime_endpoint
        )
    else:
        test["endpoint_matches_runtime"] = None


async def _test_api_config_row_health(
    row: Any,
    *,
    effective_sources: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    config_id = _row_config_id(row)
    runtime = None
    try:
        runtime = _runtime_for_row(row)
    except Exception as exc:
        logger.warning("Runtime config lookup failed for config %s: %s", config_id, exc, exc_info=True)
    effective_config: Optional[Dict[str, Any]] = None
    try:
        sources = (
            effective_sources
            if effective_sources is not None
            else build_effective_provider_config_sources(list(await ApiConfigDAO.list_all()))
        )
        effective_config = (sources.get(normalize_provider(_row_provider(row))) or {}).get("effective")
    except Exception as exc:
        logger.warning("Effective runtime config lookup failed for config %s: %s", config_id, exc, exc_info=True)

    key = await ApiConfigDAO.get_decrypted_key(config_id) if config_id else None
    key_source = "db" if key else "missing"
    key_env: Optional[str] = None
    if not key and runtime and runtime.has_key:
        key = runtime.api_key
        key_source = "runtime"
        key_env = runtime.api_key_env

    test_row, endpoint_source, used_runtime_endpoint = _test_row_and_endpoint_source(row, runtime)
    result = await test_api_config_health(test_row, key or "")
    test = result.get("test")
    if isinstance(test, dict):
        _annotate_config_health_test(
            test,
            row=row,
            runtime=runtime,
            effective_config=effective_config,
            key_source=key_source,
            key_env=key_env,
            endpoint_source=endpoint_source,
            used_runtime_endpoint=used_runtime_endpoint,
        )
    return result


async def _disable_conflicting_provider_configs(row: Any) -> tuple[List[str], List[Any]]:
    """Keep at most one enabled keyed config per provider channel.

    Plan and pay-as-you-go cards are independent runtime channels for every
    provider. Rows within the same billing channel still conflict.
    """
    provider = _row_provider(row)
    keep_id = _row_config_id(row)
    if not provider or not keep_id or not _row_enabled(row) or not _row_has_key(row):
        return [], []

    disabled: List[str] = []
    disabled_rows: List[Any] = []
    for other in await ApiConfigDAO.list_all():
        other_id = _row_config_id(other)
        if not other_id or other_id == keep_id:
            continue
        if _row_provider(other).lower() != provider.lower():
            continue
        if not _row_enabled(other) or not _row_has_key(other):
            continue
        if _provider_runtime_channel(row) != _provider_runtime_channel(other):
            continue
        await ApiConfigDAO.update(other_id, enabled=False)
        disabled.append(other_id)
        disabled_rows.append(other)
    return disabled, disabled_rows


async def list_api_configs() -> Dict[str, Any]:
    rows = await ApiConfigDAO.list_all()
    provider_health_targets = [
        {
            "provider": _row_provider(row),
            "model_name": binding.get("model_name") or None,
        }
        for row in rows
        for binding in (_row_model_bindings(row) or [{"model_name": _row_model_name(row)}])
        if _row_provider(row)
    ]
    provider_health_by_key: Dict[str, Dict[str, Any]] = {}
    for item in await list_cached_provider_health():
        provider_health_by_key[
            provider_health_cache_key(str(item.get("provider") or ""), item.get("model_name"))
        ] = item
    for item in await list_cached_provider_health(targets=provider_health_targets):
        provider_health_by_key[
            provider_health_cache_key(str(item.get("provider") or ""), item.get("model_name"))
        ] = item
    provider_health = list(provider_health_by_key.values())
    return {
        "success": True,
        "api_configs": [mask_api_config_row(row) for row in rows],
        "providers": get_api_provider_catalog(),
        "provider_status": summarize_api_provider_configs(rows),
        "runtime_status": build_provider_runtime_status(rows, provider_health=provider_health),
        "provider_health": provider_health,
        "monitor_state": provider_health_monitor_state(),
    }


def get_api_config_presets() -> Dict[str, Any]:
    return {
        "success": True,
        "presets": get_api_model_presets(),
        "providers": get_api_provider_catalog(),
    }


def _json_object(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
        except Exception:
            return {}
        return dict(parsed) if isinstance(parsed, dict) else {}
    return {}


def _bool_value(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"1", "true", "yes", "y", "on"}:
            return True
        if text in {"0", "false", "no", "n", "off"}:
            return False
    return bool(value)


def _backup_credential_key(provider: Any, api_key: Any) -> tuple[str, str]:
    return normalize_provider(str(provider or "")), str(api_key or "").strip()


def _export_api_config_item(row: Any) -> Dict[str, Any]:
    data = _row_to_jsonable(row)
    encrypted_key = str(data.get("api_key_encrypted") or "")
    api_key = ApiConfigDAO.decrypt_key(encrypted_key) if encrypted_key else ""
    return {
        "name": str(data.get("name") or ""),
        "provider": str(data.get("provider") or ""),
        "endpoint": str(data.get("endpoint") or ""),
        "api_key": api_key,
        "model_name": str(data.get("model_name") or ""),
        "model_bindings": normalize_model_bindings(
            str(data.get("provider") or ""),
            data.get("model_bindings"),
            str(data.get("model_name") or ""),
        ),
        "proxy_mode": str(data.get("proxy_mode") or "direct"),
        "custom_proxy": str(data.get("custom_proxy") or ""),
        "request_template": _json_object(data.get("request_template")),
        "headers": _json_object(data.get("headers")),
        "category": str(data.get("category") or ""),
        "enabled": data.get("enabled") is not False,
        "has_key": bool(encrypted_key),
    }


async def export_api_config_keys() -> Dict[str, Any]:
    rows = list(await ApiConfigDAO.list_all())
    configs = [_export_api_config_item(row) for row in rows]
    return {
        "success": True,
        "schema": "ostory.api_config_keys",
        "schema_version": 2,
        "exported_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "count": len(configs),
        "configs": configs,
    }


def _extract_import_items(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        raw_items = payload
    elif isinstance(payload, dict):
        raw_items = payload.get("configs")
        if raw_items is None:
            raw_items = payload.get("api_configs")
    else:
        raw_items = None
    if not isinstance(raw_items, list):
        raise ApiConfigImportFailed("No configs found in API key backup")
    return [item for item in raw_items if isinstance(item, dict)]


def _clean_import_item(
    item: Dict[str, Any],
    *,
    index: int,
    enable_imported: bool,
) -> tuple[Optional[Dict[str, Any]], Optional[str]]:
    provider = normalize_provider(str(item.get("provider") or "").strip())
    name = str(item.get("name") or "").strip()
    endpoint = str(item.get("endpoint") or "").strip()
    api_key = str(item.get("api_key") or item.get("key") or "").strip()
    model_name = str(item.get("model_name") or "").strip()
    if not provider:
        return None, f"item {index + 1}: missing provider"
    if not name:
        name = model_name or provider
    if not endpoint:
        return None, f"item {index + 1}: missing endpoint"
    try:
        endpoint, proxy_mode, custom_proxy = _validated_connection_fields(
            provider,
            endpoint,
            item.get("proxy_mode") or "direct",
            item.get("custom_proxy") or "",
        )
        headers = _validated_headers(_json_object(item.get("headers")))
    except ApiConfigCreateFailed as exc:
        return None, f"item {index + 1}: {exc}"
    if not api_key:
        return None, f"item {index + 1}: missing api_key"
    model_bindings, primary_model = _normalized_model_fields(
        provider,
        item.get("model_bindings"),
        model_name,
        endpoint=endpoint,
    )
    return {
        "name": name,
        "provider": provider,
        "endpoint": endpoint,
        "api_key": api_key,
        "model_name": primary_model,
        "model_bindings": model_bindings,
        "proxy_mode": proxy_mode,
        "custom_proxy": custom_proxy,
        "request_template": _json_object(item.get("request_template")),
        "headers": headers,
        "category": str(item.get("category") or "").strip(),
        "enabled": _bool_value(item.get("enabled"), enable_imported),
    }, None


async def import_api_config_keys(
    payload: Any,
    *,
    overwrite_existing: bool = False,
    enable_imported: bool = True,
    dry_run: bool = False,
    reload_api_env: Optional[ReloadCallback] = None,
) -> Dict[str, Any]:
    items = _extract_import_items(payload)
    if not items:
        raise ApiConfigImportFailed("No valid API config items found in backup")

    existing_rows = list(await ApiConfigDAO.list_all())
    existing_by_key = {
        _backup_credential_key(_row_provider(row), _row_plaintext_key(row)): row
        for row in existing_rows
        if _row_plaintext_key(row)
    }

    created = 0
    updated = 0
    skipped = 0
    invalid = 0
    details: List[Dict[str, Any]] = []
    touched_rows: List[Any] = []
    disabled_conflict_ids: List[str] = []
    disabled_conflict_rows: List[Any] = []

    for index, item in enumerate(items):
        cleaned, error = _clean_import_item(
            item,
            index=index,
            enable_imported=enable_imported,
        )
        if error or not cleaned:
            invalid += 1
            details.append({"index": index, "action": "invalid", "reason": error})
            continue

        item_key = _backup_credential_key(cleaned.get("provider"), cleaned.get("api_key"))
        existing = existing_by_key.get(item_key)
        detail = {
            "index": index,
            "name": cleaned["name"],
            "provider": cleaned["provider"],
            "model_name": cleaned.get("model_name") or None,
        }

        if existing:
            merge_endpoint = (
                cleaned.get("endpoint", "")
                if overwrite_existing
                else str(_config_get(existing, "endpoint", "") or "")
            )
            merged_bindings, merged_primary = _normalized_model_fields(
                cleaned["provider"],
                [*_row_model_bindings(existing), *cleaned.get("model_bindings", [])],
                cleaned.get("model_name") or _row_model_name(existing),
                endpoint=merge_endpoint,
            )
            if overwrite_existing:
                cleaned = {
                    **cleaned,
                    "model_bindings": merged_bindings,
                    "model_name": merged_primary,
                }
            else:
                cleaned = {
                    "model_bindings": merged_bindings,
                    "model_name": merged_primary,
                }

        if dry_run:
            if existing:
                updated += 1
                details.append({**detail, "action": "would_merge", "config_id": _row_config_id(existing)})
            else:
                created += 1
                details.append({**detail, "action": "would_create"})
            continue

        try:
            if existing:
                row = await ApiConfigDAO.update(_row_config_id(existing), **cleaned)
                if not row:
                    raise ApiConfigImportFailed("Failed to update API config")
                updated += 1
                details.append({**detail, "action": "merged", "config_id": _row_config_id(row)})
            else:
                row = await ApiConfigDAO.create(**cleaned)
                if not row:
                    raise ApiConfigImportFailed("Failed to create API config")
                created += 1
                details.append({**detail, "action": "created", "config_id": _row_config_id(row)})

            existing_by_key[item_key] = row
            touched_rows.append(row)
            disabled_ids, disabled_rows = await _disable_conflicting_provider_configs(row)
            disabled_conflict_ids.extend(disabled_ids)
            disabled_conflict_rows.extend(disabled_rows)
        except Exception as exc:
            logger.warning("API config key import item failed (index=%s): %s", index, exc, exc_info=True)
            invalid += 1
            details.append({**detail, "action": "invalid", "reason": str(exc)})

    modified = created + updated
    env_refreshed: Optional[bool] = None
    if modified and not dry_run:
        env_refreshed = await reload_api_env_after_config_change(reload_api_env)
        await invalidate_provider_health_for_items([*touched_rows, *disabled_conflict_rows])

    return {
        "success": True,
        "dry_run": dry_run,
        "total": len(items),
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "invalid": invalid,
        "env_refreshed": env_refreshed,
        "disabled_conflicting_config_ids": list(dict.fromkeys(disabled_conflict_ids)),
        "items": details,
    }


async def create_api_config(
    *,
    name: str,
    provider: str,
    endpoint: str,
    api_key: str,
    model_name: str = "",
    model_bindings: Optional[List[Dict[str, Any]]] = None,
    proxy_mode: str = "direct",
    custom_proxy: str = "",
    request_template: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, Any]] = None,
    category: str = "",
    enabled: bool = True,
    reload_api_env: Optional[ReloadCallback] = None,
) -> Dict[str, Any]:
    provider_id = provider.strip()
    normalized_endpoint, proxy_mode, custom_proxy = _validated_connection_fields(
        provider_id,
        endpoint,
        proxy_mode,
        custom_proxy,
    )
    duplicate = await _find_duplicate_api_card(
        provider_id,
        api_key,
        endpoint=normalized_endpoint,
        request_template=request_template,
    )
    if duplicate:
        raise ApiConfigCreateFailed(
            f"This API key already has a card for provider {normalize_provider(provider_id)}: "
            f"{_row_config_id(duplicate)}"
        )
    normalized_bindings, primary_model = _normalized_model_fields(
        provider_id,
        model_bindings,
        model_name,
        endpoint=normalized_endpoint,
    )
    normalized_headers = _validated_headers(headers)
    row = await ApiConfigDAO.create(
        name=name.strip(),
        provider=provider_id,
        endpoint=normalized_endpoint,
        api_key=api_key,
        model_name=primary_model,
        model_bindings=normalized_bindings,
        proxy_mode=proxy_mode,
        custom_proxy=custom_proxy,
        request_template=request_template,
        headers=normalized_headers,
        category=category,
        enabled=enabled,
    )
    if not row:
        raise ApiConfigCreateFailed("Failed to create API config")
    disabled_conflicts, disabled_conflict_rows = await _disable_conflicting_provider_configs(row)
    env_refreshed = await reload_api_env_after_config_change(reload_api_env)
    await invalidate_provider_health_for_items([row, *disabled_conflict_rows])
    return {
        "success": True,
        "api_config": mask_api_config_row(row),
        "env_refreshed": env_refreshed,
        "disabled_conflicting_config_ids": disabled_conflicts,
    }


async def create_api_config_key_batch(
    *,
    provider: str,
    endpoint: str,
    api_keys: List[str],
    name_prefix: str = "",
    model_name: str = "",
    model_bindings: Optional[List[Dict[str, Any]]] = None,
    proxy_mode: str = "direct",
    custom_proxy: str = "",
    request_template: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, Any]] = None,
    category: str = "",
    activate_index: int = 0,
    reload_api_env: Optional[ReloadCallback] = None,
) -> Dict[str, Any]:
    cleaned_keys = [key.strip() for key in api_keys if key and key.strip()]
    deduped_keys = list(dict.fromkeys(cleaned_keys))
    if not deduped_keys:
        raise ApiConfigCreateFailed("No API keys provided")

    provider_id = provider.strip()
    normalized_endpoint, proxy_mode, custom_proxy = _validated_connection_fields(
        provider_id,
        endpoint,
        proxy_mode,
        custom_proxy,
    )
    duplicate_rows: List[Any] = []
    new_keys: List[str] = []
    for api_key in deduped_keys:
        duplicate = await _find_duplicate_api_card(
            provider_id,
            api_key,
            endpoint=normalized_endpoint,
            request_template=request_template,
        )
        if duplicate:
            duplicate_rows.append(duplicate)
        else:
            new_keys.append(api_key)
    if not new_keys:
        duplicate_ids = ", ".join(_row_config_id(row) for row in duplicate_rows if _row_config_id(row))
        raise ApiConfigCreateFailed(f"All provided API keys already have cards: {duplicate_ids}")

    normalized_bindings, primary_model = _normalized_model_fields(
        provider_id,
        model_bindings,
        model_name,
        endpoint=normalized_endpoint,
    )
    normalized_headers = _validated_headers(headers)

    active_index = max(0, min(int(activate_index or 0), len(new_keys) - 1))
    prefix = name_prefix.strip() or f"{provider_id} key"
    created_rows: List[Any] = []
    for index, api_key in enumerate(new_keys):
        row = await ApiConfigDAO.create(
            name=f"{prefix} #{index + 1}",
            provider=provider_id,
            endpoint=normalized_endpoint,
            api_key=api_key,
            model_name=primary_model,
            model_bindings=normalized_bindings,
            proxy_mode=proxy_mode,
            custom_proxy=custom_proxy,
            request_template=request_template,
            headers=normalized_headers,
            category=category,
            enabled=index == active_index,
        )
        if not row:
            raise ApiConfigCreateFailed("Failed to create API config")
        created_rows.append(row)

    active_row = created_rows[active_index]
    disabled_conflicts, disabled_conflict_rows = await _disable_conflicting_provider_configs(active_row)
    env_refreshed = await reload_api_env_after_config_change(reload_api_env)
    await invalidate_provider_health_for_items([*created_rows, *disabled_conflict_rows])
    return {
        "success": True,
        "created": len(created_rows),
        "skipped_existing": len(duplicate_rows),
        "existing_config_ids": [_row_config_id(row) for row in duplicate_rows if _row_config_id(row)],
        "active_config_id": _row_config_id(active_row),
        "api_configs": [mask_api_config_row(row) for row in created_rows],
        "env_refreshed": env_refreshed,
        "disabled_conflicting_config_ids": disabled_conflicts,
    }


async def activate_api_config(
    config_id: str,
    *,
    reload_api_env: Optional[ReloadCallback] = None,
) -> Dict[str, Any]:
    target = await ApiConfigDAO.get_by_id(config_id)
    if not target:
        raise ApiConfigNotFound("Config not found")
    if not _row_has_key(target):
        raise ApiConfigActivationFailed("Cannot activate config without API key")
    provider = _row_provider(target)
    if not provider:
        raise ApiConfigActivationFailed("Cannot activate config without provider")
    try:
        _validated_connection_fields(
            provider,
            _config_get(target, "endpoint", ""),
            _config_get(target, "proxy_mode", "direct"),
            _config_get(target, "custom_proxy", ""),
        )
    except ApiConfigCreateFailed as exc:
        raise ApiConfigActivationFailed(str(exc)) from exc

    touched_rows: List[Any] = [target]
    activated = await ApiConfigDAO.update(config_id, enabled=True)
    if not activated:
        raise ApiConfigNotFound("Config not found")
    touched_rows.append(activated)

    disabled_ids: List[str] = []
    target_channel = _provider_runtime_channel(activated)
    for row in await ApiConfigDAO.list_all():
        other_id = _row_config_id(row)
        if not other_id or other_id == config_id:
            continue
        if _row_provider(row).lower() != provider.lower():
            continue
        if not _row_has_key(row) or not _row_enabled(row):
            continue
        if _provider_runtime_channel(row) != target_channel:
            continue
        disabled = await ApiConfigDAO.update(other_id, enabled=False)
        disabled_ids.append(other_id)
        if disabled:
            touched_rows.append(disabled)

    env_refreshed = await reload_api_env_after_config_change(reload_api_env)
    await invalidate_provider_health_for_items(touched_rows)
    return {
        "success": True,
        "active_config_id": config_id,
        "api_config": mask_api_config_row(activated),
        "disabled_config_ids": disabled_ids,
        "env_refreshed": env_refreshed,
    }


async def update_api_config(
    config_id: str,
    fields: Dict[str, Any],
    *,
    reload_api_env: Optional[ReloadCallback] = None,
) -> Dict[str, Any]:
    if not fields:
        row = await ApiConfigDAO.get_by_id(config_id)
        if not row:
            raise ApiConfigNotFound("Config not found")
        return {"success": True, "api_config": mask_api_config_row(row)}

    before = await ApiConfigDAO.get_by_id(config_id)
    if not before:
        raise ApiConfigNotFound("Config not found")
    provider = str(fields.get("provider") or _row_provider(before)).strip()
    if "endpoint" in fields:
        fields = {
            **fields,
            "endpoint": _normalized_endpoint(provider, fields.get("endpoint")),
        }
    effective_endpoint = str(
        fields.get("endpoint") or _config_get(before, "endpoint", "") or ""
    )
    effective_proxy_mode = str(
        fields.get("proxy_mode") or _config_get(before, "proxy_mode", "direct") or "direct"
    )
    effective_custom_proxy = str(
        fields.get("custom_proxy")
        if "custom_proxy" in fields
        else _config_get(before, "custom_proxy", "") or ""
    )
    validated_endpoint, validated_proxy_mode, validated_custom_proxy = _validated_connection_fields(
        provider,
        effective_endpoint,
        effective_proxy_mode,
        effective_custom_proxy,
    )
    effective_endpoint = validated_endpoint
    if "endpoint" in fields or "provider" in fields:
        fields = {**fields, "endpoint": validated_endpoint}
    if "proxy_mode" in fields:
        fields = {**fields, "proxy_mode": validated_proxy_mode}
    if "custom_proxy" in fields:
        fields = {**fields, "custom_proxy": validated_custom_proxy}
    if "headers" in fields:
        fields = {**fields, "headers": _validated_headers(fields.get("headers"))}
    replacement_key = str(fields.get("api_key") or "").strip()
    if replacement_key:
        duplicate = await _find_duplicate_api_card(
            provider,
            replacement_key,
            endpoint=effective_endpoint,
            request_template=fields.get(
                "request_template",
                _config_get(before, "request_template", {}),
            ),
            exclude_config_id=config_id,
        )
        if duplicate:
            raise ApiConfigCreateFailed(
                f"This API key already has a card for provider {normalize_provider(provider)}: "
                f"{_row_config_id(duplicate)}"
            )

    if (
        "model_bindings" in fields
        or "model_name" in fields
        or "provider" in fields
        or "endpoint" in fields
    ):
        raw_bindings = fields.get("model_bindings")
        if raw_bindings is None and "model_name" not in fields:
            raw_bindings = _config_get(before, "model_bindings", [])
        legacy_model = str(fields.get("model_name") or "")
        if "model_name" not in fields:
            legacy_model = _row_model_name(before)
        normalized_bindings, primary_model = _normalized_model_fields(
            provider,
            raw_bindings,
            legacy_model,
            endpoint=effective_endpoint,
        )
        fields = {
            **fields,
            "model_bindings": normalized_bindings,
            "model_name": primary_model,
        }
    updated = await ApiConfigDAO.update(config_id, **fields)
    if not updated:
        raise ApiConfigNotFound("Config not found")
    disabled_conflicts, disabled_conflict_rows = await _disable_conflicting_provider_configs(updated)
    env_refreshed = await reload_api_env_after_config_change(reload_api_env)
    await invalidate_provider_health_for_items([before, updated, *disabled_conflict_rows])
    return {
        "success": True,
        "api_config": mask_api_config_row(updated),
        "env_refreshed": env_refreshed,
        "disabled_conflicting_config_ids": disabled_conflicts,
    }


async def delete_api_config(
    config_id: str,
    *,
    reload_api_env: Optional[ReloadCallback] = None,
) -> Dict[str, Any]:
    before = await ApiConfigDAO.get_by_id(config_id)
    ok = await ApiConfigDAO.delete(config_id)
    if not ok:
        raise ApiConfigNotFound("Config not found")
    env_refreshed = await reload_api_env_after_config_change(reload_api_env)
    await invalidate_provider_health_for_items([before])
    return {"success": True, "deleted": True, "env_refreshed": env_refreshed}


async def repair_api_config_provider_conflicts(
    *,
    reload_api_env: Optional[ReloadCallback] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Merge legacy cards into real credential cards, then resolve active conflicts."""
    all_rows = list(await ApiConfigDAO.list_all())
    rows = list(all_rows)
    credential_groups: Dict[tuple[str, str, str], List[Any]] = {}
    for row in rows:
        provider, channel = _provider_runtime_channel(row)
        api_key = _row_plaintext_key(row)
        if provider and api_key:
            credential_groups.setdefault((provider, channel, api_key), []).append(row)

    merged_cards: List[Dict[str, Any]] = []
    deleted_duplicate_ids: set[str] = set()
    touched_items: List[Any] = []
    for (provider, _channel, _), duplicate_rows in credential_groups.items():
        if len(duplicate_rows) <= 1:
            continue
        enabled_rows = [row for row in duplicate_rows if _row_enabled(row)]
        keep = (enabled_rows or duplicate_rows)[-1]
        keep_id = _row_config_id(keep)
        merged_binding_input = [
            binding
            for row in duplicate_rows
            for binding in _row_model_bindings(row)
        ]
        merged_bindings, primary_model = _normalized_model_fields(
            provider,
            merged_binding_input,
            _row_model_name(keep),
            endpoint=str(_config_get(keep, "endpoint", "") or ""),
        )
        duplicate_ids = [
            _row_config_id(row)
            for row in duplicate_rows
            if _row_config_id(row) and _row_config_id(row) != keep_id
        ]
        merged_cards.append(
            {
                "provider": provider,
                "kept_config_id": keep_id,
                "deleted_config_ids": duplicate_ids,
                "model_bindings": merged_bindings,
                "dry_run": dry_run,
            }
        )
        touched_items.extend(duplicate_rows)
        deleted_duplicate_ids.update(duplicate_ids)
        if not dry_run:
            await ApiConfigDAO.update(
                keep_id,
                model_bindings=merged_bindings,
                model_name=primary_model,
            )
            for duplicate_id in duplicate_ids:
                await ApiConfigDAO.delete(duplicate_id)

    rows = [row for row in rows if _row_config_id(row) not in deleted_duplicate_ids]

    # Older preset imports created one keyless row per model. Under the current
    # one-credential/one-card model those rows are not cards: their bindings
    # belong on every real credential card for the provider.
    provider_rows: Dict[tuple[str, str], List[Any]] = {}
    for row in rows:
        provider, channel = _provider_runtime_channel(row)
        if provider:
            provider_rows.setdefault((provider, channel), []).append(row)

    absorbed_placeholder_groups: List[Dict[str, Any]] = []
    deleted_placeholder_ids: set[str] = set()
    for (provider, _channel), candidates in provider_rows.items():
        keyed_rows = [row for row in candidates if _row_has_key(row)]
        placeholder_rows = [row for row in candidates if not _row_has_key(row)]
        if not keyed_rows or not placeholder_rows:
            continue

        placeholder_bindings = [
            binding
            for row in placeholder_rows
            for binding in _row_model_bindings(row)
        ]
        placeholder_ids = [
            _row_config_id(row)
            for row in placeholder_rows
            if _row_config_id(row)
        ]
        target_ids: List[str] = []
        for keyed_row in keyed_rows:
            target_id = _row_config_id(keyed_row)
            if not target_id:
                continue
            target_ids.append(target_id)
            endpoint = str(_config_get(keyed_row, "endpoint", "") or "")
            merged_bindings, primary_model = _normalized_model_fields(
                provider,
                [*_row_model_bindings(keyed_row), *placeholder_bindings],
                _row_model_name(keyed_row),
                endpoint=endpoint,
            )
            if not dry_run:
                await ApiConfigDAO.update(
                    target_id,
                    model_bindings=merged_bindings,
                    model_name=primary_model,
                )

        absorbed_placeholder_groups.append(
            {
                "provider": provider,
                "target_config_ids": target_ids,
                "deleted_config_ids": placeholder_ids,
                "dry_run": dry_run,
            }
        )
        touched_items.extend([*keyed_rows, *placeholder_rows])
        deleted_placeholder_ids.update(placeholder_ids)
        if not dry_run:
            for placeholder_id in placeholder_ids:
                await ApiConfigDAO.delete(placeholder_id)

    rows = [row for row in rows if _row_config_id(row) not in deleted_placeholder_ids]
    grouped: Dict[tuple[str, str], List[Any]] = {}
    for row in rows:
        provider, channel = _provider_runtime_channel(row)
        if not provider or not _row_enabled(row) or not _row_has_key(row):
            continue
        grouped.setdefault((provider, channel), []).append(row)

    conflicts: List[Dict[str, Any]] = []
    total_disabled = 0
    for (provider, channel), provider_rows in grouped.items():
        if len(provider_rows) <= 1:
            continue
        keep = provider_rows[-1]
        keep_id = _row_config_id(keep)
        disabled_ids = [_row_config_id(row) for row in provider_rows[:-1] if _row_config_id(row)]
        if not dry_run:
            for config_id in disabled_ids:
                await ApiConfigDAO.update(config_id, enabled=False)
        total_disabled += len(disabled_ids)
        touched_items.extend(provider_rows)
        conflicts.append(
            {
                "provider": provider,
                "channel": channel,
                "kept_config_id": keep_id,
                "disabled_config_ids": disabled_ids,
                "keyed_enabled_count": len(provider_rows),
                "dry_run": dry_run,
            }
        )

    env_refreshed = None
    changed = bool(total_disabled or deleted_duplicate_ids or deleted_placeholder_ids)
    if changed and not dry_run:
        env_refreshed = await reload_api_env_after_config_change(reload_api_env)
    if touched_items and not dry_run:
        await invalidate_provider_health_for_items(touched_items)

    return {
        "success": True,
        "dry_run": dry_run,
        "conflicts": conflicts,
        "merged_cards": merged_cards,
        "total_merged_cards": len(merged_cards),
        "would_merge": len(merged_cards),
        "deleted_duplicate_config_ids": sorted(deleted_duplicate_ids),
        "absorbed_placeholder_groups": absorbed_placeholder_groups,
        "total_absorbed_placeholder_groups": len(absorbed_placeholder_groups),
        "would_absorb_placeholders": len(absorbed_placeholder_groups),
        "deleted_placeholder_config_ids": sorted(deleted_placeholder_ids),
        "total_conflicts": len(conflicts),
        "total_disabled": total_disabled if not dry_run else 0,
        "would_disable": total_disabled,
        "env_refreshed": env_refreshed,
    }


async def test_saved_api_config_health(config_id: str) -> Dict[str, Any]:
    row = await ApiConfigDAO.get_by_id(config_id)
    if not row:
        raise ApiConfigNotFound("Config not found")
    return await _test_api_config_row_health(row)


async def test_saved_api_config_real_generation(config_id: str, category: str = "") -> Dict[str, Any]:
    row = await ApiConfigDAO.get_by_id(config_id)
    if not row:
        raise ApiConfigNotFound("Config not found")
    key = await ApiConfigDAO.get_decrypted_key(config_id)
    test_row = _row_to_jsonable(row)
    if category:
        test_row["_test_category"] = category
    return await test_api_config_real_generation(test_row, key or "")


def summarize_config_test_results(results: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    rows = list(results)
    ok = 0
    no_key = 0
    auth_error = 0
    connectivity_ok = 0
    error = 0
    for item in rows:
        test = item.get("test") or {}
        if test.get("ok"):
            ok += 1
            continue
        if test.get("error") == "No API key configured":
            no_key += 1
        elif str(test.get("status") or "").strip().lower() == "connectivity_ok":
            connectivity_ok += 1
        elif test.get("auth_ok") is False:
            auth_error += 1
        else:
            error += 1
    return {
        "total": len(rows),
        "ok": ok,
        "no_key": no_key,
        "auth_error": auth_error,
        "connectivity_ok": connectivity_ok,
        "error": error,
    }


async def test_all_saved_api_config_health(
    *,
    config_ids: Optional[Iterable[str]] = None,
    enabled_only: bool = False,
    concurrency: Optional[int] = None,
) -> Dict[str, Any]:
    all_rows = list(await ApiConfigDAO.list_all())
    rows = list(all_rows)
    if config_ids:
        wanted = {str(config_id) for config_id in config_ids if config_id}
        rows = [row for row in rows if str(row.get("config_id") or "") in wanted]
    if enabled_only:
        rows = [row for row in rows if bool(row.get("enabled"))]
    effective_sources = build_effective_provider_config_sources(all_rows)

    limit = max(1, min(int(concurrency or 3), 8))
    sem = asyncio.Semaphore(limit)

    async def one(row: Dict[str, Any]) -> Dict[str, Any]:
        config_id = str(row.get("config_id") or "")
        async with sem:
            try:
                result = await _test_api_config_row_health(row, effective_sources=effective_sources)
                test = result.get("test") or {}
            except Exception as exc:
                logger.warning("API config batch test failed for %s: %s", config_id, exc, exc_info=True)
                test = {
                    "ok": False,
                    "reachable": False,
                    "auth_ok": False,
                    "status_code": None,
                    "url": None,
                    "error": redact_sensitive_text(exc),
                    "provider": row.get("provider") or None,
                    "model_name": row.get("model_name") or None,
                    "method": "GET",
                    "urls_tried": [],
                    "checked_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
                }
            return {
                "config_id": config_id,
                "name": row.get("name"),
                "provider": row.get("provider"),
                "model_name": row.get("model_name"),
                "enabled": bool(row.get("enabled")),
                "test": test,
            }

    results: List[Dict[str, Any]] = list(await asyncio.gather(*(one(row) for row in rows)))
    return {
        "success": True,
        "config_tests": results,
        "summary": summarize_config_test_results(results),
    }
