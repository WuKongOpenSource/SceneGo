from __future__ import annotations

import pytest

from services.public_feedback_rate_limit_service import (
    PublicFeedbackRateLimitConfigurationError,
    PublicFeedbackRateLimited,
    PublicFeedbackRateLimitSettings,
    PublicFeedbackRateLimitUnavailable,
    consume_public_feedback_attempt,
    load_public_feedback_rate_limit_settings,
)


class FakeRedis:
    def __init__(self):
        self.counts: dict[str, int] = {}

    async def eval(self, _script, _key_count, key, window):
        self.counts[key] = self.counts.get(key, 0) + 1
        return [self.counts[key], int(window)]


def settings() -> PublicFeedbackRateLimitSettings:
    return PublicFeedbackRateLimitSettings(
        production=True,
        enabled=True,
        secret="x" * 32,
        visitor_window_seconds=600,
        visitor_attempts=2,
        share_window_seconds=3600,
        share_attempts=10,
    )


@pytest.mark.asyncio
async def test_public_feedback_is_limited_without_storing_raw_ip_or_share_token() -> None:
    redis = FakeRedis()
    for _ in range(2):
        await consume_public_feedback_attempt(
            redis,
            share_token="secret-share-token",
            remote_ip="203.0.113.8",
            settings=settings(),
        )
    with pytest.raises(PublicFeedbackRateLimited):
        await consume_public_feedback_attempt(
            redis,
            share_token="secret-share-token",
            remote_ip="203.0.113.8",
            settings=settings(),
        )
    assert all("secret-share-token" not in key for key in redis.counts)
    assert all("203.0.113.8" not in key for key in redis.counts)


@pytest.mark.asyncio
async def test_production_feedback_protection_fails_closed_without_redis() -> None:
    with pytest.raises(PublicFeedbackRateLimitUnavailable):
        await consume_public_feedback_attempt(
            None,
            share_token="share",
            remote_ip="203.0.113.8",
            settings=settings(),
        )


def test_production_feedback_protection_requires_private_hmac_secret(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    monkeypatch.delenv("OSTORY_PUBLIC_RATE_LIMIT_SECRET", raising=False)
    monkeypatch.delenv("OSTORY_AUTH_RATE_LIMIT_SECRET", raising=False)
    with pytest.raises(PublicFeedbackRateLimitConfigurationError, match="32"):
        load_public_feedback_rate_limit_settings()
