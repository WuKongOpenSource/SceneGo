"""Current-user profile and account settings service."""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional

from services.password_service import validate_password_input, verify_password_hash


class UserProfileError(RuntimeError):
    pass


class UserProfileNotFound(UserProfileError):
    pass


class UsernameAlreadyExists(UserProfileError):
    pass


class InvalidUsername(UserProfileError):
    pass


class InvalidPhoneNumber(UserProfileError):
    pass


class InvalidVerificationCode(UserProfileError):
    pass


class PhoneIdentityImmutable(UserProfileError):
    pass


class InvalidPassword(UserProfileError):
    pass


USERNAME_RE = re.compile(r"^[A-Za-z0-9_\-\u4e00-\u9fff]{2,40}$")


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


def _serialize(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _serialize_record(record: Any) -> Dict[str, Any]:
    return {key: _serialize(value) for key, value in dict(record or {}).items()}


def _project_time_value(project: Dict[str, Any]) -> Any:
    return (
        project.get("last_accessed_at")
        or project.get("updated_at")
        or project.get("created_at")
        or ""
    )


def _project_sort_key(project: Dict[str, Any]) -> str:
    value = _project_time_value(project)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value or "")


def _project_summary(project: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "project_id": project.get("project_id"),
        "project_name": project.get("project_name") or project.get("name") or "未命名项目",
        "description": project.get("description") or "",
        "cover_url": project.get("cover_url"),
        "owner_user_id": project.get("user_id"),
        "owner_name": project.get("owner_name") or project.get("user_id"),
        "is_archived": bool(project.get("is_archived")),
        "member_role": project.get("member_role"),
        "episode_count": int(project.get("episode_count") or 0),
        "updated_at": _serialize(project.get("updated_at")),
        "last_accessed_at": _serialize(project.get("last_accessed_at")),
        "created_at": _serialize(project.get("created_at")),
    }


async def resolve_authenticated_user_id(subject: str, *, user_dao: Any) -> str:
    """Map a JWT subject or login username to the stable users.user_id."""
    if not subject:
        return subject

    try:
        user = await user_dao.get_user_by_username(subject)
        if user:
            return str(_get(user, "user_id", subject) or subject)
    except Exception:
        pass

    try:
        user = await user_dao.get_user_by_id(subject)
        if user:
            return str(_get(user, "user_id", subject) or subject)
    except Exception:
        pass

    return subject


async def get_profile_summary(
    user_id: str,
    *,
    user_dao: Any,
    project_dao: Any,
    project_member_dao: Any,
    credit_account_dao: Any,
    logger: Any = None,
    recent_limit: int = 5,
) -> Dict[str, Any]:
    user = await user_dao.get_user_profile_by_id(user_id)
    if not user:
        raise UserProfileNotFound("user not found")

    try:
        credit_account = await credit_account_dao.get_or_create("user", user_id)
    except Exception as exc:
        if logger:
            logger.warning("profile credit summary failed user_id=%s err=%s", user_id, exc)
        credit_account = {
            "account_id": None,
            "available_credits": 0,
            "frozen_credits": 0,
            "total_used_credits": 0,
        }

    projects: Iterable[Any]
    try:
        projects = await project_member_dao.get_user_accessible_projects(user_id, include_archived=True)
    except Exception as exc:
        if logger:
            logger.warning("profile accessible project summary failed user_id=%s err=%s", user_id, exc)
        projects = await project_dao.get_user_projects(user_id, include_archived=True)

    project_rows: List[Dict[str, Any]] = [dict(project) for project in projects or []]
    active_projects = [project for project in project_rows if not project.get("is_archived")]
    recent_projects = sorted(active_projects, key=_project_sort_key, reverse=True)[:recent_limit]

    profile = _serialize_record(user)
    profile.setdefault("phone_number", None)
    profile.setdefault("phone_verified", False)
    profile["phone_verified"] = bool(profile.get("phone_verified"))
    profile.setdefault("email_verified", False)
    profile["email_verified"] = bool(profile.get("email_verified"))

    return {
        "success": True,
        "profile": profile,
        "credits": {
            "account_id": _get(credit_account, "account_id"),
            "available_credits": int(_get(credit_account, "available_credits", 0) or 0),
            "account_credits": int(_get(credit_account, "account_credits", 0) or 0),
            "gift_credits": int(_get(credit_account, "gift_credits", 0) or 0),
            "gift_expires_at": _serialize(_get(credit_account, "gift_expires_at")),
            "frozen_credits": int(_get(credit_account, "frozen_credits", 0) or 0),
            "total_used_credits": int(_get(credit_account, "total_used_credits", 0) or 0),
        },
        "project_stats": {
            "total": len(project_rows),
            "active": len(active_projects),
            "archived": len(project_rows) - len(active_projects),
            "owned": sum(1 for project in project_rows if project.get("user_id") == user_id),
            "shared": sum(1 for project in project_rows if project.get("user_id") != user_id),
        },
        "recent_projects": [_project_summary(project) for project in recent_projects],
    }


async def update_profile(
    user_id: str,
    *,
    username: Optional[str],
    phone_number: Optional[str],
    verification_code: Optional[str],
    user_dao: Any,
) -> Dict[str, Any]:
    current = await user_dao.get_user_profile_by_id(user_id)
    if not current:
        raise UserProfileNotFound("user not found")

    fields: Dict[str, Any] = {}
    username_changed = False

    if username is not None:
        next_username = username.strip()
        if not USERNAME_RE.match(next_username):
            raise InvalidUsername("username must be 2-40 characters")
        if next_username != _get(current, "username"):
            existing = await user_dao.get_user_by_username(next_username)
            if existing and _get(existing, "user_id") != user_id:
                raise UsernameAlreadyExists("username already exists")
            fields["username"] = next_username
            username_changed = True

    if phone_number is not None:
        next_phone = phone_number.strip()
        if next_phone != (_get(current, "phone_number") or "") or verification_code:

            raise PhoneIdentityImmutable("phone identity must be changed through verified auth flow")

    if fields:
        await user_dao.update_self_profile(user_id, **fields)

    updated = await user_dao.get_user_profile_by_id(user_id)
    if not updated:
        raise UserProfileNotFound("user not found")

    return {
        "success": True,
        "profile": _serialize_record(updated),
        "username_changed": username_changed,
    }


async def change_password(
    user_id: str,
    *,
    current_password: str,
    new_password: str,
    user_dao: Any,
) -> Dict[str, Any]:
    try:
        validate_password_input(new_password)
    except ValueError as exc:
        raise InvalidPassword("new password must be 8-128 characters") from exc
    if not current_password:
        raise InvalidPassword("current password is required")

    user = await user_dao.get_user_with_password_by_id(user_id)
    if not user:
        raise UserProfileNotFound("user not found")

    valid, _needs_upgrade = verify_password_hash(current_password, _get(user, "password_hash") or "")
    if not valid:
        raise InvalidPassword("current password is incorrect")

    await user_dao.reset_password(user_id, new_password)
    return {"success": True}
