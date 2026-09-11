from __future__ import annotations

import pytest

from services import auth_rate_limit_service as rate_limit


class FakeRedis:
    def __init__(self):
        self.counts: dict[str, int] = {}
        self.ttls: dict[str, int] = {}
        self.keys_seen: list[str] = []

    async def eval(self, _script, _key_count, key, window):
        self.keys_seen.append(key)
        self.counts[key] = self.counts.get(key, 0) + 1
        self.ttls.setdefault(key, int(window))
        return [self.counts[key], self.ttls[key]]

    async def delete(self, key):
        self.counts.pop(key, None)
        self.ttls.pop(key, None)


def settings(*, production: bool = False, identity_attempts: int = 2, ip_attempts: int = 20):
    return rate_limit.AuthRateLimitSettings(
        runtime_env="production" if production else "test",
        enabled=True,
        secret="test-secret-that-is-longer-than-thirty-two-bytes",
        window_seconds=900,
        identity_attempts=identity_attempts,
        ip_attempts=ip_attempts,
    )


def test_production_requires_dedicated_rate_limit_secret(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    monkeypatch.delenv("OSTORY_AUTH_RATE_LIMIT_SECRET", raising=False)

    with pytest.raises(rate_limit.AuthRateLimitConfigurationError, match="32 characters"):
        rate_limit.load_auth_rate_limit_settings()


def test_production_cannot_disable_login_rate_limiting(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    monkeypatch.setenv("AUTH_LOGIN_RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("OSTORY_AUTH_RATE_LIMIT_SECRET", "x" * 40)

    with pytest.raises(rate_limit.AuthRateLimitConfigurationError, match="cannot be disabled"):
        rate_limit.load_auth_rate_limit_settings()


@pytest.mark.asyncio
async def test_attempt_keys_do_not_contain_identity_or_ip() -> None:
    redis = FakeRedis()

    await rate_limit.consume_login_attempt(
        redis,
        identity="Creator@Example.com",
        remote_ip="203.0.113.9",
        settings=settings(),
    )

    assert len(redis.keys_seen) == 2
    assert all("creator@example.com" not in key for key in redis.keys_seen)
    assert all("203.0.113.9" not in key for key in redis.keys_seen)


@pytest.mark.asyncio
async def test_identity_limit_returns_retry_after_and_success_can_clear_identity() -> None:
    redis = FakeRedis()
    configured = settings(identity_attempts=2)

    for _ in range(2):
        await rate_limit.consume_login_attempt(
            redis,
            identity="creator",
            remote_ip="203.0.113.9",
            settings=configured,
        )
    with pytest.raises(rate_limit.AuthRateLimited) as caught:
        await rate_limit.consume_login_attempt(
            redis,
            identity="creator",
            remote_ip="203.0.113.9",
            settings=configured,
        )

    assert caught.value.retry_after == 900
    await rate_limit.clear_login_identity(redis, identity="creator", settings=configured)
    await rate_limit.consume_login_attempt(
        redis,
        identity="creator",
        remote_ip="203.0.113.10",
        settings=configured,
    )


@pytest.mark.asyncio
async def test_production_fails_closed_without_redis() -> None:
    with pytest.raises(rate_limit.AuthRateLimitUnavailable, match="暂不可用"):
        await rate_limit.consume_login_attempt(
            None,
            identity="creator",
            remote_ip="203.0.113.9",
            settings=settings(production=True),
        )


@pytest.mark.asyncio
async def test_development_can_run_without_redis() -> None:
    await rate_limit.consume_login_attempt(
        None,
        identity="creator",
        remote_ip="127.0.0.1",
        settings=settings(production=False),
    )
