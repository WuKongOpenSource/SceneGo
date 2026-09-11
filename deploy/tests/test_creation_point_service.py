from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from services import creation_point_service as svc


SHANGHAI = ZoneInfo("Asia/Shanghai")


def test_daily_gift_expiry_is_fixed_at_235950_shanghai():
    now, expires = svc.daily_gift_window(datetime(2026, 8, 28, 9, 15, tzinfo=SHANGHAI))

    assert now.date() == expires.date()
    assert (expires.hour, expires.minute, expires.second) == (23, 59, 50)
    assert expires.tzinfo is not None


@pytest.mark.asyncio
async def test_after_daily_cutoff_does_not_grant(monkeypatch):
    calls = []

    async def expire(owner_type, owner_id):
        calls.append((owner_type, owner_id))
        return {"available_credits": 200, "gift_credits": 0}

    monkeypatch.setattr(svc.CreationPointDAO, "expire_available_gifts", expire)
    result = await svc.grant_daily_login_points(
        "user_1",
        now=datetime(2026, 8, 28, 23, 59, 55, tzinfo=SHANGHAI),
    )

    assert result["granted"] is False
    assert result["window_closed"] is True
    assert calls == [("user", "user_1")]


@pytest.mark.asyncio
async def test_daily_grant_is_between_10_and_50(monkeypatch):
    captured = {}

    async def streak(user_id, *, before_date):
        return 0

    async def grant(user_id, *, grant_date, amount, expires_at, grant_policy):
        captured.update(
            user_id=user_id,
            grant_date=grant_date,
            amount=amount,
            expires_at=expires_at,
            grant_policy=grant_policy,
        )
        return {"granted": True, "amount": amount, "expires_at": expires_at, "account": {}}

    monkeypatch.setattr(svc.CreationPointDAO, "get_daily_grant_streak", streak)
    monkeypatch.setattr(svc.CreationPointDAO, "grant_daily_gift", grant)
    result = await svc.grant_daily_login_points(
        "user_1",
        now=datetime(2026, 8, 28, 12, 0, tzinfo=SHANGHAI),
    )

    assert 10 <= captured["amount"] <= 50
    assert result["amount"] == captured["amount"]
    assert result["expires_at"].endswith("+08:00")
    assert captured["grant_policy"] == "standard"


@pytest.mark.asyncio
async def test_continuous_claim_streak_uses_reduced_10_to_20_range(monkeypatch):
    captured = {}

    async def streak(user_id, *, before_date):
        return 7

    async def grant(user_id, *, grant_date, amount, expires_at, grant_policy):
        captured.update(amount=amount, grant_policy=grant_policy)
        return {"granted": True, "amount": amount, "expires_at": expires_at, "account": {}}

    monkeypatch.setattr(svc.CreationPointDAO, "get_daily_grant_streak", streak)
    monkeypatch.setattr(svc.CreationPointDAO, "grant_daily_gift", grant)
    result = await svc.grant_daily_login_points(
        "user_1",
        now=datetime(2026, 8, 28, 12, 0, tzinfo=SHANGHAI),
    )

    assert 10 <= captured["amount"] <= 20
    assert captured["grant_policy"] == "continuous_claim_reduced"
    assert result["prior_streak"] == 7
    assert result["reduced_after_days"] == 7


def test_daily_gift_policy_is_configurable_and_bounded(monkeypatch):
    monkeypatch.setenv("OSTORY_DAILY_GIFT_REDUCED_AFTER_DAYS", "3")
    monkeypatch.setenv("OSTORY_DAILY_GIFT_REDUCED_MIN", "12")
    monkeypatch.setenv("OSTORY_DAILY_GIFT_REDUCED_MAX", "18")

    assert svc.daily_gift_policy(2) == ("standard", 10, 50, 3)
    assert svc.daily_gift_policy(3) == ("continuous_claim_reduced", 12, 18, 3)
