import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest

from services import wechat_recharge_service as service
from utils.recharge_order_policy import RECHARGE_TIMEOUT_REASON


async def test_expiry_uses_creation_age_of_twelve_hours_and_an_owned_order_filter(monkeypatch):
    sweep = AsyncMock(return_value=1)
    monkeypatch.setattr(service.WechatRechargeDAO, 'fail_overdue_orders', sweep)
    before = datetime.now(timezone.utc)
    assert await service.expire_overdue_recharge_orders(user_id='u', out_trade_no='CJ1') == 1
    after = datetime.now(timezone.utc)
    args = sweep.call_args.kwargs
    assert before - timedelta(hours=12) <= args['cutoff'] <= after - timedelta(hours=12)
    assert args['user_id'] == 'u' and args['out_trade_no'] == 'CJ1'


async def test_sweep_runs_without_browser_requests_and_retries_after_database_failure(monkeypatch):
    sweep = AsyncMock(side_effect=[RuntimeError('offline'), 1])
    wait = AsyncMock(side_effect=[None, asyncio.CancelledError])
    monkeypatch.setattr(service, 'expire_overdue_recharge_orders', sweep)
    monkeypatch.setattr(service.asyncio, 'sleep', wait)
    with pytest.raises(asyncio.CancelledError):
        await service.recharge_order_expiry_loop()
    assert sweep.await_count == 2
    assert [call.args for call in wait.call_args_list] == [(60,), (60,)]


async def test_admin_list_expires_orders_before_filtering_failed_rows(monkeypatch):
    events = []
    async def expire(**kwargs):
        events.append(('expire', kwargs))
    async def rows(**kwargs):
        events.append(('list', kwargs))
        return [{'status': 'failed', 'failure_reason': RECHARGE_TIMEOUT_REASON}]
    monkeypatch.setattr(service, 'expire_overdue_recharge_orders', expire)
    monkeypatch.setattr(service.WechatRechargeDAO, 'list_orders', rows)
    result = await service.list_recharge_orders(user_id='u', status='failed')
    assert [event[0] for event in events] == ['expire', 'list']
    assert result[0]['status'] == 'FAILED'
    assert result[0]['failure_reason'] == RECHARGE_TIMEOUT_REASON


async def test_timeout_does_not_block_active_reconciliation_of_a_real_payment(monkeypatch):
    now = datetime.now(timezone.utc)
    order = {'status': 'failed', 'failure_reason': RECHARGE_TIMEOUT_REASON,
             'created_at': now - timedelta(hours=13), 'last_checked_at': None}
    monkeypatch.setattr(service, 'expire_overdue_recharge_orders', AsyncMock())
    monkeypatch.setattr(service.WechatRechargeDAO, 'get_user_order', AsyncMock(return_value=order))
    config = object()
    payload = {'trade_state': 'SUCCESS', 'transaction_id': 'tx'}
    monkeypatch.setattr(service, 'read_wechat_pay_config', lambda: config)
    monkeypatch.setattr(service, 'query_native_order', AsyncMock(return_value=(payload, 'req')))
    settle = AsyncMock(return_value={'status': 'PAID'})
    monkeypatch.setattr(service, 'settle_recharge', settle)
    assert await service.get_recharge_order('u', 'CJ1') == {'status': 'PAID'}
    settle.assert_awaited_once_with(payload, config=config)
