from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest

from services import wechat_recharge_service as service
from services.wechat_pay_config import WechatPayConfig
from dao.business import wechat_recharge as recharge_dao
from utils.recharge_order_policy import RECHARGE_TIMEOUT_REASON


class FakeConnection:
    def __init__(self):
        self.order = {
            "payment_order_id": "pay_1",
            "user_id": "user_1",
            "out_trade_no": "CJ1",
            "point_amount": 102,
            "base_amount_fen": 1020,
            "discount_bps": 9800,
            "amount_fen": 1000,
            "currency": "CNY",
            "status": "pending",
            "code_url": "weixin://wxpay/test",
            "transaction_id": None,
            "notify_event_id": None,
            "failure_reason": None,
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=30),
            "paid_at": None,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }
        self.executed = []

    @asynccontextmanager
    async def transaction(self):
        yield

    async def execute(self, query, *args):
        self.executed.append((query, args))
        return "UPDATE 1"

    async def fetchrow(self, query, *args):
        if "SELECT * FROM wechat_creation_point_orders" in query:
            return dict(self.order)
        if "UPDATE wechat_creation_point_orders" in query:
            self.order.update(
                status="paid",
                transaction_id=args[1],
                notify_event_id=args[2],
                paid_at=args[3],
                failure_reason=None,
            )
            return dict(self.order)
        raise AssertionError(query)


class FakeDB:
    def __init__(self, conn):
        self.conn = conn

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


def config():
    return WechatPayConfig(
        enabled=True,
        app_id="wx_app",
        merchant_id="mch_1",
        merchant_serial_no="serial",
        merchant_private_key_path="key.pem",
        api_v3_key_path="api.key",
        public_key_id="pub",
        public_key_path="pub.pem",
        notify_url="https://app.example.test/api/payments/wechat/notify",
        order_expire_minutes=30,
        max_point_amount=1_000_000,
    )


def transaction():
    return {
        "appid": "wx_app",
        "mchid": "mch_1",
        "out_trade_no": "CJ1",
        "transaction_id": "wx_tx_1",
        "trade_state": "SUCCESS",
        "success_time": "2026-08-28T10:00:00+08:00",
        "amount": {"total": 1000, "currency": "CNY"},
    }


@pytest.mark.asyncio
@pytest.mark.parametrize('initial_status', ['pending', 'expired', 'failed'])
async def test_settlement_credits_permanent_points_exactly_once(monkeypatch, initial_status):
    conn = FakeConnection()
    conn.order['status'] = initial_status
    if initial_status == 'failed':
        conn.order['failure_reason'] = RECHARGE_TIMEOUT_REASON
    monkeypatch.setattr(recharge_dao, "get_db_manager", lambda: FakeDB(conn))

    async def account_for_update(_conn, _owner_type, _owner_id):
        return {
            "account_id": "acct_1",
            "available_credits": 50,
            "account_credits": 50,
            "gift_credits": 0,
        }

    async def expire_locked(_conn, account):
        return account

    monkeypatch.setattr(recharge_dao, "_get_or_create_account_for_update", account_for_update)
    monkeypatch.setattr(recharge_dao.CreationPointDAO, "_expire_locked", expire_locked)

    first = await service.settle_recharge(transaction(), notify_event_id="event_1", config=config())
    second = await service.settle_recharge(transaction(), notify_event_id="event_1", config=config())

    assert first["status"] == "PAID"
    assert second["status"] == "PAID"
    point_updates = [query for query, _args in conn.executed if "UPDATE credit_accounts" in query]
    ledger_inserts = [query for query, _args in conn.executed if "INSERT INTO credit_transactions" in query]
    assert len(point_updates) == 1
    assert len(ledger_inserts) == 1


@pytest.mark.asyncio
async def test_settlement_rejects_amount_mismatch_before_credit(monkeypatch):
    conn = FakeConnection()
    monkeypatch.setattr(recharge_dao, "get_db_manager", lambda: FakeDB(conn))
    payload = transaction()
    payload["amount"] = {"total": 999, "currency": "CNY"}

    with pytest.raises(service.WechatRechargeError, match="不一致"):
        await service.settle_recharge(payload, config=config())

    assert conn.executed == []


@pytest.mark.asyncio
@pytest.mark.parametrize('status,reason', [('failed', 'provider rejection'), ('closed', None)])
async def test_real_rejection_and_closed_orders_cannot_be_reopened(monkeypatch, status, reason):
    conn = FakeConnection()
    conn.order.update(status=status, failure_reason=reason)
    monkeypatch.setattr(recharge_dao, 'get_db_manager', lambda: FakeDB(conn))
    with pytest.raises(service.WechatRechargeError, match='不允许确认支付'):
        await service.settle_recharge(transaction(), config=config())
    assert conn.executed == []
