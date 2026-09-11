"""Runtime reload helpers for admin API provider configuration changes."""
from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, List, Optional

from services.api_config_health_cache_service import clear_all_provider_health_cache
from services.api_config_runtime_loader import load_api_configs_to_env


ReloadCallback = Callable[[], Awaitable[Any]]


class ApiConfigReloadFailed(RuntimeError):
    pass


def env_refreshed_from_reload_result(result: Any) -> bool:
    if isinstance(result, dict):
        return bool(result.get("env_refreshed", result.get("success")))
    return bool(result)


async def reload_api_env_runtime(*, clear_health_cache: bool = False) -> Dict[str, Any]:
    """Reload DB-backed provider config into env and optionally clear health cache."""
    try:
        result = await load_api_configs_to_env()
    except Exception as exc:
        if clear_health_cache:
            await clear_all_provider_health_cache()
        raise ApiConfigReloadFailed("API env reload failed") from exc

    refreshed = bool(result.get("success"))
    health_cache_invalidated: List[str] = []
    if not refreshed:
        if clear_health_cache:
            health_cache_invalidated = await clear_all_provider_health_cache()
        raise ApiConfigReloadFailed(str(result.get("error") or "API env reload failed"))

    if clear_health_cache:
        health_cache_invalidated = await clear_all_provider_health_cache()

    return {
        "success": refreshed,
        "env_refreshed": refreshed,
        "loaded": result.get("loaded", 0),
        "loaded_providers": result.get("loaded_providers", []),
        "health_cache_invalidated": health_cache_invalidated,
        "error": result.get("error"),
    }


async def reload_api_env_after_config_change(reload_api_env: Optional[ReloadCallback] = None) -> bool:
    if reload_api_env:
        return env_refreshed_from_reload_result(await reload_api_env())
    return env_refreshed_from_reload_result(await reload_api_env_runtime())
