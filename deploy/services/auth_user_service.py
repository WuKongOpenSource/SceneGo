"""Database-backed user helpers for auth routes.

Auth routes should orchestrate login responses. This module owns the DAO calls
needed for DB credential checks and legacy user-row synchronization.
"""
from __future__ import annotations

from typing import Any, Optional

from dao_user import UserDAO
from services.model_access_service import ACCESS_INHERIT


def default_permissions() -> dict[str, Any]:
    return {
        "accessMode": ACCESS_INHERIT,
        "allowedModels": [],
        "priority": "normal",
        "canExport": True,
    }


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


async def verify_database_credentials(
    username: str,
    password: str,
    *,
    logger: Any,
) -> Optional[dict[str, Any]]:
    """Return the DB user row when username/password is valid."""
    try:
        user = await UserDAO.verify_password(username, password)
        return user if user else None
    except Exception as exc:
        logger.error("Database authentication failed: %s", exc)
        return None


async def ensure_login_user_record(
    username: str,
    password: str,
    *,
    logger: Any,
) -> bool:
    """Ensure a successful login has a DB user row and default permissions."""
    try:
        logger.info("Checking user row for %s during login", username)
        existing_user = await UserDAO.get_user_by_username(username)

        if not existing_user:
            logger.info("User %s not found in DB, creating row", username)
            created_user = await UserDAO.create_user(
                username=username,
                password=password,
                email=f"{username}@local.com",
            )
            if not created_user:
                logger.error("Creating user row for %s returned None", username)
                return False
            target_user_id = _record_get(created_user, "user_id", username)
            logger.info("User %s synced to DB with id=%s", username, target_user_id)
            await UserDAO.update_user_permissions(target_user_id, default_permissions())
            logger.info("Default permissions assigned for user %s", username)
            return True

        target_user_id = _record_get(existing_user, "user_id", username)
        logger.info("User %s already exists in DB with id=%s", username, target_user_id)
        user_permissions = _record_get(existing_user, "permissions")
        if not user_permissions or not isinstance(user_permissions, dict):
            logger.info("User %s has no permission payload, assigning defaults", username)
            await UserDAO.update_user_permissions(target_user_id, default_permissions())
            logger.info("Default permissions assigned for existing user %s", username)
        return True
    except Exception as exc:
        logger.error("User sync during login failed: %s", exc, exc_info=True)
        return False
