"""Persist explicitly configured initial administrator roles exactly once.

Runtime authorization must only trust the role stored on the user record. The
environment variables handled here are installation input, not a permanent
username allowlist. A digest marker prevents the same bootstrap configuration
from silently restoring a role after an administrator later demotes it.
"""
from __future__ import annotations

import hashlib
import json
import os
from typing import Any, Mapping


BOOTSTRAP_STATE_KEY = "security.admin_bootstrap.v1"


def load_builtin_users(
    *, logger: Any, environment: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Load optional installation credentials without an unsafe fallback.

    Invalid explicit credentials must disable this login path, not silently
    select a development password. Database accounts and persisted roles are
    independent of this optional installation input.
    """
    source = environment if environment is not None else os.environ
    username = (source.get("OSTORY_BUILTIN_ADMIN_USERNAME") or "admin").strip()
    password = (source.get("ADMIN_PASSWORD") or "").strip()
    if password:
        if not username:
            logger.error("ADMIN_PASSWORD is set but OSTORY_BUILTIN_ADMIN_USERNAME is empty; built-in login disabled")
            return {}
        if len(password) < 8:
            logger.error("ADMIN_PASSWORD is set but shorter than 8 characters; built-in admin login disabled")
            return {}
        return {username: password}

    allow_development = (source.get("ALLOW_DEV_ADMIN_PASSWORD") or "").strip().lower() in {
        "1", "true", "yes", "on",
    }
    if allow_development:
        runtime = (source.get("OSTORY_RUNTIME_ENV") or "development").strip().lower()
        if runtime == "production":
            logger.error("ALLOW_DEV_ADMIN_PASSWORD is forbidden in production; built-in admin login disabled")
            return {}
        logger.warning("Development admin password enabled by ALLOW_DEV_ADMIN_PASSWORD; do not use in production")
        return {username or "admin": "admin123"}

    logger.info("Built-in admin login disabled because ADMIN_PASSWORD is not configured")
    return {}


def configured_admin_roles(environment: Mapping[str, str] | None = None) -> dict[str, str]:
    """Return explicit username assignments; super-admin wins conflicts."""
    source = environment if environment is not None else os.environ
    assignments: dict[str, str] = {}
    for username in (source.get("OSTORY_ADMIN_USERNAMES") or "").split(","):
        normalized = username.strip()
        if normalized:
            assignments[normalized] = "admin"
    for username in (source.get("OSTORY_SUPER_ADMIN_USERNAMES") or "").split(","):
        normalized = username.strip()
        if normalized:
            assignments[normalized] = "super_admin"
    return assignments


def _configuration_digest(assignments: Mapping[str, str]) -> str:
    canonical = json.dumps(dict(sorted(assignments.items())), ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def apply_configured_admin_bootstrap(
    *,
    user_dao: Any,
    settings_dao: Any,
    logger: Any,
    environment: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Persist an explicit bootstrap once all configured accounts exist.

    Missing users keep the bootstrap pending so a legacy built-in account can
    be created by its first successful login. Once every assignment is stored,
    authorization reads database roles and never consults this allowlist.
    """
    assignments = configured_admin_roles(environment)
    if not assignments:
        return {"configured": 0, "updated": 0, "missing": 0, "applied": False}

    digest = _configuration_digest(assignments)
    if await settings_dao.get(BOOTSTRAP_STATE_KEY) == digest:
        return {
            "configured": len(assignments),
            "updated": 0,
            "missing": 0,
            "applied": False,
        }

    updated = 0
    missing = 0
    for username, requested_role in assignments.items():
        user = await user_dao.get_user_by_username(username)
        if not user:
            missing += 1
            continue
        user_id = str(user.get("user_id") or "").strip()
        if not user_id:
            missing += 1
            continue
        current_role = str(user.get("role") or "user")
        if current_role != requested_role:
            await user_dao.set_role(user_id, requested_role)
            updated += 1

    if missing:
        logger.warning(
            "Administrator bootstrap remains pending because %s configured account(s) do not exist",
            missing,
        )
        return {
            "configured": len(assignments),
            "updated": updated,
            "missing": missing,
            "applied": False,
        }

    persisted = await settings_dao.set(
        BOOTSTRAP_STATE_KEY,
        digest,
        "Digest of the one-time administrator bootstrap assignment",
    )
    if not persisted:
        raise RuntimeError("Administrator bootstrap roles were updated but the completion marker was not stored")
    logger.info(
        "Administrator bootstrap completed for %s configured account(s); remove bootstrap environment values",
        len(assignments),
    )
    return {
        "configured": len(assignments),
        "updated": updated,
        "missing": 0,
        "applied": True,
    }

