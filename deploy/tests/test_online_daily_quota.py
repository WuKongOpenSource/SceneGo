"""Online daily policy matches the existing shared calendar and atomic limit."""
from datetime import datetime, timezone

from core.online_provider_queue import OnlineProviderQueue
from daily_quota_contract import DailyQuotaContract
from services.online_task_quota_service import online_daily_quota


class TestOnlineDailyQuota(DailyQuotaContract):
    queue_type = OnlineProviderQueue


def test_shanghai_midnight_uses_utc_database_bounds_and_one_hour_expiry_grace():
    before = online_daily_quota('minimax_i2v', now=datetime(2026, 1, 1, 15, 59, 59, tzinfo=timezone.utc))
    after = online_daily_quota('minimax_morph', now=datetime(2026, 1, 1, 16, 0, 0, tzinfo=timezone.utc))
    assert before.key.endswith(':2026-01-01')
    assert before.start_utc == datetime(2025, 12, 31, 16)
    assert before.end_utc == after.start_utc == datetime(2026, 1, 1, 16)
    assert before.ttl_seconds == 3601
    assert after.key.endswith(':2026-01-02')
    assert after.end_utc == datetime(2026, 1, 2, 16)
    assert after.ttl_seconds == 90000
    assert online_daily_quota('seedance_i2v') is None
