from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import jimeng_account_service as service


@pytest.fixture(autouse=True)
def model_access(monkeypatch):
    monkeypatch.setattr(service, 'require_user_model_access', AsyncMock())


@pytest.mark.asyncio
async def test_public_capabilities_never_expose_account_or_private_state(monkeypatch):
    monkeypatch.setattr(service, 'require_jimeng_admin', AsyncMock())
    monkeypatch.setattr(service, 'account_status', AsyncMock(return_value={
        'available': True, 'message': 'ready', 'account_id': '12345', 'session_id': '7654321',
        'provider_credits': 99, 'private_state': '/private/fixture'}))
    result = await service.attach_capability({'models': [{'key': 'Seedance2'}, {'key': 'Seedance2Mini'}]}, user_id='verified-admin')
    assert [m['key'] for m in result['models']] == ['Seedance2', 'JimengSeedance2', 'Seedance2Mini']
    assert '12345' not in str(result) and '7654321' not in str(result) and '/private/fixture' not in str(result)
    assert result['models'][1]['available'] is True
    service.require_jimeng_admin.assert_awaited_once_with('verified-admin')


@pytest.mark.asyncio
async def test_capabilities_do_not_reuse_admin_access_for_next_user(monkeypatch):
    from services.jimeng_access_service import JimengAccessDenied, ADMIN_ONLY_MESSAGE
    check = AsyncMock(side_effect=[None, JimengAccessDenied(ADMIN_ONLY_MESSAGE), RuntimeError('private-error')])
    monkeypatch.setattr(service, 'require_jimeng_admin', check)
    status = AsyncMock(return_value={'available': True, 'message': 'ready'})
    monkeypatch.setattr(service, 'account_status', status)
    base = {'models': [{'key': 'Seedance2', 'available': True}]}
    admin = await service.attach_capability(base, user_id='admin-id')
    normal = await service.attach_capability(base, user_id='ordinary-id')
    unknown = await service.attach_capability(base, user_id='unknown-id')
    assert admin['models'][1]['available'] is True
    assert normal['models'] == base['models']
    assert unknown['models'] == base['models'] and 'private-error' not in str(unknown)
    assert normal['models'][0] == base['models'][0]
    assert len(base['models']) == 1
    status.assert_awaited_once()


@pytest.mark.asyncio
async def test_missing_identity_never_probes_provider(monkeypatch):
    status = AsyncMock()
    monkeypatch.setattr(service, 'account_status', status)
    result = await service.attach_capability({'models': []})
    assert result['models'] == []
    status.assert_not_awaited()


@pytest.mark.asyncio
async def test_admin_disabled_hint_is_generic_and_model_restrictions_hide_option(monkeypatch):
    monkeypatch.setattr(service, 'require_jimeng_admin', AsyncMock())
    status = AsyncMock(return_value={'available': False, 'message': 'private authorization detail'})
    monkeypatch.setattr(service, 'account_status', status)
    result = await service.attach_capability({'models': []}, user_id='admin')
    assert result['models'][0]['unavailable_reason'] == '未启用'
    assert 'private authorization' not in str(result)
    service.require_user_model_access.side_effect = RuntimeError('access unavailable')
    status.reset_mock()
    assert (await service.attach_capability({'models': result['models']}, user_id='admin'))['models'] == []
    status.assert_not_awaited()


@pytest.mark.asyncio
async def test_uncertain_submission_disables_new_generations(monkeypatch):
    from dao.business.jimeng_job import JimengJobDAO
    config = SimpleNamespace(account_id='12345', session_id='7654321', state_id='independent_state', sha256='hash')
    monkeypatch.setattr(service.CliConfig, 'load', lambda: config)
    monkeypatch.setattr(service, 'JimengCli', lambda _: SimpleNamespace(account_status=AsyncMock(return_value={
        'authorized': True, 'account_id': config.account_id, 'session_id': config.session_id, 'provider_credits': 99})))
    monkeypatch.setattr(JimengJobDAO, 'review_count', AsyncMock(return_value=1))
    monkeypatch.setattr(service, '_cache', (0, None, {}))
    result = await service.account_status(refresh=True)
    assert result['authorized'] and not result['available'] and result['review_required_count'] == 1


def test_account_route_requires_super_admin_and_anonymous_never_runs_cli(monkeypatch):
    from routers import admin_jimeng
    from services.admin_access_service import require_super_admin_session
    app = FastAPI()
    app.include_router(admin_jimeng.router)
    status = AsyncMock(return_value={'available': False, 'message': 'not configured'})
    monkeypatch.setattr(admin_jimeng, 'account_status', status)
    with TestClient(app) as client:
        assert client.get('/api/admin/jimeng/status').status_code == 401
        status.assert_not_awaited()
        app.dependency_overrides[require_super_admin_session] = lambda: 'verified-super-admin'
        result = client.get('/api/admin/jimeng/status')
        assert result.status_code == 200 and result.json()['execution_model'] == 'seedance2.0mini'
    status.assert_awaited_once_with(refresh=True)
