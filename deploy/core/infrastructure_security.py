"""Fail-closed security policy for PostgreSQL and Redis connections.

Local development commonly binds both services to loopback without TLS. That
assumption is not safe for a production host that sends credentials and user
data across a network. The helpers below keep transport rules independent from
the connection libraries, which makes the policy testable and prevents setup
scripts from silently inventing weaker defaults.
"""
from __future__ import annotations

import ipaddress
import os
from typing import Mapping, Optional


TRUE_VALUES = {"1", "true", "yes", "on"}
DATABASE_SSL_MODES = {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}


class InfrastructureSecurityError(RuntimeError):
    """Raised when production persistence transport is configured unsafely."""


def _env_bool(name: str, *, environ: Optional[Mapping[str, str]] = None) -> bool:
    source = os.environ if environ is None else environ
    return str(source.get(name, "")).strip().casefold() in TRUE_VALUES


def _is_production(*, environ: Optional[Mapping[str, str]] = None) -> bool:
    source = os.environ if environ is None else environ
    return str(source.get("OSTORY_RUNTIME_ENV", "development")).strip().casefold() == "production"


def is_loopback_host(host: str) -> bool:
    """Return True only for explicit loopback host names or IP literals."""
    value = str(host or "").strip().strip("[]").rstrip(".").casefold()
    if value == "localhost" or value.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(value).is_loopback
    except ValueError:
        return False


def validate_database_security(
    *,
    host: str,
    password: str,
    ssl_mode: str = "",
    environ: Optional[Mapping[str, str]] = None,
) -> str:
    """Validate DB credentials/transport and return the normalized ssl mode."""
    mode = str(ssl_mode or "").strip().casefold()
    if mode and mode not in DATABASE_SSL_MODES:
        raise InfrastructureSecurityError(
            "DB_SSLMODE must be one of: " + ", ".join(sorted(DATABASE_SSL_MODES))
        )
    local = is_loopback_host(host)
    if not mode:
        mode = "disable" if local else "verify-full"
    if not _is_production(environ=environ):
        return mode
    if not str(password or "") and not _env_bool(
        "ALLOW_PASSWORDLESS_LOCAL_DATABASE", environ=environ
    ):
        raise InfrastructureSecurityError(
            "DB_PASSWORD is required in production; passwordless local database auth "
            "requires ALLOW_PASSWORDLESS_LOCAL_DATABASE=true after a manual pg_hba.conf review"
        )
    if not local and mode != "verify-full" and not _env_bool(
        "ALLOW_INSECURE_DATABASE_TRANSPORT", environ=environ
    ):
        raise InfrastructureSecurityError(
            "remote PostgreSQL requires DB_SSLMODE=verify-full in production; "
            "set ALLOW_INSECURE_DATABASE_TRANSPORT=true only after a documented network review"
        )
    return mode


def validate_redis_security(
    *,
    host: str,
    password: str | None,
    tls_enabled: bool,
    environ: Optional[Mapping[str, str]] = None,
) -> None:
    """Reject unauthenticated or clear-text remote Redis in production."""
    if not _is_production(environ=environ) or is_loopback_host(host):
        return
    if not str(password or "") and not _env_bool(
        "ALLOW_UNAUTHENTICATED_REMOTE_REDIS", environ=environ
    ):
        raise InfrastructureSecurityError(
            "REDIS_PASSWORD is required for remote Redis in production"
        )
    if not tls_enabled and not _env_bool(
        "ALLOW_INSECURE_REDIS_TRANSPORT", environ=environ
    ):
        raise InfrastructureSecurityError(
            "remote Redis requires REDIS_SSL=true in production"
        )

