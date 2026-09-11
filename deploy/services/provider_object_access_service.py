"""Object-level access for resources stored in shared provider accounts."""
from __future__ import annotations

from typing import Any, Dict, Iterable, Optional


class ProviderObjectAccessDenied(LookupError):
    pass


async def record_provider_object(
    *,
    provider: str,
    object_type: str,
    object_id: str,
    owner_identity: str,
    provider_object_dao: Any,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    if not object_id:
        return
    await provider_object_dao.upsert(
        provider=provider,
        object_type=object_type,
        object_id=str(object_id),
        user_id=str(owner_identity),
        metadata=metadata or {},
    )


async def require_provider_object_owner(
    *,
    provider: str,
    object_type: str,
    object_id: str,
    owner_identity: str,
    provider_object_dao: Any,
) -> Dict[str, Any]:
    row = await provider_object_dao.get(
        provider=provider,
        object_type=object_type,
        object_id=str(object_id),
    )
    if not row or str(row.get("user_id") or "") != str(owner_identity):
        raise ProviderObjectAccessDenied("Provider object not found or access denied")
    return dict(row)


async def owned_provider_object_ids(
    *,
    provider: str,
    object_types: Iterable[str],
    owner_identity: str,
    provider_object_dao: Any,
) -> set[str]:
    values = await provider_object_dao.list_ids(
        provider=provider,
        object_types=list(object_types),
        user_id=str(owner_identity),
    )
    return {str(value) for value in values}


async def reject_foreign_provider_object(
    *,
    provider: str,
    object_types: Iterable[str],
    object_id: str,
    owner_identity: str,
    provider_object_dao: Any,
) -> None:
    """Allow built-ins/untracked legacy ids, but reject a tracked foreign object."""
    for object_type in object_types:
        row = await provider_object_dao.get(
            provider=provider,
            object_type=object_type,
            object_id=str(object_id),
        )
        if row:
            if str(row.get("user_id") or "") != str(owner_identity):
                raise ProviderObjectAccessDenied("Provider object not found or access denied")
            return


def filter_minimax_voice_payload(payload: Dict[str, Any], owned_voice_ids: set[str]) -> Dict[str, Any]:
    filtered = dict(payload or {})
    for bucket in ("voice_cloning", "voice_generation"):
        items = filtered.get(bucket)
        if isinstance(items, list):
            filtered[bucket] = [
                item
                for item in items
                if isinstance(item, dict) and str(item.get("voice_id") or "") in owned_voice_ids
            ]
    return filtered


def find_minimax_voice(payload: Dict[str, Any], voice_id: str) -> Optional[Dict[str, Any]]:
    for bucket in ("system_voice", "voice_cloning", "voice_generation"):
        for item in payload.get(bucket) or []:
            if isinstance(item, dict) and str(item.get("voice_id") or "") == str(voice_id):
                return {"success": True, "voice": item, "bucket": bucket}
    return None
