"""Admin routes for runtime API provider configuration.

These handlers are included by ``admin_routes.py`` under the existing
``/api/admin`` prefix so the public API surface stays unchanged.
"""
from __future__ import annotations

import logging
from copy import deepcopy
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from db_manager import get_db_manager
from services.api_config_health_service import (
    ProviderHealthNotFound,
    check_provider_health,
)
from services.api_config_import_service import (
    ApiConfigImportOptions,
    ApiConfigPresetImportRejected,
    import_preset_api_configs,
)
from services.api_config_reload_service import ApiConfigReloadFailed, reload_api_env_runtime
from services.api_config_service import (
    ApiConfigActivationFailed,
    ApiConfigCreateFailed,
    ApiConfigImportFailed,
    ApiConfigNotFound,
    activate_api_config,
    create_api_config,
    create_api_config_key_batch,
    delete_api_config,
    export_api_config_keys,
    get_api_config_presets,
    import_api_config_keys,
    list_api_configs,
    repair_api_config_provider_conflicts,
    test_all_saved_api_config_health,
    test_saved_api_config_real_generation,
    test_saved_api_config_health,
    update_api_config,
)
from services.api_provider_health_monitor import (
    cache_provider_health_result,
    list_cached_provider_health,
    provider_health_monitor_settings,
    provider_health_monitor_state,
    run_provider_health_sweep,
    summarize_provider_health_results,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _require_db() -> None:
    if not get_db_manager():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database unavailable",
        )


def _provider_health_from_real_generation_test(result: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    test = result.get("test") if isinstance(result, dict) else None
    if not isinstance(test, dict):
        return None
    provider = str(test.get("provider") or "").strip()
    if not provider:
        return None
    error_text = str(test.get("error") or "")
    if test.get("ok"):
        status_value = "ok"
    elif error_text == "No API key configured":
        status_value = "no_key"
    elif str(test.get("status") or "").strip().lower() == "unsupported":
        return None
    else:
        status_value = "error"
    return {
        "success": True,
        "provider": provider,
        "model_name": test.get("model_name") or None,
        "status": status_value,
        "latency_ms": test.get("latency_ms"),
        "checked_at": test.get("checked_at"),
        "health": {
            "ok": bool(test.get("ok")),
            "reachable": bool(test.get("reachable")),
            "auth_ok": bool(test.get("auth_ok")),
            "status_code": test.get("status_code"),
            "url": test.get("url"),
            "error": test.get("error"),
            "method": test.get("method") or "POST",
            "real_generation": True,
            "billable": bool(test.get("billable", True)),
            "output_type": test.get("output_type"),
        },
    }


def _audit_config_snapshot(config: Any) -> Dict[str, Any]:
    if not isinstance(config, dict):
        return {}
    snapshot: Dict[str, Any] = {}
    for key in (
        "config_id",
        "name",
        "provider",
        "model_name",
        "endpoint",
        "proxy_mode",
        "enabled",
        "category",
    ):
        if key in config:
            snapshot[key] = config.get(key)
    if "api_key_encrypted" in config:
        snapshot["has_key"] = bool(config.get("api_key_encrypted"))
    return snapshot


def _audit_update_details(fields: Dict[str, Any]) -> Dict[str, Any]:
    changes: Dict[str, Any] = {}
    for key, value in fields.items():
        if key == "api_key":
            changes["api_key_changed"] = bool(value)
        elif key == "custom_proxy":
            changes["custom_proxy_changed"] = bool(value)
        elif key in {"headers", "request_template"}:
            changes[key] = {
                "changed": True,
                "fields": sorted(value.keys()) if isinstance(value, dict) else [],
            }
        else:
            changes[key] = value
    return {
        "updated_fields": sorted(fields.keys()),
        "changes": changes,
    }


def _audit_result_summary(result: Dict[str, Any]) -> Dict[str, Any]:
    summary_keys = (
        "success",
        "env_refreshed",
        "loaded",
        "loaded_providers",
        "health_cache_invalidated",
        "disabled_conflicting_config_ids",
        "deleted",
        "dry_run",
        "imported",
        "skipped",
        "total",
        "copy_runtime_env_keys",
        "env_keys_imported",
        "env_keys_missing",
        "env_keys_existing",
        "env_keys_skipped_provider_claimed",
        "updated_existing",
        "updated",
        "enabled_existing",
        "total_conflicts",
        "total_disabled",
        "would_disable",
        "total_absorbed_placeholder_groups",
        "would_absorb_placeholders",
        "created",
        "invalid",
        "count",
        "active_config_id",
        "disabled_config_ids",
    )
    summary = {key: result.get(key) for key in summary_keys if key in result}
    if "api_config" in result:
        summary["api_config"] = _audit_config_snapshot(result.get("api_config"))
    if "conflicts" in result and isinstance(result.get("conflicts"), list):
        summary["conflicts"] = [
            {
                "provider": item.get("provider"),
                "kept_config_id": item.get("kept_config_id"),
                "disabled_config_ids": item.get("disabled_config_ids", []),
                "dry_run": item.get("dry_run"),
            }
            for item in result["conflicts"]
            if isinstance(item, dict)
        ]
    if "planned_actions" in result and isinstance(result.get("planned_actions"), list):
        actions = [item for item in result["planned_actions"] if isinstance(item, dict)]
        summary["planned_action_count"] = len(actions)
        summary["planned_action_types"] = sorted(
            {str(item.get("action") or "") for item in actions if item.get("action")}
        )
    return summary


async def _record_api_config_audit(
    request: Request,
    *,
    action: str,
    target_id: Optional[str] = None,
    before: Optional[Dict[str, Any]] = None,
    after: Optional[Dict[str, Any]] = None,
    notes: str = "",
) -> None:
    try:
        import admin_audit_service

        await admin_audit_service.record(
            request,
            admin_user_id=admin_audit_service.caller_admin_id(request),
            action=action,
            target_type="api_config",
            target_id=target_id,
            before=before,
            after=after,
            notes=notes,
        )
    except Exception as e:
        logger.warning("API config audit record failed (action=%s): %s", action, e)


class ApiConfigCreateBody(BaseModel):
    # Pydantic v2 protects model_* names by default, but model_name is a real
    # API config field used by the admin UI and database.
    model_config = ConfigDict(protected_namespaces=())

    name: str = Field(..., min_length=1)
    provider: str = Field(..., min_length=1)
    endpoint: str = Field(..., min_length=1)
    api_key: str = Field(..., min_length=1)
    model_name: str = ""
    model_bindings: List[Dict[str, Any]] = Field(default_factory=list)
    proxy_mode: str = "direct"
    custom_proxy: str = ""
    request_template: Dict[str, Any] = Field(default_factory=dict)
    headers: Dict[str, Any] = Field(default_factory=dict)
    category: str = ""
    enabled: bool = True


class ApiConfigBulkKeysBody(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    provider: str = Field(..., min_length=1)
    endpoint: str = Field(..., min_length=1)
    api_keys: List[str] = Field(..., min_length=1)
    name_prefix: str = ""
    model_name: str = ""
    model_bindings: List[Dict[str, Any]] = Field(default_factory=list)
    proxy_mode: str = "direct"
    custom_proxy: str = ""
    request_template: Dict[str, Any] = Field(default_factory=dict)
    headers: Dict[str, Any] = Field(default_factory=dict)
    category: str = ""
    activate_index: int = 0


class ApiConfigUpdateBody(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    name: Optional[str] = None
    provider: Optional[str] = None
    endpoint: Optional[str] = None
    api_key: Optional[str] = None
    model_name: Optional[str] = None
    model_bindings: Optional[List[Dict[str, Any]]] = None
    proxy_mode: Optional[str] = None
    custom_proxy: Optional[str] = None
    request_template: Optional[Dict[str, Any]] = None
    headers: Optional[Dict[str, Any]] = None
    enabled: Optional[bool] = None
    category: Optional[str] = None


class ApiConfigImportPresetsBody(BaseModel):
    copy_runtime_env_keys: bool = True
    update_existing_empty_keys: bool = True
    enable_copied_keys: bool = True
    dry_run: bool = False


class ApiConfigKeyImportBody(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    configs: List[Dict[str, Any]] = Field(default_factory=list)
    overwrite_existing: bool = False
    enable_imported: bool = True
    dry_run: bool = False


class ApiConfigHealthSweepBody(BaseModel):
    providers: Optional[List[str]] = None
    targets: Optional[List[Dict[str, Optional[str]]]] = None
    concurrency: Optional[int] = None


class ApiConfigBatchTestBody(BaseModel):
    config_ids: Optional[List[str]] = None
    enabled_only: bool = False
    concurrency: Optional[int] = None


class ApiConfigRepairConflictsBody(BaseModel):
    dry_run: bool = False


class ApiConfigRealTestBody(BaseModel):
    category: str = ""


@router.get("/api-configs")
async def admin_list_api_configs():
    _require_db()
    return await list_api_configs()


@router.post("/api-configs", status_code=status.HTTP_201_CREATED)
async def admin_create_api_config(body: ApiConfigCreateBody, request: Request):
    _require_db()
    try:
        result = await create_api_config(
            name=body.name,
            provider=body.provider,
            endpoint=body.endpoint,
            api_key=body.api_key,
            model_name=body.model_name,
            model_bindings=body.model_bindings,
            proxy_mode=body.proxy_mode,
            custom_proxy=body.custom_proxy,
            request_template=body.request_template,
            headers=body.headers,
            category=body.category,
            enabled=body.enabled,
        )
        target_id = (result.get("api_config") or {}).get("config_id")
        await _record_api_config_audit(
            request,
            action="api_config_create",
            target_id=target_id,
            after=_audit_result_summary(result),
        )
        return result
    except ApiConfigCreateFailed as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/api-configs/bulk-keys", status_code=status.HTTP_201_CREATED)
async def admin_create_api_config_key_batch(body: ApiConfigBulkKeysBody, request: Request):
    _require_db()
    try:
        result = await create_api_config_key_batch(
            provider=body.provider,
            endpoint=body.endpoint,
            api_keys=body.api_keys,
            name_prefix=body.name_prefix,
            model_name=body.model_name,
            model_bindings=body.model_bindings,
            proxy_mode=body.proxy_mode,
            custom_proxy=body.custom_proxy,
            request_template=body.request_template,
            headers=body.headers,
            category=body.category,
            activate_index=body.activate_index,
        )
        await _record_api_config_audit(
            request,
            action="api_config_bulk_keys_create",
            target_id=result.get("active_config_id"),
            after=_audit_result_summary(result),
        )
        return result
    except ApiConfigCreateFailed as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/api-configs/reload-env")
async def admin_reload_api_env(request: Request):
    """Manually reload DB-backed API configs into runtime env without restart."""
    _require_db()
    try:
        result = await reload_api_env_runtime(clear_health_cache=True)
    except ApiConfigReloadFailed as e:
        logger.error("Manual API env reload failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="API env reload failed") from e

    response = {
        "success": bool(result.get("success")),
        "env_refreshed": bool(result.get("env_refreshed")),
        "loaded": result.get("loaded", 0),
        "loaded_providers": result.get("loaded_providers", []),
        "health_cache_invalidated": result.get("health_cache_invalidated", []),
        "error": result.get("error"),
    }
    await _record_api_config_audit(
        request,
        action="api_config_reload_env",
        target_id="runtime",
        after=_audit_result_summary(response),
    )
    return response


@router.post("/api-configs/import-presets")
async def admin_import_preset_configs(request: Request, body: Optional[ApiConfigImportPresetsBody] = None):
    _require_db()
    body = body or ApiConfigImportPresetsBody()
    try:
        result = await import_preset_api_configs(
            ApiConfigImportOptions(
                copy_runtime_env_keys=body.copy_runtime_env_keys,
                update_existing_empty_keys=body.update_existing_empty_keys,
                enable_copied_keys=body.enable_copied_keys,
                dry_run=body.dry_run,
            )
        )
    except ApiConfigPresetImportRejected as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _record_api_config_audit(
        request,
        action="api_config_import_presets",
        target_id="presets",
        after=_audit_result_summary(result),
    )
    return result


@router.post("/api-configs/export-keys")
async def admin_export_api_config_keys(request: Request):
    _require_db()
    result = await export_api_config_keys()
    await _record_api_config_audit(
        request,
        action="api_config_export_keys",
        target_id="api_config_keys",
        after=_audit_result_summary(result),
        notes="Exported plaintext API keys for admin backup",
    )
    return result


@router.post("/api-configs/import-keys")
async def admin_import_api_config_keys(body: ApiConfigKeyImportBody, request: Request):
    _require_db()
    try:
        result = await import_api_config_keys(
            body.model_dump(),
            overwrite_existing=body.overwrite_existing,
            enable_imported=body.enable_imported,
            dry_run=body.dry_run,
        )
    except ApiConfigImportFailed as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    await _record_api_config_audit(
        request,
        action="api_config_import_keys",
        target_id="api_config_keys",
        after=_audit_result_summary(result),
    )
    return result


@router.get("/api-configs/presets")
async def admin_get_presets():
    return get_api_config_presets()


@router.post("/api-configs/test-all")
async def admin_test_all_api_configs(body: Optional[ApiConfigBatchTestBody] = None):
    _require_db()
    body = body or ApiConfigBatchTestBody()
    return await test_all_saved_api_config_health(
        config_ids=body.config_ids,
        enabled_only=body.enabled_only,
        concurrency=body.concurrency,
    )


@router.get("/api-configs/health/cache")
async def admin_get_provider_health_cache():
    provider_health = await list_cached_provider_health()
    return {
        "success": True,
        "provider_health": provider_health,
        "summary": summarize_provider_health_results(provider_health),
        "settings": provider_health_monitor_settings(),
        "monitor_state": provider_health_monitor_state(),
    }


@router.post("/api-configs/health/sweep")
async def admin_sweep_provider_health(body: Optional[ApiConfigHealthSweepBody] = None):
    body = body or ApiConfigHealthSweepBody()
    results = await run_provider_health_sweep(
        providers=body.providers,
        targets=body.targets,
        concurrency=body.concurrency,
        record_state=True,
        sweep_source="manual",
    )
    summary = summarize_provider_health_results(results)
    return {
        "success": True,
        "provider_health": results,
        "summary": summary,
        "monitor_state": provider_health_monitor_state(),
    }


@router.post("/api-configs/repair-conflicts")
async def admin_repair_api_config_conflicts(request: Request, body: Optional[ApiConfigRepairConflictsBody] = None):
    _require_db()
    body = body or ApiConfigRepairConflictsBody()
    result = await repair_api_config_provider_conflicts(
        dry_run=body.dry_run,
    )
    await _record_api_config_audit(
        request,
        action="api_config_repair_conflicts",
        target_id="provider_conflicts",
        after=_audit_result_summary(result),
    )
    return result


@router.post("/api-configs/{config_id}/test")
async def admin_test_api_config(config_id: str):
    _require_db()
    try:
        return await test_saved_api_config_health(config_id)
    except ApiConfigNotFound:
        raise HTTPException(status_code=404, detail="Config not found")


@router.post("/api-configs/{config_id}/real-test")
async def admin_real_test_api_config(
    config_id: str,
    request: Request,
    body: Optional[ApiConfigRealTestBody] = None,
):
    _require_db()
    body = body or ApiConfigRealTestBody()
    try:
        result = await test_saved_api_config_real_generation(config_id, category=body.category)
        test = result.get("test") or {}
        provider_health = _provider_health_from_real_generation_test(result)
        if provider_health:
            result["provider_health"] = await cache_provider_health_result(provider_health)
            provider_level_health = deepcopy(result["provider_health"])
            provider_level_health["model_name"] = None
            await cache_provider_health_result(provider_level_health)
        await _record_api_config_audit(
            request,
            action="api_config_real_generation_test",
            target_id=config_id,
            after={
                "success": result.get("success"),
                "ok": test.get("ok"),
                "status": test.get("status"),
                "provider": test.get("provider"),
                "model_name": test.get("model_name"),
                "status_code": test.get("status_code"),
                "output_type": test.get("output_type"),
                "billable": test.get("billable"),
            },
            notes="Admin-triggered real generation test; may incur provider cost",
        )
        return result
    except ApiConfigNotFound:
        raise HTTPException(status_code=404, detail="Config not found")


@router.post("/api-configs/{config_id}/activate")
async def admin_activate_api_config(config_id: str, request: Request):
    _require_db()
    try:
        result = await activate_api_config(config_id)
        await _record_api_config_audit(
            request,
            action="api_config_activate",
            target_id=config_id,
            after=_audit_result_summary(result),
        )
        return result
    except ApiConfigNotFound:
        raise HTTPException(status_code=404, detail="Config not found")
    except ApiConfigActivationFailed as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/api-configs/{provider_id}/health")
async def admin_check_provider_health(provider_id: str, model_name: Optional[str] = None):
    try:
        result = await check_provider_health(provider_id, model_name=model_name)
        return await cache_provider_health_result(result)
    except ProviderHealthNotFound:
        raise HTTPException(status_code=404, detail="Provider not found")


@router.put("/api-configs/{config_id}")
async def admin_update_api_config(config_id: str, body: ApiConfigUpdateBody, request: Request):
    _require_db()
    data = body.model_dump(exclude_unset=True)
    try:
        result = await update_api_config(config_id, data)
        await _record_api_config_audit(
            request,
            action="api_config_update",
            target_id=config_id,
            after={
                "requested_update": _audit_update_details(data),
                "result": _audit_result_summary(result),
            },
        )
        return result
    except ApiConfigNotFound:
        raise HTTPException(status_code=404, detail="Config not found")
    except ApiConfigCreateFailed as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/api-configs/{config_id}")
async def admin_delete_api_config(config_id: str, request: Request):
    _require_db()
    try:
        result = await delete_api_config(config_id)
        await _record_api_config_audit(
            request,
            action="api_config_delete",
            target_id=config_id,
            after=_audit_result_summary(result),
        )
        return result
    except ApiConfigNotFound:
        raise HTTPException(status_code=404, detail="Config not found")
