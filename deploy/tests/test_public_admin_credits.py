"""Admin billing routes must retain real authorization, ledgers and audit data."""
import json
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
import asyncpg

from dao_credit import CreditAccountDAO, CreditRuleDAO
from services import credit_service
from backend_test_database import load_test_database_config
from test_public_account_isolation import accounts  # noqa: F401


OPERATIONS = [
    ('GET', '/credit-rules'), ('POST', '/credit-rules'),
    ('PUT', '/credit-rules/{rule_id}'), ('DELETE', '/credit-rules/{rule_id}'),
    ('GET', '/credit-accounts'), ('POST', '/credit-accounts/{user_id}/adjust'),
    ('GET', '/credit-transactions'), ('GET', '/wechat-recharge-orders'),
]
RULE = {'feature_key': 'test_admin_billing', 'feature_name': 'Test billing', 'base_cost': 5,
        'min_cost': 1, 'max_cost': 20, 'rule_version': 'test-v1'}


async def _role(accounts, role):
    await accounts.db.execute('UPDATE users SET role=$2 WHERE user_id=$1', accounts.owner.user_id, role)


def test_public_admin_billing_registers_all_operations_once():
    from fastapi.routing import iter_route_contexts
    import public_main

    actual = [(method, route.path) for route in iter_route_contexts(public_main.app.routes)
              for method in (getattr(route, 'methods', None) or [])]
    for method, suffix in OPERATIONS:
        assert actual.count((method, '/api/admin' + suffix)) == 1


@pytest.mark.parametrize('role', ['anonymous', 'user'])
async def test_admin_billing_rejects_unprivileged_accounts_without_writes(accounts, role):
    client = accounts.anonymous if role == 'anonymous' else accounts.owner.client
    for method, suffix in OPERATIONS:
        path = '/api/admin' + suffix.replace('{rule_id}', 'missing-rule').replace('{user_id}', accounts.other.user_id)
        response = await client.request(method, path, json=RULE if 'credit-rules' in suffix else {'delta': 5})
        assert response.status_code == (401 if role == 'anonymous' else 403), (path, response.text)
    assert await accounts.db.fetchval('SELECT COUNT(*) FROM credit_transactions') == 0
    assert await accounts.db.fetchval('SELECT COUNT(*) FROM credit_rules WHERE feature_key=$1', RULE['feature_key']) == 0


@pytest.mark.parametrize('method,suffix', [('POST', '/credit-rules'), ('PUT', '/credit-rules/missing'),
                                        ('DELETE', '/credit-rules/missing')])
async def test_admin_cannot_change_platform_billing_policy(accounts, method, suffix):
    await _role(accounts, 'admin')
    response = await accounts.owner.client.request(method, '/api/admin' + suffix, json=RULE)
    assert response.status_code == 403


async def test_super_admin_rule_crud_drives_estimates_and_keeps_stable_audit_identity(accounts):
    await _role(accounts, 'super_admin')
    response = await accounts.owner.client.post('/api/admin/credit-rules', json=RULE)
    assert response.status_code == 201, response.text
    rule_id = response.json()['rule']['rule_id']
    assert (await credit_service.estimate(RULE['feature_key'], {}))['estimated_cost'] == 5
    changed = await accounts.owner.client.put('/api/admin/credit-rules/' + rule_id,
                                              json={'base_cost': 9, 'max_cost': None})
    assert changed.status_code == 200, changed.text
    assert changed.json()['rule']['max_cost'] is None
    assert (await credit_service.estimate(RULE['feature_key'], {}))['estimated_cost'] == 9
    rows = (await accounts.owner.client.get('/api/admin/credit-rules')).json()['rules']
    assert any(row['rule_id'] == rule_id and row['base_cost'] == 9 for row in rows)
    assert (await accounts.owner.client.delete('/api/admin/credit-rules/' + rule_id)).status_code == 200
    assert await CreditRuleDAO.get(rule_id) is None
    audits = await accounts.db.fetch(
        'SELECT admin_user_id, action, before_data, after_data FROM admin_audit_logs WHERE target_id=$1 ORDER BY id',
        rule_id,
    )
    assert [row['action'] for row in audits] == ['credit_rule_create', 'credit_rule_update', 'credit_rule_delete']
    assert all(row['admin_user_id'] == accounts.owner.user_id for row in audits)
    before = audits[1]['before_data']
    before = json.loads(before) if isinstance(before, str) else before
    assert before['base_cost'] == 5


@pytest.mark.parametrize('role', ['admin', 'super_admin'])
async def test_admin_adjustments_preserve_reserved_points_and_audit_ledger(accounts, role):
    await _role(accounts, role)
    path = '/api/admin/credit-accounts/' + accounts.other.user_id + '/adjust'
    credited = await accounts.owner.client.post(path, json={'delta': 50, 'reason': 'Approved test credit'})
    assert credited.status_code == 200, credited.text
    assert credited.json()['balance_after'] == 50
    await credit_service.freeze('user', accounts.other.user_id, feature_key='test-reserve', amount=20, task_id='billing-frozen')
    rejected = await accounts.owner.client.post(path, json={'delta': -31, 'reason': 'Cannot spend a reservation'})
    assert rejected.status_code == 400
    debited = await accounts.owner.client.post(path, json={'delta': -10, 'reason': 'Approved test debit'})
    assert debited.status_code == 200 and debited.json()['balance_after'] == 20
    account = await CreditAccountDAO.get_or_create('user', accounts.other.user_id)
    assert (account['available_credits'], account['frozen_credits'], account['account_credits']) == (20, 20, 20)
    rows = (await accounts.owner.client.get('/api/admin/credit-accounts',
            params={'search': accounts.other.username})).json()['accounts']
    assert len(rows) == 1 and rows[0]['account_id'] == account['account_id']
    entries = (await accounts.owner.client.get('/api/admin/credit-transactions', params={
        'user_id': accounts.other.user_id, 'operated_by': accounts.owner.user_id,
    })).json()['transactions']
    assert {row['change_type'] for row in entries} == {'admin_credit', 'admin_debit'} and len(entries) == 2
    assert {row['operation_reason'] for row in entries} == {'Approved test credit', 'Approved test debit'}
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM admin_audit_logs WHERE action='credit_adjust'") == 2


async def test_adjusting_unknown_user_does_not_create_orphan_account(accounts):
    await _role(accounts, 'admin')
    response = await accounts.owner.client.post('/api/admin/credit-accounts/missing-user/adjust', json={'delta': 10})
    assert response.status_code == 404
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM credit_accounts WHERE owner_id='missing-user'") == 0


@pytest.mark.parametrize('body', [{'delta': 0}, {'delta': True}, {'delta': 1.5}, {'delta': 2147483648}])
async def test_invalid_adjustments_cannot_change_balance(accounts, body):
    await _role(accounts, 'admin')
    response = await accounts.owner.client.post('/api/admin/credit-accounts/' + accounts.other.user_id + '/adjust', json=body)
    assert response.status_code == 422
    assert await accounts.db.fetchval('SELECT COUNT(*) FROM credit_transactions') == 0


@pytest.mark.parametrize('patch', [{'base_cost': -1}, {'min_cost': 21}, {'feature_key': ' '},
                                  {'enabled': None}, {'rule_version': None}, {'rule_version': ' '}])
async def test_invalid_rule_update_preserves_original_policy(accounts, patch):
    await _role(accounts, 'super_admin')
    created = (await accounts.owner.client.post('/api/admin/credit-rules', json=RULE)).json()['rule']
    response = await accounts.owner.client.put('/api/admin/credit-rules/' + created['rule_id'], json=patch)
    assert response.status_code == 422
    saved = await CreditRuleDAO.get(created['rule_id'])
    assert saved['base_cost'] == 5 and saved['min_cost'] == 1 and saved['enabled'] is True
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM admin_audit_logs WHERE action='credit_rule_update'") == 0


async def test_billing_storage_error_is_not_exposed_or_audited_as_success(accounts, monkeypatch):
    await _role(accounts, 'admin')
    from routers import admin_credits
    monkeypatch.setattr(admin_credits.credit_service, 'admin_adjust',
                        AsyncMock(side_effect=RuntimeError('password=private-ledger-key')))
    response = await accounts.owner.client.post('/api/admin/credit-accounts/' + accounts.other.user_id + '/adjust',
                                                 json={'delta': 10, 'reason': 'Failure probe'})
    assert response.status_code == 500 and 'private-ledger-key' not in response.text
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM admin_audit_logs WHERE action='credit_adjust'") == 0


async def test_rule_noop_and_repeated_delete_do_not_add_success_audit(accounts):
    await _role(accounts, 'super_admin')
    created = (await accounts.owner.client.post('/api/admin/credit-rules', json=RULE)).json()['rule']
    path = '/api/admin/credit-rules/' + created['rule_id']
    assert (await accounts.owner.client.put(path, json={})).status_code == 200
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM admin_audit_logs WHERE action='credit_rule_update'") == 0
    assert (await accounts.owner.client.delete(path)).status_code == 200
    assert (await accounts.owner.client.delete(path)).status_code == 200
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM admin_audit_logs WHERE action='credit_rule_delete'") == 1
    assert (await accounts.owner.client.put(path, json={'base_cost': 3})).status_code == 404


async def test_recharge_order_filters_read_persisted_state_without_calling_payment_provider(accounts, monkeypatch):
    from dao.business.wechat_recharge import WechatRechargeDAO
    from services import wechat_recharge_service

    await _role(accounts, 'admin')
    provider = AsyncMock(side_effect=AssertionError('Order browsing must not query a payment provider'))
    monkeypatch.setattr(wechat_recharge_service, 'get_recharge_order', provider)
    for index, account in enumerate((accounts.owner, accounts.other, accounts.other)):
        await WechatRechargeDAO.create_order(
            payment_order_id=f'payment-admin-{index}', user_id=account.user_id,
            out_trade_no=f'TESTADMIN{index}', point_amount=50, base_amount_fen=100,
            discount_bps=10000, amount_fen=100,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        )
    await WechatRechargeDAO.mark_order_failed('payment-admin-1', 'Test-only failure')
    response = await accounts.owner.client.get('/api/admin/wechat-recharge-orders', params={
        'user_id': accounts.other.user_id, 'status': 'FAILED', 'out_trade_no': 'ADMIN1',
    })
    assert response.status_code == 200, response.text
    rows = response.json()['orders']
    assert len(rows) == 1 and rows[0]['out_trade_no'] == 'TESTADMIN1'
    assert rows[0]['status'] == 'FAILED' and isinstance(rows[0]['expires_at'], str)
    assert rows[0]['username'] == accounts.other.username
    assert (await accounts.owner.client.get('/api/admin/wechat-recharge-orders',
            params={'user_id': accounts.other.user_id, 'status': 'PENDING'})).json()['orders'][0]['out_trade_no'] == 'TESTADMIN2'
    assert (await accounts.owner.client.get('/api/admin/wechat-recharge-orders', params={'offset': 3})).json()['orders'] == []
    provider.assert_not_called()
    assert await accounts.db.fetchval('SELECT COUNT(*) FROM credit_transactions') == 0


@pytest.mark.parametrize('suffix', ['/credit-accounts', '/credit-transactions', '/wechat-recharge-orders'])
async def test_admin_billing_rejects_unbounded_pagination(accounts, suffix):
    await _role(accounts, 'admin')
    for params in ({'limit': 0}, {'limit': 501}, {'offset': -1}):
        response = await accounts.owner.client.get('/api/admin' + suffix, params=params)
        assert response.status_code == 422


@pytest.mark.parametrize('suffix', ['/credit-accounts', '/credit-transactions', '/wechat-recharge-orders'])
async def test_admin_billing_accepts_existing_frontend_page_size(accounts, suffix):
    await _role(accounts, 'admin')
    response = await accounts.owner.client.get('/api/admin' + suffix, params={'limit': 300})
    assert response.status_code == 200, response.text


async def test_existing_session_loses_billing_privilege_when_role_is_revoked(accounts):
    await _role(accounts, 'super_admin')
    assert (await accounts.owner.client.get('/api/admin/credit-rules')).status_code == 200
    await _role(accounts, 'user')
    for method, suffix in OPERATIONS:
        path = '/api/admin' + suffix.replace('{rule_id}', 'missing').replace('{user_id}', accounts.other.user_id)
        response = await accounts.owner.client.request(method, path, json=RULE if 'rules' in suffix else {'delta': 5})
        assert response.status_code == 403
    assert await accounts.db.fetchval('SELECT COUNT(*) FROM credit_transactions') == 0


async def test_billing_audit_keeps_actor_when_login_name_matches_another_user_id(accounts):
    await _role(accounts, 'admin')
    await accounts.db.execute('UPDATE users SET username=$2 WHERE user_id=$1',
                               accounts.owner.user_id, accounts.other.user_id)
    response = await accounts.owner.client.post('/api/admin/credit-accounts/' + accounts.other.user_id + '/adjust',
                                                 json={'delta': 5, 'reason': 'Identity collision fixture'})
    assert response.status_code == 200, response.text
    assert await accounts.db.fetchval("SELECT operated_by FROM credit_transactions WHERE change_type='admin_credit'") == accounts.owner.user_id
    assert await accounts.db.fetchval("SELECT admin_user_id FROM admin_audit_logs WHERE action='credit_adjust'") == accounts.owner.user_id


async def test_rule_updates_and_deletion_preserve_existing_reservation_quote(accounts):
    await _role(accounts, 'super_admin')
    created = (await accounts.owner.client.post('/api/admin/credit-rules', json=RULE)).json()['rule']
    funded = await accounts.owner.client.post('/api/admin/credit-accounts/' + accounts.other.user_id + '/adjust',
                                               json={'delta': 50, 'reason': 'Reservation fixture'})
    assert funded.status_code == 200
    quote = await credit_service.estimate(RULE['feature_key'], {})
    await credit_service.freeze('user', accounts.other.user_id, feature_key=RULE['feature_key'],
                                amount=quote['estimated_cost'], task_id='rule-price-reservation',
                                rule_version=quote['rule_version'])
    path = '/api/admin/credit-rules/' + created['rule_id']
    assert (await accounts.owner.client.put(path, json={'base_cost': 9, 'rule_version': 'test-v2'})).status_code == 200
    assert (await credit_service.estimate(RULE['feature_key'], {}))['estimated_cost'] == 9
    assert (await accounts.owner.client.delete(path)).status_code == 200
    freeze = await accounts.db.fetchrow('SELECT amount, rule_version, status FROM credit_freezes WHERE task_id=$1',
                                        'rule-price-reservation')
    assert dict(freeze) == {'amount': 5, 'rule_version': 'test-v1', 'status': 'frozen'}
    account = await CreditAccountDAO.get_or_create('user', accounts.other.user_id)
    assert account['available_credits'] == 45 and account['frozen_credits'] == 5


async def test_concurrent_rule_patches_validate_the_latest_locked_bounds(monkeypatch):
    """Separate committed connections reproduce the race a fixture savepoint cannot."""
    from dao.business import credit

    config = load_test_database_config()
    if config is None:
        pytest.skip('A dedicated loopback PostgreSQL test database is required')
    rule_id = 'rule_concurrency_' + uuid.uuid4().hex[:16]
    pool = await asyncpg.create_pool(min_size=1, max_size=4, **config.connection_kwargs())
    monkeypatch.setattr(credit, 'get_db_manager', lambda: pool)
    tasks = []
    try:
        await CreditRuleDAO.create(**{**RULE, 'rule_id': rule_id})

        def patch(fields):
            def validate(before):
                merged = {**before, **fields}
                if merged['min_cost'] > merged['max_cost']:
                    raise ValueError('Inverted rule bounds')
                return fields
            return validate

        async with pool.acquire() as blocker:
            async with blocker.transaction():
                await blocker.fetchrow('SELECT rule_id FROM credit_rules WHERE rule_id=$1 FOR UPDATE', rule_id)
                tasks = [asyncio.create_task(CreditRuleDAO.update_validated(rule_id, patch(fields)))
                         for fields in ({'min_cost': 15}, {'max_cost': 10})]
                # Both updates must be waiting at the same row before releasing
                # it. This prevents a scheduler's accidental serial execution
                # from concealing validation against a stale pre-lock snapshot.
                async with asyncio.timeout(5):
                    while True:
                        await blocker.execute('SELECT pg_stat_clear_snapshot()')
                        waiting = await blocker.fetchval(
                            "SELECT COUNT(*) FROM pg_stat_activity WHERE datname=current_database() "
                            "AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%credit_rules%'",
                        )
                        if waiting >= 2:
                            break
                        await asyncio.sleep(0.02)
        results = await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), 5)
        assert sum(isinstance(result, ValueError) for result in results) == 1, results
        assert sum(isinstance(result, tuple) for result in results) == 1, results
        saved = await CreditRuleDAO.get(rule_id)
        assert saved['min_cost'] <= saved['max_cost']
        assert (saved['min_cost'], saved['max_cost']) in {(15, 20), (1, 10)}
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        try:
            await pool.execute('DELETE FROM credit_rules WHERE rule_id=$1', rule_id)
        finally:
            await pool.close()
