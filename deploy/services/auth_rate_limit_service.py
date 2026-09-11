"""Redis-backed password-login throttling without storing raw identities."""
from __future__ import annotations

import hashlib
import hmac
import os
from dataclasses import dataclass


class AuthRateLimitError(RuntimeError):
    pass


class AuthRateLimitConfigurationError(AuthRateLimitError):
    pass


class AuthRateLimitUnavailable(AuthRateLimitError):
    pass


class AuthRateLimited(AuthRateLimitError):
    def __init__(self, retry_after: int):
        self.retry_after = max(1, int(retry_after))
        super().__init__("登录尝试过于频繁，请稍后重试")


@dataclass(frozen=True)
class AuthRateLimitSettings:
    runtime_env: str
    enabled: bool
    secret: str
    window_seconds: int
    identity_attempts: int
    ip_attempts: int

    @property
    def production(self) -> bool:
        return self.runtime_env == "production"


_CONSUME_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
"""


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    return max(minimum, min(value, maximum))


def load_auth_rate_limit_settings() -> AuthRateLimitSettings:
    runtime_env = os.getenv("OSTORY_RUNTIME_ENV", "development").strip().lower()
    production = runtime_env == "production"
    enabled = _env_bool("AUTH_LOGIN_RATE_LIMIT_ENABLED", True)
    secret = os.getenv("OSTORY_AUTH_RATE_LIMIT_SECRET", "").strip()

    if production and not enabled:
        raise AuthRateLimitConfigurationError(
            "AUTH_LOGIN_RATE_LIMIT_ENABLED cannot be disabled in production"
        )
    if enabled and len(secret) < 32:
        if production:
            raise AuthRateLimitConfigurationError(
                "OSTORY_AUTH_RATE_LIMIT_SECRET must contain at least 32 characters"
            )
        # Stable only for local development. Production must never share this
        # public seed because it protects the privacy of Redis key material.
        secret = hashlib.sha256(b"ostory-development-auth-rate-limit").hexdigest()

    return AuthRateLimitSettings(
        runtime_env=runtime_env,
        enabled=enabled,
        secret=secret,
        window_seconds=_int_env("AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS", 900, 60, 86400),
        identity_attempts=_int_env("AUTH_LOGIN_RATE_LIMIT_IDENTITY_ATTEMPTS", 10, 3, 1000),
        ip_attempts=_int_env("AUTH_LOGIN_RATE_LIMIT_IP_ATTEMPTS", 100, 10, 10000),
    )


def validate_auth_rate_limit_configuration() -> None:
    load_auth_rate_limit_settings()


def _key(settings: AuthRateLimitSettings, scope: str, value: str) -> str:
    normalized = value.strip().casefold() or "unknown"
    digest = hmac.new(
        settings.secret.encode("utf-8"),
        f"{scope}:{normalized}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:40]
    return f"auth:login-attempt:{scope}:{digest}"


async def _consume_key(redis_client, key: str, *, window_seconds: int) -> tuple[int, int]:
    try:
        result = await redis_client.eval(_CONSUME_SCRIPT, 1, key, str(window_seconds))
        count, ttl = int(result[0]), int(result[1])
    except Exception as exc:
        raise AuthRateLimitUnavailable("登录保护服务暂不可用") from exc
    return count, ttl if ttl > 0 else window_seconds


async def consume_login_attempt(
    redis_client,
    *,
    identity: str,
    remote_ip: str | None,
    settings: AuthRateLimitSettings | None = None,
) -> None:
    settings = settings or load_auth_rate_limit_settings()
    if not settings.enabled:
        return
    if redis_client is None:
        if settings.production:
            raise AuthRateLimitUnavailable("登录保护服务暂不可用")
        return

    identity_count, identity_ttl = await _consume_key(
        redis_client,
        _key(settings, "identity", identity),
        window_seconds=settings.window_seconds,
    )
    ip_count, ip_ttl = await _consume_key(
        redis_client,
        _key(settings, "ip", remote_ip or "unknown"),
        window_seconds=settings.window_seconds,
    )
    retry_after = max(identity_ttl, ip_ttl)
    if identity_count > settings.identity_attempts or ip_count > settings.ip_attempts:
        raise AuthRateLimited(retry_after)


async def clear_login_identity(
    redis_client,
    *,
    identity: str,
    settings: AuthRateLimitSettings | None = None,
) -> None:
    settings = settings or load_auth_rate_limit_settings()
    if not settings.enabled or redis_client is None:
        return
    try:
        await redis_client.delete(_key(settings, "identity", identity))
    except Exception as exc:
        if settings.production:
            raise AuthRateLimitUnavailable("登录保护服务暂不可用") from exc
