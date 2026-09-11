"""Administrator-owned account identity updates.

``users.user_id`` is the stable ownership key used by projects, credits, media,
organizations, and audit data. Renaming an account must therefore update only
``users.username`` so historical and downstream ownership remains intact.
"""
from __future__ import annotations

from typing import Any, Dict

from services.user_profile_service import USERNAME_RE


class AdminUserRenameError(RuntimeError):
    pass


class AdminUserNotFound(AdminUserRenameError):
    pass


class AdminUsernameInvalid(AdminUserRenameError):
    pass


class AdminUsernameExists(AdminUserRenameError):
    pass


class ProtectedSystemUsername(AdminUserRenameError):
    pass


class AdminUsernameUpdateFailed(AdminUserRenameError):
    pass


def _get(record: Any, key: str, default: Any = None) -> Any:
    if not record:
        return default
    getter = getattr(record, "get", None)
    if callable(getter):
        return getter(key, default)
    try:
        return record[key]
    except Exception:
        return default


async def rename_user(
    user_id: str,
    username: str,
    *,
    user_dao: Any,
) -> Dict[str, Any]:
    """Rename one account while preserving its stable ``user_id`` identity."""
    current = await user_dao.admin_get_user_detail(user_id)
    if not current:
        raise AdminUserNotFound("user not found")

    # The bootstrap account is also an environment-owned recovery identity.
    # Keeping its login name fixed avoids an invisible second alias backed by
    # ADMIN_PASSWORD while still allowing every ordinary account to be renamed.
    if user_id == "admin":
        raise ProtectedSystemUsername("bootstrap admin username is protected")

    next_username = str(username or "").strip()
    if not USERNAME_RE.fullmatch(next_username):
        raise AdminUsernameInvalid("username must be 2-40 characters")

    previous_username = str(_get(current, "username", "") or "")
    if next_username == previous_username:
        return {"changed": False, "before": dict(current), "user": dict(current)}

    existing = await user_dao.get_user_by_username_any(next_username)
    if existing and str(_get(existing, "user_id", "")) != str(user_id):
        raise AdminUsernameExists("username already exists")

    updated = await user_dao.update_self_profile(user_id, username=next_username)
    if not updated:
        raise AdminUsernameUpdateFailed("username update failed")

    user = await user_dao.admin_get_user_detail(user_id)
    if not user:
        raise AdminUsernameUpdateFailed("updated user could not be loaded")

    return {"changed": True, "before": dict(current), "user": dict(user)}
