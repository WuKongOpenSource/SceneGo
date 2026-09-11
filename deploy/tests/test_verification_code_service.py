import pytest

from services.verification_code_service import (
    VerificationCodeInvalid,
    VerificationCodeManager,
    VerificationRateLimited,
    VerificationSettings,
)


class FakeRedis:
    def __init__(self):
        self.values = {}
        self.hashes = {}

    async def set(self, key, value, *, ex=None, nx=False):
        if nx and key in self.values:
            return False
        self.values[key] = value
        return True

    async def incr(self, key):
        self.values[key] = int(self.values.get(key, 0)) + 1
        return self.values[key]

    async def expire(self, _key, _seconds):
        return True

    async def hset(self, key, *, mapping):
        self.hashes[key] = dict(mapping)
        return 1

    async def delete(self, key):
        self.values.pop(key, None)
        self.hashes.pop(key, None)
        return 1

    async def eval(self, _script, _count, key, digest, max_attempts):
        row = self.hashes.get(key)
        if not row:
            return -1
        if row["digest"] == digest:
            self.hashes.pop(key, None)
            return 1
        row["attempts"] = str(int(row["attempts"]) + 1)
        if int(row["attempts"]) >= int(max_attempts):
            self.hashes.pop(key, None)
        return 0


def settings(*, runtime_env="development", resend_seconds=60, max_attempts=2, global_sms_daily_limit=1000):
    return VerificationSettings(
        runtime_env=runtime_env,
        secret="x" * 32,
        ttl_seconds=300,
        resend_seconds=resend_seconds,
        daily_limit=10,
        global_sms_daily_limit=global_sms_daily_limit,
        max_attempts=max_attempts,
    )


@pytest.mark.asyncio
async def test_development_code_is_one_time_and_never_stored_in_plaintext():
    redis = FakeRedis()
    manager = VerificationCodeManager(redis, settings())
    sent = []

    async def sender(target, code, purpose):
        sent.append((target, code, purpose))
        return "provider-1"

    result = await manager.issue(channel="sms", target="13800138000", purpose="login", sender=sender)
    assert result["development_code"] == "888888"
    assert sent == [("13800138000", "888888", "login")]
    assert all("888888" not in str(value) for value in redis.hashes.values())

    await manager.verify(channel="sms", target="13800138000", purpose="login", code="888888")
    with pytest.raises(VerificationCodeInvalid):
        await manager.verify(channel="sms", target="13800138000", purpose="login", code="888888")


@pytest.mark.asyncio
async def test_resend_cooldown_blocks_duplicate_provider_charge():
    redis = FakeRedis()
    manager = VerificationCodeManager(redis, settings())
    calls = 0

    async def sender(_target, _code, _purpose):
        nonlocal calls
        calls += 1
        return "provider-1"

    await manager.issue(channel="sms", target="13800138000", purpose="register", sender=sender)
    with pytest.raises(VerificationRateLimited):
        await manager.issue(channel="sms", target="13800138000", purpose="register", sender=sender)
    assert calls == 1


@pytest.mark.asyncio
async def test_production_code_is_not_fixed(monkeypatch):
    redis = FakeRedis()
    manager = VerificationCodeManager(redis, settings(runtime_env="production"))
    sent = []

    async def sender(_target, code, _purpose):
        sent.append(code)
        return "provider-1"

    result = await manager.issue(channel="sms", target="13800138000", purpose="login", sender=sender)
    assert result["development_code"] is None
    assert sent[0] != "888888"
    assert len(sent[0]) == 6


@pytest.mark.asyncio
async def test_global_sms_budget_blocks_rotating_phone_numbers_before_provider_charge():
    redis = FakeRedis()
    manager = VerificationCodeManager(redis, settings(global_sms_daily_limit=1))
    calls = 0

    async def sender(_target, _code, _purpose):
        nonlocal calls
        calls += 1
        return "provider-1"

    await manager.issue(channel="sms", target="13800138000", purpose="register", sender=sender)
    with pytest.raises(VerificationRateLimited):
        await manager.issue(channel="sms", target="13900139000", purpose="register", sender=sender)

    assert calls == 1
