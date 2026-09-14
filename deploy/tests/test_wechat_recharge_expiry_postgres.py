"""Opt-in real locking tests against a disposable local PostgreSQL instance."""
import asyncio
from datetime import datetime, timedelta, timezone
import os
import uuid

import asyncpg
import pytest

from dao.business import wechat_recharge as dao
from utils.recharge_order_policy import RECHARGE_TIMEOUT_REASON

pytestmark = pytest.mark.skipif(not os.getenv('RECHARGE_TEST_PG_PORT'), reason='Disposable PostgreSQL not configured')
CUTOFF = datetime(2026, 1, 1, tzinfo=timezone.utc)


@pytest.fixture
async def pg(monkeypatch):
    schema = 'recharge_test_' + uuid.uuid4().hex
    params = dict(host='127.0.0.1', port=int(os.environ['RECHARGE_TEST_PG_PORT']), user='recharge_test', database='postgres')
    admin = await asyncpg.connect(**params)
    await admin.execute(f'CREATE SCHEMA {schema}')
    pool = None
    try:
        pool = await asyncpg.create_pool(**params, min_size=1, max_size=4, server_settings={'search_path': schema})
        await pool.execute('''
            CREATE TABLE wechat_creation_point_orders (
                payment_order_id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'u', out_trade_no TEXT UNIQUE,
                status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ,
                paid_at TIMESTAMPTZ, transaction_id TEXT UNIQUE, failure_reason TEXT, request_id TEXT,
                closed_at TIMESTAMPTZ, last_checked_at TIMESTAMPTZ, notify_event_id TEXT,
                point_amount INTEGER DEFAULT 102, base_amount_fen INTEGER DEFAULT 1020,
                discount_bps INTEGER DEFAULT 9800, amount_fen INTEGER DEFAULT 1000, currency TEXT DEFAULT 'CNY'
            );
            CREATE TABLE credit_accounts (account_id TEXT PRIMARY KEY, available_credits INTEGER,
                account_credits INTEGER, updated_at TIMESTAMPTZ);
            INSERT INTO credit_accounts VALUES ('account', 50, 50, CURRENT_TIMESTAMP);
            CREATE TABLE credit_transactions (transaction_id TEXT PRIMARY KEY, payment_order_id TEXT UNIQUE,
                account_id TEXT, user_id TEXT, change_type TEXT, amount INTEGER,
                balance_before INTEGER, balance_after INTEGER, metadata JSONB);
        ''')
        monkeypatch.setattr(dao, 'get_db_manager', lambda: pool)
        async def account(conn, *_args):
            return dict(await conn.fetchrow("SELECT * FROM credit_accounts WHERE account_id='account' FOR UPDATE"))
        async def expire(_conn, row):
            return row
        monkeypatch.setattr(dao, '_get_or_create_account_for_update', account)
        monkeypatch.setattr(dao.CreationPointDAO, '_expire_locked', expire)
        yield pool
    finally:
        if pool:
            await pool.close()
        # The schema name is generated here and never refers to application data.
        await admin.execute(f'DROP SCHEMA {schema} CASCADE')
        await admin.close()


async def add(pool, name, *, created_at=CUTOFF - timedelta(seconds=1), status='pending'):
    await pool.execute('INSERT INTO wechat_creation_point_orders(payment_order_id,out_trade_no,created_at,status) VALUES($1,$1,$2,$3)', name, created_at, status)


async def test_twelve_hour_boundary_existing_credit_and_terminal_states(pg):
    for name, when, status in [
        ('old', CUTOFF - timedelta(seconds=1), 'pending'), ('boundary', CUTOFF, 'pending'),
        ('young', CUTOFF + timedelta(milliseconds=1), 'pending'), ('qr-expired', CUTOFF, 'expired'),
        ('paid', CUTOFF, 'paid'), ('closed', CUTOFF, 'closed'), ('failed', CUTOFF, 'failed'),
        ('credited', CUTOFF, 'pending'), ('transaction', CUTOFF, 'pending'), ('paid-time', CUTOFF, 'pending'),
    ]:
        await add(pg, name, created_at=when, status=status)
    await pg.execute("INSERT INTO credit_transactions(transaction_id,payment_order_id) VALUES('credit','credited')")
    await pg.execute("UPDATE wechat_creation_point_orders SET transaction_id='tx' WHERE payment_order_id='transaction'")
    await pg.execute("UPDATE wechat_creation_point_orders SET paid_at=CURRENT_TIMESTAMP WHERE payment_order_id='paid-time'")
    assert await dao.WechatRechargeDAO.fail_overdue_orders(cutoff=CUTOFF) == 3
    assert await dao.WechatRechargeDAO.fail_overdue_orders(cutoff=CUTOFF) == 0
    expired = await pg.fetch('SELECT payment_order_id FROM wechat_creation_point_orders WHERE failure_reason=$1 ORDER BY payment_order_id', RECHARGE_TIMEOUT_REASON)
    assert [r['payment_order_id'] for r in expired] == ['boundary', 'old', 'qr-expired']
    assert await pg.fetchval("SELECT status FROM wechat_creation_point_orders WHERE payment_order_id='young'") == 'pending'
    assert await pg.fetchval('SELECT available_credits FROM credit_accounts') == 50


async def test_scoped_and_bounded_sweeps(pg):
    for name in ['one', 'two', 'other']:
        await add(pg, name)
    await pg.execute("UPDATE wechat_creation_point_orders SET user_id='other' WHERE payment_order_id='other'")
    assert await dao.WechatRechargeDAO.fail_overdue_orders(cutoff=CUTOFF, user_id='u', out_trade_no='other') == 0
    assert await dao.WechatRechargeDAO.fail_overdue_orders(cutoff=CUTOFF, user_id='u', limit=1) == 1
    assert await dao.WechatRechargeDAO.fail_overdue_orders(cutoff=CUTOFF, user_id='u', limit=1) == 1
    assert await pg.fetchval("SELECT status FROM wechat_creation_point_orders WHERE payment_order_id='other'") == 'pending'


async def test_locked_payment_is_skipped_and_revisited(pg):
    await add(pg, 'locked')
    async with pg.acquire() as conn:
        async with conn.transaction():
            await conn.fetchrow("SELECT * FROM wechat_creation_point_orders WHERE payment_order_id='locked' FOR UPDATE")
            assert await asyncio.wait_for(dao.WechatRechargeDAO.fail_overdue_orders(cutoff=CUTOFF), timeout=2) == 0
    assert await dao.WechatRechargeDAO.fail_overdue_orders(cutoff=CUTOFF) == 1


async def test_timeout_and_payment_race_settles_once_and_cannot_downgrade_paid(pg):
    await add(pg, 'race')
    async def settle():
        return await dao.WechatRechargeDAO.settle_order(out_trade_no='race', transaction_id='wx-tx',
            notify_event_id='event', paid_at=CUTOFF, validate_order=lambda order: None)
    await asyncio.gather(dao.WechatRechargeDAO.fail_overdue_orders(cutoff=CUTOFF), settle(), settle())
    await dao.WechatRechargeDAO.mark_order_failed('race', 'late create failure')
    current = await dao.WechatRechargeDAO.update_provider_state('u', 'race', status='closed', failure_reason='stale query', request_id=None)
    assert current['status'] == 'paid'
    assert await pg.fetchval('SELECT available_credits FROM credit_accounts') == 152
    assert await pg.fetchval('SELECT COUNT(*) FROM credit_transactions') == 1
    assert await dao.WechatRechargeDAO.fail_overdue_orders(cutoff=CUTOFF) == 0


async def test_payment_arriving_after_completed_timeout_credits_once(pg):
    await add(pg, 'late')
    assert await dao.WechatRechargeDAO.fail_overdue_orders(cutoff=CUTOFF) == 1
    for _ in range(2):
        result = await dao.WechatRechargeDAO.settle_order(out_trade_no='late', transaction_id='wx-late',
            notify_event_id='event', paid_at=CUTOFF, validate_order=lambda order: None)
        assert result['status'] == 'paid'
    assert await pg.fetchval('SELECT available_credits FROM credit_accounts') == 152
    assert await pg.fetchval('SELECT COUNT(*) FROM credit_transactions') == 1
