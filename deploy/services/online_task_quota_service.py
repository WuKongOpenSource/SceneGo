"""One daily online-provider policy for both application compositions."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException


@dataclass(frozen=True)
class DailyQuotaWindow:
    key: str
    start_utc: datetime
    end_utc: datetime
    ttl_seconds: int


def online_daily_quota(task_type: str, *, now: datetime | None = None) -> DailyQuotaWindow | None:
    """Keep the platform-wide three-submission policy on Shanghai calendar days."""
    if task_type not in {"minimax_i2v", "minimax_morph"}:
        return None
    shanghai_tz = ZoneInfo("Asia/Shanghai")
    now_shanghai = datetime.now(shanghai_tz) if now is None else now.astimezone(shanghai_tz)
    day_start = now_shanghai.replace(hour=0, minute=0, second=0, microsecond=0)
    next_day = day_start + timedelta(days=1)
    return DailyQuotaWindow(
        key=f"ostory:quota:minimax_hailuo_23:{day_start.date().isoformat()}",
        start_utc=day_start.astimezone(timezone.utc).replace(tzinfo=None),
        end_utc=next_day.astimezone(timezone.utc).replace(tzinfo=None),
        ttl_seconds=int((next_day - now_shanghai).total_seconds()) + 3600,
    )


async def load_online_quota_seeds(window: DailyQuotaWindow, *, task_dao: Any) -> list[str]:
    """Read persistence before owning a reservation or attempting rollback."""
    return await task_dao.get_task_ids_created_between(
        ["minimax_i2v", "minimax_morph"], window.start_utc, window.end_utc, limit=10,
    )


async def reserve_online_daily_quota(queue: Any, window: DailyQuotaWindow, task_id: str, seed_ids: list[str]) -> None:
    """Reserve atomically before billing, retaining the existing rejection."""
    if not await queue.reserve_daily_quota(window.key, task_id, seed_ids, limit=3, ttl_seconds=window.ttl_seconds):
        raise HTTPException(
            status_code=429,
            detail={"code": "minimax_hailuo_daily_limit", "message": "今日已达限额"},
        )
