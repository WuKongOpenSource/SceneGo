"""Cache invalidation helpers for admin API provider configuration writes."""
from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, List, Optional

from services.api_provider_health_monitor import (
    clear_all_cached_provider_health,
    delete_cached_provider_health_many,
    delete_cached_provider_health_targets,
)
from services.api_provider_registry import PROVIDER_CATALOG, normalize_provider
from utils.config_helpers import _config_get

logger = logging.getLogger(__name__)


def provider_health_invalidation_targets(items: Iterable[Any]) -> tuple[List[str], List[Dict[str, Optional[str]]]]:
    provider_ids: List[str] = []
    targets: List[Dict[str, Optional[str]]] = []
    seen_providers: set[str] = set()
    seen_targets: set[tuple[str, Optional[str]]] = set()
    for item in items:
        if isinstance(item, str):
            provider = normalize_provider(item)
            model_name = None
        else:
            provider = normalize_provider(str(_config_get(item, "provider", "") or ""))
            model_name = str(_config_get(item, "model_name", "") or "").strip() or None
        if not provider:
            continue
        if provider not in seen_providers:
            provider_ids.append(provider)
            seen_providers.add(provider)
        for target_model in (None, model_name):
            target_key = (provider, target_model)
            if target_key in seen_targets:
                continue
            seen_targets.add(target_key)
            targets.append({"provider": provider, "model_name": target_model})
    return provider_ids, targets


async def invalidate_provider_health_for_items(items: Iterable[Any]) -> List[str]:
    provider_ids, targets = provider_health_invalidation_targets(items)
    if not provider_ids:
        return []
    try:
        cleared = await delete_cached_provider_health_many(provider_ids)
        await delete_cached_provider_health_targets(targets)
        return cleared
    except Exception as exc:
        logger.warning("Failed to invalidate provider health cache: %s", exc, exc_info=True)
        return []


async def clear_all_provider_health_cache() -> List[str]:
    """Clear all managed provider health cache entries with a registry fallback."""
    try:
        cleared = await clear_all_cached_provider_health()
        if cleared:
            return cleared
        return await delete_cached_provider_health_many(PROVIDER_CATALOG)
    except Exception as exc:
        logger.warning("Provider health cache invalidation failed: %s", exc, exc_info=True)
        return []
