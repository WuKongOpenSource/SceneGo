"""Creation-point onboarding and daily-login gift policy."""
from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, time
from zoneinfo import ZoneInfo

from dao_credit import CreationPointDAO


SHANGHAI = ZoneInfo("Asia/Shanghai")
logger = logging.getLogger(__name__)


def _bounded_env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        value = int(str(os.getenv(name, default)).strip())
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def daily_gift_policy(prior_streak: int) -> tuple[str, int, int, int]:
    """Return policy name, minimum, maximum, and configured streak threshold."""
    threshold = _bounded_env_int(
        "OSTORY_DAILY_GIFT_REDUCED_AFTER_DAYS",
        7,
        minimum=1,
        maximum=365,
    )
    standard_min = _bounded_env_int("OSTORY_DAILY_GIFT_MIN", 10, minimum=10, maximum=50)
    standard_max = _bounded_env_int("OSTORY_DAILY_GIFT_MAX", 50, minimum=standard_min, maximum=50)
    reduced_min = _bounded_env_int("OSTORY_DAILY_GIFT_REDUCED_MIN", 10, minimum=10, maximum=50)
    reduced_max = _bounded_env_int("OSTORY_DAILY_GIFT_REDUCED_MAX", 20, minimum=reduced_min, maximum=50)
    if prior_streak >= threshold:
        return "continuous_claim_reduced", reduced_min, reduced_max, threshold
    return "standard", standard_min, standard_max, threshold


def daily_gift_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    local_now = (now or datetime.now(SHANGHAI)).astimezone(SHANGHAI)
    expires_at = datetime.combine(local_now.date(), time(23, 59, 50), tzinfo=SHANGHAI)
    return local_now, expires_at


async def grant_daily_login_points(user_id: str, *, now: datetime | None = None) -> dict:
    local_now, expires_at = daily_gift_window(now)

    if local_now >= expires_at:
        account = await CreationPointDAO.expire_available_gifts('user', user_id)
        return {
            'granted': False,
            'amount': 0,
            'expires_at': expires_at.isoformat(),
            'account': account,
            'window_closed': True,
        }
    try:
        prior_streak = await CreationPointDAO.get_daily_grant_streak(
            user_id,
            before_date=local_now.date(),
        )
    except Exception:
        # Reward analytics must not block an otherwise valid login. The grant
        # write remains authoritative and idempotent in the database.
        logger.warning("Unable to read daily creation-point streak for user=%s", user_id, exc_info=True)
        prior_streak = 0
    policy, minimum, maximum, threshold = daily_gift_policy(prior_streak)
    amount = minimum + secrets.randbelow(maximum - minimum + 1)
    result = await CreationPointDAO.grant_daily_gift(
        user_id,
        grant_date=local_now.date(),
        amount=amount,
        expires_at=expires_at,
        grant_policy=policy,
    )
    result['expires_at'] = result['expires_at'].isoformat()
    result['policy'] = policy
    result['prior_streak'] = prior_streak
    result['reduced_after_days'] = threshold
    return result
