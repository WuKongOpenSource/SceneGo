import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

import fakeredis.aioredis
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from routers import auth, auth_legacy, phone_auth
from services import slider_captcha_service as slider


@pytest.mark.asyncio
@pytest.mark.parametrize('purpose', ['register', 'login', 'password_reset', 'bind_phone'])
async def test_sms_requires_browser_bound_single_use_proof(monkeypatch, purpose):
    monkeypatch.setenv('AUTH_CAPTCHA_REQUIRED', 'true')
    monkeypatch.setenv('AUTH_CAPTCHA_PROVIDER', 'slider')
    monkeypatch.setenv('OSTORY_RUNTIME_ENV', 'development')
    store = fakeredis.aioredis.FakeRedis(decode_responses=True)
    sender = AsyncMock(return_value='test-receipt')
    monkeypatch.setattr(phone_auth, 'build_sms_provider', lambda: SimpleNamespace(send_code=sender))
    monkeypatch.setattr(phone_auth, 'verify_binding_token', lambda _: 'test-user')
    user = None if purpose in ('register', 'bind_phone') else {'user_id': 'test-user'}
    dao = SimpleNamespace(get_user_by_phone=AsyncMock(return_value=user), get_user_auth_by_id=AsyncMock(return_value={'user_id': 'test-user'}))
    app = FastAPI()
    app.include_router(phone_auth.create_phone_auth_router(get_redis_client=lambda: store, create_session_token=lambda *_: '', require_auth_dependency=lambda: '', user_dao=dao, logger=logging.getLogger('captcha-test')))
    async with AsyncClient(transport=ASGITransport(app=app), base_url='https://tv.example.com') as client:
        data = {'phone': '13800000000', 'purpose': purpose, 'binding_token': 'test-binding'}
        denied = await client.post('/api/auth/sms-code', json=data)
        assert denied.status_code == 400 and sender.await_count == 0
        config = await client.get('/api/auth/captcha-config')
        assert config.json()['provider'] == 'slider'
        assert config.headers['cache-control'] == 'no-store'
        cookie = config.headers['set-cookie'].lower()
        assert 'httponly' in cookie and 'secure' in cookie and 'samesite=strict' in cookie
        response = await client.post('/api/auth/captcha/challenge', json={'action': 'sms_' + purpose})
        assert response.status_code == 200, response.text
        challenge_id = response.json()['challenge_id']
        assert 'x' not in response.json()
        record = json.loads(await store.get('auth:captcha:challenge:' + challenge_id))
        monkeypatch.setattr(slider.time, 'time', lambda: record['issued_at'] + 1)
        checked = await client.post('/api/auth/captcha/check', json={'action': 'sms_' + purpose, 'challenge_id': challenge_id, 'x': record['x']})
        assert checked.status_code == 200, checked.text
        data['captcha_verification'] = checked.json()['captcha_verification']
        accepted = await client.post('/api/auth/sms-code', json=data)
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()['sent'] is True and sender.await_count == 1
        replay = await client.post('/api/auth/sms-code', json=data)
        assert replay.status_code == 400 and sender.await_count == 1


@pytest.mark.asyncio
async def test_challenge_endpoint_requires_a_session_and_valid_action(monkeypatch):
    monkeypatch.setenv('AUTH_CAPTCHA_REQUIRED', 'true')
    monkeypatch.setenv('AUTH_CAPTCHA_PROVIDER', 'slider')
    store = fakeredis.aioredis.FakeRedis(decode_responses=True)
    app = FastAPI()
    app.include_router(phone_auth.create_phone_auth_router(get_redis_client=lambda: store, create_session_token=lambda *_: '', require_auth_dependency=lambda: '', user_dao=object(), logger=logging.getLogger('captcha-test')))
    async with AsyncClient(transport=ASGITransport(app=app), base_url='https://tv.example.com') as client:
        assert (await client.post('/api/auth/captcha/challenge', json={'action': 'login'})).status_code == 400
        await client.get('/api/auth/captcha-config')
        assert (await client.post('/api/auth/captcha/challenge', json={'action': 'unapproved'})).status_code == 422
        assert (await client.post('/api/auth/captcha/check', json={'action': 'login', 'challenge_id': 'A' * 43, 'x': -1})).status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize('endpoint', ['/api/login', '/api/auth/login', '/api/auth/phone/login'])
async def test_every_password_entry_consumes_the_browser_proof_before_password_lookup(monkeypatch, endpoint):
    monkeypatch.setenv('AUTH_CAPTCHA_REQUIRED', 'true')
    monkeypatch.setenv('AUTH_CAPTCHA_PROVIDER', 'slider')
    monkeypatch.setenv('OSTORY_RUNTIME_ENV', 'development')
    store = fakeredis.aioredis.FakeRedis(decode_responses=True)
    password_lookup = AsyncMock(return_value=None)
    phone_lookup = AsyncMock(side_effect=phone_auth.InvalidCredentials('test invalid credentials'))
    monkeypatch.setattr(auth, 'verify_database_credentials', password_lookup)
    monkeypatch.setattr(phone_auth, 'login_phone_password', phone_lookup)
    dao = SimpleNamespace(verify_password=password_lookup)
    app = FastAPI()
    app.include_router(phone_auth.create_phone_auth_router(get_redis_client=lambda: store, create_session_token=lambda *_: '', require_auth_dependency=lambda: '', user_dao=dao, logger=logging.getLogger('captcha-test')))
    app.include_router(auth.create_auth_router(get_redis_client=lambda: store, verify_credentials=lambda *_: False, create_session_token=lambda *_: '', logger=logging.getLogger('captcha-test')))
    app.include_router(auth_legacy.create_auth_legacy_router(get_redis_client=lambda: store, get_current_user_dependency=lambda: '', user_dao=dao, activity_log_dao=object(), create_session_token=lambda *_: ''))
    body = {'phone': '13800000000', 'method': 'password', 'password': 'test-password'} if endpoint.endswith('/phone/login') else {'username': 'test-user', 'password': 'test-password'}
    lookup = phone_lookup if endpoint.endswith('/phone/login') else password_lookup
    async with AsyncClient(transport=ASGITransport(app=app), base_url='https://tv.example.com') as client:
        assert (await client.post(endpoint, json=body)).status_code == 400
        lookup.assert_not_awaited()
        await client.get('/api/auth/captcha-config')
        response = await client.post('/api/auth/captcha/challenge', json={'action': 'login'})
        challenge_id = response.json()['challenge_id']
        record = json.loads(await store.get('auth:captcha:challenge:' + challenge_id))
        monkeypatch.setattr(slider.time, 'time', lambda: record['issued_at'] + 1)
        checked = await client.post('/api/auth/captcha/check', json={'action': 'login', 'challenge_id': challenge_id, 'x': record['x']})
        body['captcha_verification'] = checked.json()['captcha_verification']
        assert (await client.post(endpoint, json=body)).status_code == 401
        assert lookup.await_count == 1
        assert (await client.post(endpoint, json=body)).status_code == 400
        assert lookup.await_count == 1
