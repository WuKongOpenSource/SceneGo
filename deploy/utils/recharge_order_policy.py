"""Shared identity for a reversible local payment timeout, not a provider rejection."""

RECHARGE_TIMEOUT_HOURS = 12
RECHARGE_TIMEOUT_REASON = '超过12小时未确认到账，订单自动标记为失败'
