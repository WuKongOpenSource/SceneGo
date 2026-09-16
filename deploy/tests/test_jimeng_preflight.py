from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from services import jimeng_preflight_service as service


@pytest.fixture(autouse=True)
def authorized_admin(monkeypatch):
    monkeypatch.setattr(service, 'require_jimeng_admin', AsyncMock())


@pytest.mark.asyncio
@pytest.mark.parametrize('unavailable', [False, True])
async def test_role_denial_precedes_cli_media_and_metadata(monkeypatch, unavailable):
    from services.jimeng_access_service import JimengAccessDenied, ADMIN_ONLY_MESSAGE
    failure = RuntimeError('/private/db-error') if unavailable else JimengAccessDenied(ADMIN_ONLY_MESSAGE)
    monkeypatch.setattr(service, 'require_jimeng_admin', AsyncMock(side_effect=failure))
    load, inspect = Mock(), AsyncMock()
    monkeypatch.setattr(service, 'CliConfig', SimpleNamespace(load=load))
    monkeypatch.setattr(service, 'inspect_inputs', inspect)
    data = {'role': 'super_admin', 'is_admin': True}
    with pytest.raises(HTTPException) as exc:
        await service.preflight_jimeng('jimeng_multimodal', data, 'ordinary-user')
    assert exc.value.status_code == (503 if unavailable else 403)
    assert '/private' not in exc.value.detail
    load.assert_not_called()
    inspect.assert_not_awaited()
    assert data == {'role': 'super_admin', 'is_admin': True}


@pytest.mark.asyncio
async def test_server_replaces_forged_pricing_and_account_metadata(monkeypatch, tmp_path):
    from dao.business.jimeng_job import JimengJobDAO
    config = SimpleNamespace(account_id='123', session_id='456', state_id='persistent_state')
    monkeypatch.setattr(service, 'CliConfig', SimpleNamespace(load=lambda: config))
    monkeypatch.setattr(service, 'JimengCli', lambda _: SimpleNamespace(account_status=AsyncMock()))
    monkeypatch.setattr(JimengJobDAO, 'review_count', AsyncMock(return_value=0))
    monkeypatch.setattr(service, 'inspect_inputs', AsyncMock(return_value=[
        {'kind': 'image', 'file_id': 'file_original', 'sha256': 'abc', 'size': 200, 'path': '/private/source.png'},
        {'kind': 'video', 'file_id': 'file_video', 'duration_seconds': 7.2, 'sha256': 'def', 'size': 999, 'path': '/private/video.mp4'},
    ]))
    data = {'task_type': 'jimeng_multimodal', 'model': 'JimengSeedance2', 'duration': 5, 'prompt': 'test',
            'media_inputs': [{'kind': 'image', 'file_id': 'file_original'}],
            '_credit_billing': {'amount': 0, 'owner_id': 'victim'}, '_jimeng_binding': {'account_id': 'wrong'},
            'hh_resolution': '480P', 'vidu_resolution': '480P', 'sub_model_vidu': 'mini', 'duration_seconds': 1}
    await service.preflight_jimeng('jimeng_multimodal', data, 'owner')
    assert data['_jimeng_binding'] == {'account_id': '123', 'session_id': '456', 'state_id': 'persistent_state'}
    assert not any(k in data for k in ['_credit_billing', 'hh_resolution', 'vidu_resolution', 'sub_model_vidu', 'duration_seconds'])
    assert data['media_inputs'][1]['duration_seconds'] == 7.2
    assert 'path' not in data['_jimeng_input_trace'][0]


@pytest.mark.asyncio
async def test_other_providers_never_touch_cli_preflight(monkeypatch):
    load = Mock(side_effect=AssertionError('must not load'))
    monkeypatch.setattr(service, 'CliConfig', SimpleNamespace(load=load))
    await service.preflight_jimeng('seedance_multi', {}, 'owner')
    load.assert_not_called()
    service.require_jimeng_admin.assert_not_awaited()


@pytest.mark.asyncio
async def test_review_required_account_blocks_new_paid_submission(monkeypatch):
    from dao.business.jimeng_job import JimengJobDAO
    monkeypatch.setattr(service, 'CliConfig', SimpleNamespace(load=lambda: SimpleNamespace(account_id='123')))
    monkeypatch.setattr(service, 'JimengCli', lambda _: SimpleNamespace(account_status=AsyncMock()))
    monkeypatch.setattr(JimengJobDAO, 'review_count', AsyncMock(return_value=1))
    inspect = AsyncMock()
    monkeypatch.setattr(service, 'inspect_inputs', inspect)
    data = {'task_type': 'jimeng_multimodal', 'model': 'JimengSeedance2', 'prompt': 'test',
            'duration': 5, 'media_inputs': [{'kind': 'image', 'file_id': 'file_1'}]}
    with pytest.raises(HTTPException) as exc:
        await service.preflight_jimeng('jimeng_multimodal', data, 'owner')
    assert exc.value.status_code == 422 and '待核查' in exc.value.detail
    inspect.assert_not_awaited()
