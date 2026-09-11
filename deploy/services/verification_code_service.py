"""Redis-backed one-time verification codes with platform-side idempotency guards."""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Awaitable, Callable


ALLOWED_PURPOSES = {"register", "login", "bind_phone", "password_reset", "email_verify"}


class VerificationCodeError(RuntimeError):
    pass


class VerificationRateLimited(VerificationCodeError):
    pass


class VerificationCodeInvalid(VerificationCodeError):
    pass


class VerificationConfigurationError(VerificationCodeError):
    pass


@dataclass(frozen=True)
class VerificationSettings:
    runtime_env: str
    secret: str
    ttl_seconds: int = 300
    resend_seconds: int = 60
    daily_limit: int = 10
    global_sms_daily_limit: int = 1000
    max_attempts: int = 5

    @property
    def development(self) -> bool:
        return self.runtime_env != "production"


def _int_env(name: str, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


def load_verification_settings() -> VerificationSettings:
    runtime = (os.getenv("OSTORY_RUNTIME_ENV") or "development").strip().lower()
    secret = (os.getenv("OSTORY_VERIFICATION_CODE_SECRET") or "").strip()
    if len(secret) < 32:
        if runtime == "production":
            raise VerificationConfigurationError(
                "OSTORY_VERIFICATION_CODE_SECRET must contain at least 32 characters"
            )
        development_seed = "ostory-development-verification-code-digest"
        secret = hashlib.sha256(development_seed.encode("utf-8")).hexdigest()
    return VerificationSettings(
        runtime_env=runtime,
        secret=secret,
        ttl_seconds=_int_env("OSTORY_SMS_CODE_TTL_SECONDS", 300, 60),
        resend_seconds=_int_env("OSTORY_SMS_RESEND_SECONDS", 60, 30),
        daily_limit=_int_env("OSTORY_SMS_DAILY_LIMIT", 10, 1),
        global_sms_daily_limit=_int_env("OSTORY_SMS_GLOBAL_DAILY_LIMIT", 1000, 1),
        max_attempts=_int_env("OSTORY_SMS_MAX_ATTEMPTS", 5, 1),
    )


class VerificationCodeManager:
    _VERIFY_SCRIPT = """
local expected = redis.call('HGET', KEYS[1], 'digest')
if not expected then return -1 end
if expected == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if attempts >= tonumber(ARGV[2]) then redis.call('DEL', KEYS[1]) end
return 0
"""

    def __init__(self, redis_client, settings: VerificationSettings | None = None):
        self.redis = redis_client
        self.settings = settings or load_verification_settings()

    def _target_hash(self, channel: str, target: str) -> str:
        return hmac.new(
            self.settings.secret.encode("utf-8"),
            f"target:{channel}:{target}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()[:32]

    def _digest(self, channel: str, target: str, purpose: str, code: str) -> str:
        return hmac.new(
            self.settings.secret.encode("utf-8"),
            f"code:{channel}:{target}:{purpose}:{code}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def _keys(self, channel: str, target: str, purpose: str) -> tuple[str, str, str]:
        target_hash = self._target_hash(channel, target)
        date_key = datetime.now(timezone.utc).strftime("%Y%m%d")
        return (
            f"auth:verify:{channel}:{purpose}:{target_hash}",
            f"auth:verify:cooldown:{channel}:{purpose}:{target_hash}",
            f"auth:verify:daily:{date_key}:{channel}:{target_hash}",
        )

    async def issue(
        self,
        *,
        channel: str,
        target: str,
        purpose: str,
        sender: Callable[[str, str, str], Awaitable[str | None]],
    ) -> dict:
        if purpose not in ALLOWED_PURPOSES:
            raise VerificationCodeError("unsupported verification purpose")
        code_key, cooldown_key, daily_key = self._keys(channel, target, purpose)
        acquired = await self.redis.set(cooldown_key, "1", ex=self.settings.resend_seconds, nx=True)
        if not acquired:
            raise VerificationRateLimited("verification code was sent recently")

        try:
            daily_count = int(await self.redis.incr(daily_key))
            if daily_count == 1:
                await self.redis.expire(daily_key, 172800)
            if daily_count > self.settings.daily_limit:
                raise VerificationRateLimited("daily verification limit exceeded")

            if channel == "sms":
                date_key = datetime.now(timezone.utc).strftime("%Y%m%d")
                global_daily_key = f"auth:verify:daily:{date_key}:sms:global"
                global_daily_count = int(await self.redis.incr(global_daily_key))
                if global_daily_count == 1:
                    await self.redis.expire(global_daily_key, 172800)
                if global_daily_count > self.settings.global_sms_daily_limit:
                    raise VerificationRateLimited("global SMS daily budget exceeded")

            code = "888888" if self.settings.development else f"{secrets.randbelow(1_000_000):06d}"
            provider_id = await sender(target, code, purpose)
            await self.redis.hset(
                code_key,
                mapping={"digest": self._digest(channel, target, purpose, code), "attempts": "0"},
            )
            await self.redis.expire(code_key, self.settings.ttl_seconds)
            return {
                "expires_in": self.settings.ttl_seconds,
                "resend_in": self.settings.resend_seconds,
                "provider_id": provider_id,
                "development_code": code if self.settings.development else None,
            }
        except Exception:
            await self.redis.delete(cooldown_key)
            raise

    async def verify(self, *, channel: str, target: str, purpose: str, code: str) -> None:
        if purpose not in ALLOWED_PURPOSES:
            raise VerificationCodeInvalid("unsupported verification purpose")
        code_key, _, _ = self._keys(channel, target, purpose)
        result = int(
            await self.redis.eval(
                self._VERIFY_SCRIPT,
                1,
                code_key,
                self._digest(channel, target, purpose, code.strip()),
                str(self.settings.max_attempts),
            )
        )
        if result != 1:
            raise VerificationCodeInvalid("verification code is invalid or expired")
