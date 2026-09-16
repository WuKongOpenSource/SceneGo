from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from services import jimeng_access_service as service


@pytest.mark.asyncio
@pytest.mark.parametrize('role', ['admin', 'super_admin', 'user', 'creator', 'operator', '', None])
async def test_authoritative_role_not_username_controls_access(monkeypatch, role):
    lookup = AsyncMock(return_value={'user_id': 'user-123', 'username': 'admin',
        'role': role, 'is_active': True, 'status': 'active'})
    monkeypatch.setattr(service.UserDAO, 'get_session_identity', lookup)
    if role in ('admin', 'super_admin'):
        await service.require_jimeng_admin('user-123')
    else:
        with pytest.raises(service.JimengAccessDenied):
            await service.require_jimeng_admin('user-123')
    lookup.assert_awaited_once_with('user-123')


@pytest.mark.asyncio
@pytest.mark.parametrize('identity', [None,
    {'role': 'admin', 'is_active': False, 'status': 'active'},
    {'role': 'super_admin', 'is_active': True, 'status': 'suspended'},
])
async def test_inactive_or_missing_admin_is_denied(monkeypatch, identity):
    monkeypatch.setattr(service.UserDAO, 'get_session_identity', AsyncMock(return_value=identity))
    with pytest.raises(service.JimengAccessDenied):
        await service.require_jimeng_admin('user-123')


def test_capability_routes_use_authenticated_identity_and_disable_shared_cache(monkeypatch):
    # The source edition deliberately has no hosted cluster capability runtime.
    from routers import public_video_capabilities as route
    service_name = 'get_public_video_capabilities'
    probe = AsyncMock(return_value={'models': []})
    monkeypatch.setattr(route, service_name, probe)
    identity = {'user_id': None}

    async def auth():
        if not identity['user_id']:
            raise HTTPException(status_code=401)
        return identity['user_id']

    app = FastAPI()
    app.include_router(route.create_public_video_capabilities_router(require_auth_dependency=auth))
    with TestClient(app) as client:
        assert client.get('/api/video/capabilities').status_code == 401
        probe.assert_not_awaited()
        identity['user_id'] = 'session-user'
        response = client.get('/api/video/capabilities?scope=canvas&user_id=admin')
        assert response.status_code == 200
        assert response.headers['cache-control'] == 'private, no-store'
    probe.assert_awaited_once_with('canvas', user_id='session-user')
