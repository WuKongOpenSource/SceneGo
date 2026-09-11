"""Database-backed browser/API session validation.

The signed token proves integrity and expiry. The database check below proves
that the account is still active and that no security-sensitive account change
has revoked the token since it was issued.
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable, Optional

from core import jwt_auth


IdentityLoader = Callable[[str], Awaitable[Optional[dict[str, Any]]]]


def _record_get(record: Any, key: str, default: Any = None) -> Any:
    if not record:
        return default
    getter = getattr(record, "get", None)
    if callable(getter):
        return getter(key, default)
    try:
        return record[key]
    except Exception:
        return default


def session_version(record: Any) -> int:
    """Read a validated positive session version from an account record."""
    value = _record_get(record, "session_version")
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ValueError("account session_version is missing or invalid")
    return value


def account_is_active(record: Any) -> bool:
    if not record or _record_get(record, "is_active", True) is not True:
        return False
    return str(_record_get(record, "status", "active") or "active").lower() == "active"


async def validate_session_token(
    token: str,
    *,
    user_dao: Any,
    identity_loader: Optional[IdentityLoader] = None,
) -> Optional[dict[str, Any]]:
    """Return the authoritative active account for a current session token."""
    claims = jwt_auth.verify_token_claims(token)
    if not claims:
        return None
    subject = str(claims["u"])
    loader = identity_loader or user_dao.get_session_identity
    record = await loader(subject)
    if not account_is_active(record):
        return None
    try:
        current_version = session_version(record)
    except (TypeError, ValueError):
        return None
    if claims["sv"] != current_version:
        return None
    return dict(record)


async def issue_session_token(
    user_id: str,
    *,
    user_dao: Any,
    token_creator: Any = jwt_auth.create_token,
) -> str:
    """Issue a token only from the current authoritative active account row."""
    record = await user_dao.get_session_identity(str(user_id))
    if not account_is_active(record):
        raise ValueError("cannot issue a session for an inactive account")
    version = session_version(record)
    return token_creator(str(_record_get(record, "user_id", user_id)), session_version=version)
