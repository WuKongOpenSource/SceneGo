"""Background health monitor and Redis cache for API providers."""
from __future__ import annotations

import asyncio
import inspect
import json
import logging
import os
import time
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional
from urllib.parse import quote

from services.api_config_health_service import check_provider_health
from services.api_provider_registry import PROVIDER_CATALOG, get_api_model_presets, normalize_provider
from services.sensitive_data_redaction import redact_sensitive_text

logger = logging.getLogger(__name__)

HEALTH_CACHE_PREFIX = "provider:health:"
DEFAULT_HEALTH_TTL_SECONDS = 900
DEFAULT_REAL_GENERATION_HEALTH_TTL_SECONDS = 7 * 24 * 60 * 60

ProviderHealthCheck = Callable[..., Awaitable[Dict[str, Any]]]

_redis_client: Any = None
_monitor_state: Dict[str, Any] = {
    "enabled": None,
    "loop_running": False,
    "loop_started_at": None,
    "last_sweep_source": None,
    "last_sweep_started_at": None,
    "last_sweep_completed_at": None,
    "last_sweep_duration_ms": None,
    "last_summary": None,
    "last_error": None,
}


def _utc_now() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def _env_int_at_least(name: str, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        logger.warning("Invalid %s value, using default %s", name, default)
        return default


def provider_health_monitor_settings() -> Dict[str, int | bool]:
    return {
        "enabled": _env_bool("API_PROVIDER_HEALTH_MONITOR_ENABLED", True),
        "initial_delay_seconds": _env_int_at_least("API_PROVIDER_HEALTH_INITIAL_DELAY_SECONDS", 60, 0),
        "interval_seconds": _env_int_at_least("API_PROVIDER_HEALTH_INTERVAL_SECONDS", 300, 60),
        "ttl_seconds": _env_int_at_least("API_PROVIDER_HEALTH_TTL_SECONDS", DEFAULT_HEALTH_TTL_SECONDS, 60),
        "real_generation_ttl_seconds": _env_int_at_least(
            "API_PROVIDER_REAL_GENERATION_HEALTH_TTL_SECONDS",
            DEFAULT_REAL_GENERATION_HEALTH_TTL_SECONDS,
            60,
        ),
        "concurrency": _env_int_at_least("API_PROVIDER_HEALTH_CONCURRENCY", 3, 1),
    }


def provider_health_monitor_state() -> Dict[str, Any]:
    """Return observable provider-health monitor state for admin UI/debugging."""
    settings = provider_health_monitor_settings()
    return {
        **_monitor_state,
        "enabled": bool(settings["enabled"]),
        "redis_configured": _redis_client is not None,
    }


def set_provider_health_redis(redis_client: Any) -> None:
    global _redis_client
    _redis_client = redis_client


def provider_health_cache_key(provider: str, model_name: Optional[str] = None) -> str:
    provider_key = normalize_provider(provider)
    model_key = str(model_name or "").strip()
    if not model_key:
        return f"{HEALTH_CACHE_PREFIX}{provider_key}"
    return f"{HEALTH_CACHE_PREFIX}{provider_key}:{quote(model_key, safe='')}"


def provider_health_cache_targets(
    providers: Optional[Iterable[str]] = None,
    targets: Optional[Iterable[Any]] = None,
) -> List[Dict[str, Optional[str]]]:
    """Return provider/model cache targets, including known preset models."""
    raw_targets: List[Any] = []
    if targets is not None:
        raw_targets.extend(targets)
    else:
        provider_filter = {normalize_provider(p) for p in providers} if providers is not None else None
        for provider in provider_filter or sorted(PROVIDER_CATALOG):
            raw_targets.append({"provider": provider, "model_name": None})
        for preset in get_api_model_presets():
            preset_provider = normalize_provider(str(preset.get("provider") or ""))
            if provider_filter is not None and preset_provider not in provider_filter:
                continue
            raw_targets.append(
                {
                    "provider": preset_provider,
                    "model_name": preset.get("model_name"),
                }
            )

    out: List[Dict[str, Optional[str]]] = []
    seen: set[str] = set()
    for item in raw_targets:
        if isinstance(item, str):
            provider = normalize_provider(item)
            model_name = None
        elif isinstance(item, dict):
            provider = normalize_provider(str(item.get("provider") or ""))
            model_name = str(item.get("model_name") or "").strip() or None
        else:
            continue
        if not provider:
            continue
        key = provider_health_cache_key(provider, model_name)
        if key in seen:
            continue
        seen.add(key)
        out.append({"provider": provider, "model_name": model_name})
    return out


def _safe_health_payload(result: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(result or {})
    provider = normalize_provider(str(payload.get("provider") or ""))
    payload["provider"] = provider
    model_name = str(payload.get("model_name") or "").strip()
    payload["model_name"] = model_name or None
    payload.setdefault("success", True)
    payload.setdefault("cached_at", datetime.utcnow().isoformat(timespec="seconds") + "Z")
    return payload


def _is_verified_generation_ok(payload: Dict[str, Any]) -> bool:
    health = payload.get("health") if isinstance(payload.get("health"), dict) else {}
    return (
        str(payload.get("status") or "").strip().lower() == "ok"
        and bool(health.get("ok"))
        and bool(health.get("real_generation"))
    )


def _is_real_generation_payload(payload: Dict[str, Any]) -> bool:
    health = payload.get("health") if isinstance(payload.get("health"), dict) else {}
    return bool(health.get("real_generation"))


async def cache_provider_health_result(
    result: Dict[str, Any],
    *,
    redis_client: Any = None,
    ttl_seconds: Optional[int] = None,
) -> Dict[str, Any]:
    client = redis_client if redis_client is not None else _redis_client
    payload = _safe_health_payload(result)
    provider = normalize_provider(str(payload.get("provider") or ""))
    model_name = str(payload.get("model_name") or "").strip() or None
    if not client or not provider:
        return payload

    cache_key = provider_health_cache_key(provider, model_name)
    if str(payload.get("status") or "").strip().lower() == "connectivity_ok":
        try:
            raw_existing = await client.get(cache_key)
            if isinstance(raw_existing, bytes):
                raw_existing = raw_existing.decode("utf-8", errors="ignore")
            existing = json.loads(str(raw_existing)) if raw_existing else None
        except Exception:
            existing = None
        if isinstance(existing, dict) and _is_verified_generation_ok(existing):
            return _safe_health_payload(existing)

    settings = provider_health_monitor_settings()
    ttl = (
        ttl_seconds
        if ttl_seconds is not None
        else int(
            settings["real_generation_ttl_seconds"]
            if _is_real_generation_payload(payload)
            else settings["ttl_seconds"]
        )
    )
    data = json.dumps(payload, ensure_ascii=False)
    await client.set(cache_key, data, ex=ttl)
    return payload


async def get_cached_provider_health(
    provider: str,
    *,
    model_name: Optional[str] = None,
    redis_client: Any = None,
) -> Optional[Dict[str, Any]]:
    client = redis_client if redis_client is not None else _redis_client
    normalized = normalize_provider(provider)
    if not client or not normalized:
        return None

    raw = await client.get(provider_health_cache_key(normalized, model_name))
    if not raw:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", errors="ignore")
    try:
        data = json.loads(str(raw))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    data["provider"] = normalize_provider(str(data.get("provider") or normalized))
    data["model_name"] = str(data.get("model_name") or model_name or "").strip() or None
    return data


async def delete_cached_provider_health(
    provider: str,
    *,
    model_name: Optional[str] = None,
    redis_client: Any = None,
) -> bool:
    client = redis_client if redis_client is not None else _redis_client
    normalized = normalize_provider(provider)
    if not client or not normalized:
        return False

    if model_name:
        keys = [provider_health_cache_key(normalized, model_name)]
    else:
        keys = [
            provider_health_cache_key(target["provider"] or "", target.get("model_name"))
            for target in provider_health_cache_targets(providers=[normalized])
        ]
    deleted = 0
    for key in keys:
        deleted += int(await client.delete(key) or 0)
    try:
        return int(deleted) > 0
    except (TypeError, ValueError):
        return bool(deleted)


async def delete_cached_provider_health_many(
    providers: Iterable[str],
    *,
    redis_client: Any = None,
) -> List[str]:
    seen: set[str] = set()
    cleared: List[str] = []
    for provider in providers:
        normalized = normalize_provider(provider)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        if await delete_cached_provider_health(normalized, redis_client=redis_client):
            cleared.append(normalized)
    return cleared


async def delete_cached_provider_health_targets(
    targets: Iterable[Any],
    *,
    redis_client: Any = None,
) -> List[str]:
    """Clear exact provider/model health cache entries.

    Catalog-level clearing only knows about presets. Saved admin configs can
    carry custom model names, so config writes also clear exact runtime targets.
    """
    client = redis_client if redis_client is not None else _redis_client
    if not client:
        return []

    cleared: List[str] = []
    for target in provider_health_cache_targets(targets=targets):
        provider = target["provider"] or ""
        key = provider_health_cache_key(provider, target.get("model_name"))
        deleted = int(await client.delete(key) or 0)
        if deleted:
            cleared.append(key)
    return cleared


def _decode_redis_key(key: Any) -> str:
    if isinstance(key, bytes):
        return key.decode("utf-8", errors="ignore")
    return str(key)


async def _iter_health_cache_keys(client: Any):
    pattern = f"{HEALTH_CACHE_PREFIX}*"
    scan_iter = getattr(client, "scan_iter", None)
    if callable(scan_iter):
        try:
            iterator = scan_iter(match=pattern)
        except TypeError:
            iterator = scan_iter(pattern)
        async for key in iterator:
            decoded = _decode_redis_key(key)
            if decoded.startswith(HEALTH_CACHE_PREFIX):
                yield decoded
        return

    keys_fn = getattr(client, "keys", None)
    if callable(keys_fn):
        result = keys_fn(pattern)
        if inspect.isawaitable(result):
            result = await result
        for key in result or []:
            decoded = _decode_redis_key(key)
            if decoded.startswith(HEALTH_CACHE_PREFIX):
                yield decoded


async def clear_all_cached_provider_health(
    *,
    redis_client: Any = None,
) -> List[str]:
    """Clear every cached provider health entry under the managed prefix."""
    client = redis_client if redis_client is not None else _redis_client
    if not client:
        return []

    cleared: List[str] = []
    async for key in _iter_health_cache_keys(client):
        deleted = int(await client.delete(key) or 0)
        if deleted:
            cleared.append(key)
    return cleared


async def list_cached_provider_health(
    providers: Optional[Iterable[str]] = None,
    *,
    targets: Optional[Iterable[Any]] = None,
    redis_client: Any = None,
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for target in provider_health_cache_targets(providers=providers, targets=targets):
        cached = await get_cached_provider_health(
            target["provider"] or "",
            model_name=target.get("model_name"),
            redis_client=redis_client,
        )
        if cached:
            out.append(cached)
    return out


def summarize_provider_health_results(results: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    rows = list(results)
    summary = {
        "total": len(rows),
        "ok": 0,
        "error": 0,
        "no_key": 0,
        "blocked_region": 0,
        "connectivity_ok": 0,
        "unknown": 0,
    }
    for item in rows:
        status = str(item.get("status") or "").strip().lower()
        if status in {"ok", "error", "no_key", "blocked_region", "connectivity_ok"}:
            summary[status] += 1
        else:
            summary["unknown"] += 1
    return summary


def _normalize_sweep_targets(
    *,
    providers: Optional[Iterable[str]] = None,
    targets: Optional[Iterable[Any]] = None,
) -> List[Dict[str, Optional[str]]]:
    if targets is not None:
        return provider_health_cache_targets(targets=targets)
    if providers is None:
        return provider_health_cache_targets()

    # Explicit provider sweeps keep the legacy provider-only behavior. The
    # background/default sweep expands to provider+model targets above.
    raw_targets: Iterable[Any] = [{"provider": provider, "model_name": None} for provider in providers]
    out: List[Dict[str, Optional[str]]] = []
    seen: set[str] = set()
    for item in raw_targets:
        if isinstance(item, str):
            provider = normalize_provider(item)
            model_name = None
        elif isinstance(item, dict):
            provider = normalize_provider(str(item.get("provider") or ""))
            model_name = str(item.get("model_name") or "").strip() or None
        else:
            continue
        key = provider_health_cache_key(provider, model_name)
        if not provider or key in seen:
            continue
        seen.add(key)
        out.append({"provider": provider, "model_name": model_name})
    return out


async def run_provider_health_sweep(
    *,
    providers: Optional[Iterable[str]] = None,
    targets: Optional[Iterable[Any]] = None,
    redis_client: Any = None,
    check_fn: Optional[ProviderHealthCheck] = None,
    concurrency: Optional[int] = None,
    record_state: bool = False,
    sweep_source: str = "manual",
) -> List[Dict[str, Any]]:
    sweep_targets = _normalize_sweep_targets(providers=providers, targets=targets)
    if not sweep_targets:
        return []

    settings = provider_health_monitor_settings()
    limit = concurrency or int(settings["concurrency"])
    ttl = int(settings["ttl_seconds"])
    checker = check_fn or check_provider_health
    sem = asyncio.Semaphore(limit)
    started_at = _utc_now()
    started_perf = time.perf_counter()
    if record_state:
        _monitor_state.update(
            {
                "last_sweep_source": sweep_source,
                "last_sweep_started_at": started_at,
                "last_sweep_completed_at": None,
                "last_sweep_duration_ms": None,
                "last_error": None,
            }
        )

    async def one(target: Dict[str, Optional[str]]) -> Dict[str, Any]:
        provider = str(target.get("provider") or "")
        model_name = target.get("model_name") or None
        async with sem:
            try:
                result = await checker(provider, model_name=model_name)
            except Exception as exc:
                logger.warning("Provider health check failed for %s: %s", provider, exc, exc_info=True)
                result = {
                    "success": True,
                    "provider": provider,
                    "model_name": model_name,
                    "status": "error",
                    "latency_ms": None,
                    "checked_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
                    "health": {
                        "ok": False,
                        "reachable": False,
                        "auth_ok": False,
                        "status_code": None,
                        "url": None,
                        "error": redact_sensitive_text(exc),
                        "method": "GET",
                        "urls_tried": [],
                    },
                }
            return await cache_provider_health_result(
                result,
                redis_client=redis_client,
                ttl_seconds=ttl,
            )

    try:
        results = list(await asyncio.gather(*(one(target) for target in sweep_targets)))
    except Exception as exc:
        if record_state:
            _monitor_state.update(
                {
                    "last_sweep_completed_at": _utc_now(),
                    "last_sweep_duration_ms": int((time.perf_counter() - started_perf) * 1000),
                    "last_error": redact_sensitive_text(exc),
                }
            )
        raise
    if record_state:
        _monitor_state.update(
            {
                "last_sweep_completed_at": _utc_now(),
                "last_sweep_duration_ms": int((time.perf_counter() - started_perf) * 1000),
                "last_summary": summarize_provider_health_results(results),
                "last_error": None,
            }
        )
    return results


async def provider_health_monitor_loop(redis_client: Any = None) -> None:
    settings = provider_health_monitor_settings()
    _monitor_state.update(
        {
            "enabled": bool(settings["enabled"]),
            "loop_running": bool(settings["enabled"]),
            "loop_started_at": _utc_now(),
            "last_error": None,
        }
    )
    if not settings["enabled"]:
        logger.info("API provider health monitor disabled by API_PROVIDER_HEALTH_MONITOR_ENABLED")
        _monitor_state["loop_running"] = False
        return

    client = redis_client if redis_client is not None else _redis_client
    await asyncio.sleep(int(settings["initial_delay_seconds"]))
    while True:
        try:
            results = await run_provider_health_sweep(
                redis_client=client,
                record_state=True,
                sweep_source="background",
            )
            ok = sum(1 for item in results if item.get("status") == "ok")
            no_key = sum(1 for item in results if item.get("status") == "no_key")
            blocked_region = sum(1 for item in results if item.get("status") == "blocked_region")
            connectivity_ok = sum(1 for item in results if item.get("status") == "connectivity_ok")
            error = sum(1 for item in results if item.get("status") == "error")
            logger.info(
                "API provider health sweep complete: total=%s ok=%s no_key=%s blocked_region=%s connectivity_ok=%s error=%s",
                len(results),
                ok,
                no_key,
                blocked_region,
                connectivity_ok,
                error,
            )
        except asyncio.CancelledError:
            _monitor_state["loop_running"] = False
            raise
        except Exception as exc:
            _monitor_state["last_error"] = redact_sensitive_text(exc)
            logger.warning(
                "API provider health sweep failed: %s",
                redact_sensitive_text(exc),
                exc_info=True,
            )
        await asyncio.sleep(int(provider_health_monitor_settings()["interval_seconds"]))
