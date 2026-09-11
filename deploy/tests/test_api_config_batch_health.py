import pytest

from services import api_config_service


@pytest.mark.asyncio
async def test_batch_health_uses_all_rows_for_effective_provider_sources(monkeypatch):
    all_rows = [
        {'config_id': 'config_1', 'provider': 'seedance', 'enabled': True, 'name': 'Plan'},
        {'config_id': 'config_2', 'provider': 'seedance', 'enabled': False, 'name': 'Paygo'},
    ]
    captured = {}

    async def list_all():
        return all_rows

    def build_sources(rows):
        captured['source_ids'] = [row['config_id'] for row in rows]
        return {'seedance': {'effective': {'config_id': 'config_1'}}}

    async def test_row(row, *, effective_sources=None):
        captured.setdefault('tested_ids', []).append(row['config_id'])
        assert effective_sources['seedance']['effective']['config_id'] == 'config_1'
        return {'test': {'ok': True}}

    monkeypatch.setattr(api_config_service.ApiConfigDAO, 'list_all', list_all)
    monkeypatch.setattr(api_config_service, 'build_effective_provider_config_sources', build_sources)
    monkeypatch.setattr(api_config_service, '_test_api_config_row_health', test_row)

    result = await api_config_service.test_all_saved_api_config_health(
        config_ids=['config_1'],
        enabled_only=True,
    )

    assert captured['source_ids'] == ['config_1', 'config_2']
    assert captured['tested_ids'] == ['config_1']
    assert result['summary'] == {
        'total': 1,
        'ok': 1,
        'no_key': 0,
        'auth_error': 0,
        'connectivity_ok': 0,
        'error': 0,
    }
