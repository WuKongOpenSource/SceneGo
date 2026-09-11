"""Redis-backed creator presence with an in-process safety fallback."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, Optional


ONLINE_TTL_SECONDS = 10 * 60
LAST_ACTIVE_TTL_SECONDS = 30 * 24 * 60 * 60
_redis_provider: Optional[Callable[[], Any]] = None
_fallback: Dict[str, Dict[str, float]] = {}


def configure_presence_store(redis_provider: Callable[[], Any]) -> None:
    global _redis_provider
    _redis_provider = redis_provider


def _now_timestamp(now: Optional[datetime] = None) -> float:
    value = now or datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.timestamp()


def _online_key(user_id: str) -> str:
    return f"ostory:presence:online:{user_id}"


def _last_active_key(user_id: str) -> str:
    return f"ostory:presence:last-active:{user_id}"


def _client() -> Any:
    if not _redis_provider:
        return None
    try:
        return _redis_provider()
    except Exception:
        return None


async def touch_user_presence(user_id: str, *, now: Optional[datetime] = None) -> None:
    identity = str(user_id or "").strip()
    if not identity:
        return
    timestamp = _now_timestamp(now)
    _fallback[identity] = {"last_active": timestamp, "expires_at": timestamp + ONLINE_TTL_SECONDS}
    redis_client = _client()
    if redis_client is None:
        return
    try:
        pipe = redis_client.pipeline(transaction=False)
        pipe.set(_online_key(identity), str(timestamp), ex=ONLINE_TTL_SECONDS)
        pipe.set(_last_active_key(identity), str(timestamp), ex=LAST_ACTIVE_TTL_SECONDS)
        await pipe.execute()
    except Exception:
        # Presence must never make authenticated product requests fail.
        return


async def clear_user_presence(user_id: str, *, now: Optional[datetime] = None) -> None:
    identity = str(user_id or "").strip()
    if not identity:
        return
    timestamp = _now_timestamp(now)
    current = _fallback.setdefault(identity, {})
    current["last_active"] = max(float(current.get("last_active") or 0), timestamp)
    current["expires_at"] = 0
    redis_client = _client()
    if redis_client is None:
        return
    try:
        await redis_client.delete(_online_key(identity))
    except Exception:
        return


def _fallback_presence(user_id: str, now_ts: float) -> Dict[str, Any]:
    state = _fallback.get(user_id) or {}
    last_active = float(state.get("last_active") or 0)
    expires_at = float(state.get("expires_at") or 0)
    return {
        "is_online": bool(expires_at > now_ts),
        "last_active_at": datetime.fromtimestamp(last_active, timezone.utc).isoformat() if last_active else None,
    }


async def get_users_presence(
    user_ids: Iterable[str],
    *,
    now: Optional[datetime] = None,
) -> Dict[str, Dict[str, Any]]:
    identities = [str(item or "").strip() for item in user_ids if str(item or "").strip()]
    now_ts = _now_timestamp(now)
    fallback = {identity: _fallback_presence(identity, now_ts) for identity in identities}
    redis_client = _client()
    if redis_client is None or not identities:
        return fallback
    try:
        pipe = redis_client.pipeline(transaction=False)
        for identity in identities:
            pipe.get(_online_key(identity))
            pipe.get(_last_active_key(identity))
        values = await pipe.execute()
    except Exception:
        return fallback

    result: Dict[str, Dict[str, Any]] = {}
    for index, identity in enumerate(identities):
        online_value = values[index * 2]
        active_value = values[index * 2 + 1]
        if isinstance(active_value, bytes):
            active_value = active_value.decode("utf-8", errors="ignore")
        last_active = None
        try:
            if active_value:
                last_active = datetime.fromtimestamp(float(active_value), timezone.utc).isoformat()
        except (TypeError, ValueError, OSError):
            last_active = fallback[identity]["last_active_at"]
        result[identity] = {
            "is_online": bool(online_value),
            "last_active_at": last_active,
        }
    return result
