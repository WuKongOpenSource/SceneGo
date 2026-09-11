"""Redis-backed abuse control for anonymous final-product feedback."""
from __future__ import annotations

import hashlib
import hmac
import os
from dataclasses import dataclass


class PublicFeedbackRateLimitError(RuntimeError):
    pass


class PublicFeedbackRateLimitConfigurationError(PublicFeedbackRateLimitError):
    pass


class PublicFeedbackRateLimitUnavailable(PublicFeedbackRateLimitError):
    pass


class PublicFeedbackRateLimited(PublicFeedbackRateLimitError):
    def __init__(self, retry_after: int):
        self.retry_after = max(1, int(retry_after))
        super().__init__("提交意见过于频繁，请稍后重试")


@dataclass(frozen=True)
class PublicFeedbackRateLimitSettings:
    production: bool
    enabled: bool
    secret: str
    visitor_window_seconds: int
    visitor_attempts: int
    share_window_seconds: int
    share_attempts: int


_CONSUME_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
"""


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().casefold() in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(value, maximum))


def load_public_feedback_rate_limit_settings() -> PublicFeedbackRateLimitSettings:
    production = os.getenv("OSTORY_RUNTIME_ENV", "development").strip().casefold() == "production"
    enabled = _bool_env("PUBLIC_FEEDBACK_RATE_LIMIT_ENABLED", True)
    secret = (
        os.getenv("OSTORY_PUBLIC_RATE_LIMIT_SECRET", "").strip()
        or os.getenv("OSTORY_AUTH_RATE_LIMIT_SECRET", "").strip()
    )
    if production and not enabled:
        raise PublicFeedbackRateLimitConfigurationError(
            "PUBLIC_FEEDBACK_RATE_LIMIT_ENABLED cannot be disabled in production"
        )
    if enabled and len(secret) < 32:
        if production:
            raise PublicFeedbackRateLimitConfigurationError(
                "OSTORY_PUBLIC_RATE_LIMIT_SECRET or OSTORY_AUTH_RATE_LIMIT_SECRET "
                "must contain at least 32 characters"
            )
        secret = hashlib.sha256(b"ostory-development-public-feedback-rate-limit").hexdigest()
    return PublicFeedbackRateLimitSettings(
        production=production,
        enabled=enabled,
        secret=secret,
        visitor_window_seconds=_int_env("PUBLIC_FEEDBACK_VISITOR_WINDOW_SECONDS", 600, 60, 86400),
        visitor_attempts=_int_env("PUBLIC_FEEDBACK_VISITOR_ATTEMPTS", 10, 1, 1000),
        share_window_seconds=_int_env("PUBLIC_FEEDBACK_SHARE_WINDOW_SECONDS", 3600, 60, 86400),
        share_attempts=_int_env("PUBLIC_FEEDBACK_SHARE_ATTEMPTS", 100, 1, 10000),
    )


def validate_public_feedback_rate_limit_configuration() -> None:
    load_public_feedback_rate_limit_settings()


def _key(settings: PublicFeedbackRateLimitSettings, scope: str, value: str) -> str:
    digest = hmac.new(
        settings.secret.encode("utf-8"),
        f"{scope}:{value.strip().casefold()}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:40]
    return f"public:feedback:{scope}:{digest}"


async def _consume(redis_client, key: str, window_seconds: int) -> tuple[int, int]:
    try:
        result = await redis_client.eval(_CONSUME_SCRIPT, 1, key, str(window_seconds))
        count, ttl = int(result[0]), int(result[1])
    except Exception as exc:
        raise PublicFeedbackRateLimitUnavailable("意见提交保护服务暂不可用") from exc
    return count, ttl if ttl > 0 else window_seconds


async def consume_public_feedback_attempt(
    redis_client,
    *,
    share_token: str,
    remote_ip: str | None,
    settings: PublicFeedbackRateLimitSettings | None = None,
) -> None:
    settings = settings or load_public_feedback_rate_limit_settings()
    if not settings.enabled:
        return
    if redis_client is None:
        if settings.production:
            raise PublicFeedbackRateLimitUnavailable("意见提交保护服务暂不可用")
        return
    visitor_count, visitor_ttl = await _consume(
        redis_client,
        _key(settings, "visitor", f"{share_token}:{remote_ip or 'unknown'}"),
        settings.visitor_window_seconds,
    )
    share_count, share_ttl = await _consume(
        redis_client,
        _key(settings, "share", share_token),
        settings.share_window_seconds,
    )
    if visitor_count > settings.visitor_attempts or share_count > settings.share_attempts:
        raise PublicFeedbackRateLimited(max(visitor_ttl, share_ttl))

