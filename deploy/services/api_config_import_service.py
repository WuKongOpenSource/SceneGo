"""Import preset API configurations into the admin API config store."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from dao.admin.api_config import ApiConfigDAO
from services.api_config_health_cache_service import invalidate_provider_health_for_items
from services.api_config_reload_service import ReloadCallback, reload_api_env_after_config_change
from services.api_provider_registry import (
    get_api_model_presets,
    get_provider_model_binding_options,
    infer_model_binding_operation,
    normalize_model_bindings,
    normalize_provider,
    primary_model_name_for_bindings,
)
from services.api_provider_runtime import resolve_provider
from services.provider_endpoint_policy import (
    ProviderEndpointPolicyError,
    validate_provider_connection,
)
from utils.config_helpers import _config_get


class ApiConfigPresetImportRejected(ValueError):
    """Raised when a preset/runtime source contains an unsafe connection target."""


@dataclass(frozen=True)
class ApiConfigImportOptions:
    copy_runtime_env_keys: bool = False
    update_existing_empty_keys: bool = True
    enable_copied_keys: bool = True
    dry_run: bool = False


def _json_object(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    return {}


def _runtime_request_template(provider: str, resolved: Any) -> Dict[str, Any]:
    if provider != "minimax":
        return {}
    group_id = str((getattr(resolved, "extra", {}) or {}).get("group_id") or "").strip()
    return {"group_id": group_id} if group_id else {}


def _merge_request_template(row: Any, extra: Dict[str, Any]) -> Dict[str, Any]:
    merged = _json_object(_config_get(row, "request_template", {}))
    merged.update(extra)
    return merged


async def import_preset_api_configs(
    options: Optional[ApiConfigImportOptions] = None,
    *,
    reload_api_env: Optional[ReloadCallback] = None,
    presets: Optional[List[dict]] = None,
) -> Dict[str, Any]:
    """Create/update API config rows from the central provider registry.

    The service is intentionally independent from FastAPI so the import policy
    can be contract-tested without hitting a real database or HTTP route.
    """
    options = options or ApiConfigImportOptions()
    preset_models = presets or get_api_model_presets()
    presets_by_provider: Dict[str, List[dict]] = {}
    for preset in preset_models:
        provider = normalize_provider(str(preset.get("provider") or ""))
        model_name = str(preset.get("model_name") or "").strip()
        if provider and model_name:
            presets_by_provider.setdefault(provider, []).append(preset)

    existing = list(await ApiConfigDAO.list_all())
    existing_by_provider: Dict[str, List[Any]] = {}
    for row in existing:
        provider = normalize_provider(str(_config_get(row, "provider", "") or ""))
        if provider:
            existing_by_provider.setdefault(provider, []).append(row)

    imported = 0
    skipped = 0
    env_keys_imported = 0
    env_keys_missing = 0
    env_keys_existing = 0
    env_keys_skipped_provider_claimed = 0
    updated_existing = 0
    enabled_existing = 0
    planned_actions: List[Dict[str, Any]] = []
    touched_items: List[Dict[str, Any]] = []

    for provider, provider_presets in presets_by_provider.items():
        first_preset = provider_presets[0]
        preset_bindings = normalize_model_bindings(
            provider,
            get_provider_model_binding_options(provider)
            or [
                {
                    "operation": preset.get("operation")
                    or infer_model_binding_operation(provider, preset.get("model_name")),
                    "label": preset.get("operation_label") or preset.get("name") or "",
                    "model_name": preset.get("model_name") or "",
                }
                for preset in provider_presets
            ],
        )
        primary_model = primary_model_name_for_bindings(
            preset_bindings,
            str(first_preset.get("model_name") or ""),
        )
        provider_rows = existing_by_provider.get(provider, [])
        existing_row = next(
            (row for row in provider_rows if _config_get(row, "api_key_encrypted", "")),
            provider_rows[0] if provider_rows else None,
        )
        resolved = resolve_provider(provider, primary_model)
        has_db_key = bool(existing_row and _config_get(existing_row, "api_key_encrypted", ""))
        should_copy_runtime_key = bool(options.copy_runtime_env_keys and resolved.has_key and not has_db_key)
        runtime_key = resolved.api_key if should_copy_runtime_key else ""
        endpoint = resolved.endpoint or str(first_preset.get("endpoint") or "")
        proxy_mode = resolved.proxy_config.get("mode") or first_preset.get("proxy_mode") or "direct"
        custom_proxy = (resolved.proxy_config.get("custom_proxy") or "") if options.copy_runtime_env_keys else ""
        try:
            endpoint, proxy_mode, custom_proxy = validate_provider_connection(
                endpoint,
                proxy_mode,
                custom_proxy,
            )
        except ProviderEndpointPolicyError as exc:
            raise ApiConfigPresetImportRejected(
                f"Preset for provider {provider} was rejected: {exc}"
            ) from exc
        runtime_request_template = (
            _runtime_request_template(provider, resolved)
            if options.copy_runtime_env_keys
            else {}
        )

        if existing_row:
            existing_bindings = normalize_model_bindings(
                provider,
                _config_get(existing_row, "model_bindings", []),
                str(_config_get(existing_row, "model_name", "") or ""),
            )
            merged_bindings = normalize_model_bindings(provider, [*existing_bindings, *preset_bindings])
            update_fields: Dict[str, Any] = {
                "model_bindings": merged_bindings,
                "model_name": primary_model_name_for_bindings(merged_bindings, primary_model),
            }
            action = "merge_model_bindings"
            if has_db_key:
                env_keys_existing += 1
            elif should_copy_runtime_key and options.update_existing_empty_keys:
                update_fields.update(
                    {
                        "api_key": runtime_key,
                        "endpoint": endpoint,
                        "proxy_mode": proxy_mode,
                        "custom_proxy": custom_proxy,
                        "category": first_preset.get("category", ""),
                    }
                )
                if runtime_request_template:
                    update_fields["request_template"] = _merge_request_template(existing_row, runtime_request_template)
                if options.enable_copied_keys:
                    update_fields["enabled"] = True
                    if _config_get(existing_row, "enabled", True) is False:
                        enabled_existing += 1
                env_keys_imported += 1
                action = "update_existing_api_card"
            elif options.copy_runtime_env_keys and not resolved.has_key:
                env_keys_missing += 1

            planned_actions.append(
                {
                    "action": action,
                    "provider": provider,
                    "config_id": _config_get(existing_row, "config_id", ""),
                    "model_binding_count": len(merged_bindings),
                    "will_copy_key": bool(update_fields.get("api_key")),
                }
            )
            if not options.dry_run:
                updated_row = await ApiConfigDAO.update(
                    _config_get(existing_row, "config_id", ""),
                    **update_fields,
                )
                touched_items.append(updated_row or existing_row)
            updated_existing += 1
            skipped += 1
            continue

        if options.copy_runtime_env_keys and not runtime_key:
            env_keys_missing += 1
        planned_actions.append(
            {
                "action": "create_api_card",
                "provider": provider,
                "name": first_preset.get("name") or provider,
                "endpoint": endpoint,
                "model_binding_count": len(preset_bindings),
                "will_copy_key": bool(runtime_key),
                "will_copy_extra_fields": sorted(runtime_request_template),
            }
        )
        if not options.dry_run:
            created_row = await ApiConfigDAO.create(
                name=first_preset.get("name") or provider,
                provider=provider,
                endpoint=endpoint,
                api_key=runtime_key,
                model_name=primary_model,
                model_bindings=preset_bindings,
                proxy_mode=proxy_mode,
                custom_proxy=custom_proxy,
                category=first_preset.get("category", ""),
                request_template=runtime_request_template or None,
            )
            touched_items.append(
                created_row
                or {
                    "provider": provider,
                    "model_name": primary_model,
                }
            )
        if options.copy_runtime_env_keys and runtime_key:
            env_keys_imported += 1
        imported += 1

    env_refreshed = None
    if not options.dry_run and (imported or updated_existing):
        env_refreshed = await reload_api_env_after_config_change(reload_api_env)

    health_cache_invalidated: List[str] = []
    if not options.dry_run and touched_items:
        health_cache_invalidated = await invalidate_provider_health_for_items(touched_items)

    return {
        "success": True,
        "dry_run": options.dry_run,
        "imported": imported,
        "skipped": skipped,
        "total": len(presets_by_provider),
        "preset_total": len(preset_models),
        "copy_runtime_env_keys": options.copy_runtime_env_keys,
        "env_keys_imported": env_keys_imported,
        "env_keys_missing": env_keys_missing,
        "env_keys_existing": env_keys_existing,
        "env_keys_skipped_provider_claimed": env_keys_skipped_provider_claimed,
        "updated_existing": updated_existing,
        "enabled_existing": enabled_existing,
        "env_refreshed": env_refreshed,
        "health_cache_invalidated": health_cache_invalidated,
        "planned_actions": planned_actions,
    }
