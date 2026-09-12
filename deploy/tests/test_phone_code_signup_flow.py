"""Exercise the real one-time-code manager through the public login routes."""
import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from routers import phone_auth
from services.verification_code_service import VerificationCodeManager
from services.sms_provider_service import SmsProviderError
from services.captcha_service import CaptchaInvalid
from test_phone_auth_service import FakeUserDAO
from test_phone_auth_router import Logger
from test_verification_code_service import FakeRedis, settings


@pytest.fixture
def flow(monkeypatch):
    redis, dao, delivered = FakeRedis(), FakeUserDAO(), []
    codes = VerificationCodeManager(redis,settings(runtime_env='production'))
    class Provider:
        async def send_code(self, phone, code, purpose):
            delivered.append((phone, code, purpose))
            return 'test-delivery'
    async def identity(user_id):
        row = next((u for u in dao.users.values() if u['user_id'] == user_id),None)
        return {**row, 'is_active':True, 'status':row.get('status','active'), 'session_version':1} if row else None
    dao.get_session_identity = identity
    captcha, grant, online = AsyncMock(), AsyncMock(return_value={'account':{}}), AsyncMock()
    monkeypatch.setattr(phone_auth,'VerificationCodeManager',lambda _:codes)
    monkeypatch.setattr(phone_auth,'build_sms_provider',Provider)
    monkeypatch.setattr(phone_auth,'verify_captcha',captcha)
    monkeypatch.setattr(phone_auth,'grant_daily_login_points',grant)
    app = FastAPI()
    app.include_router(phone_auth.create_phone_auth_router(get_redis_client=lambda:redis,
        create_session_token=lambda user_id,**kwargs: 'test-session:'+user_id,
        require_auth_dependency=lambda:'unused',user_dao=dao,logger=Logger(),mark_user_online=online))
    return app,dao,codes,redis,delivered,captcha,grant,online


async def send(client):
    return await client.post('/api/auth/sms-code',json={'phone':'13800138000','purpose':'login','captcha_verification':'test-proof'})


async def login(client,code):
    return await client.post('/api/auth/phone/login',json={'phone':'+86 138-0013-8000','method':'sms_code','code':code})


@pytest.mark.asyncio
async def test_unregistered_send_verify_register_and_cookie_session_are_one_flow(flow):
    app,dao,codes,redis,delivered,captcha,grant,online = flow
    async with AsyncClient(transport=ASGITransport(app=app),base_url='https://test') as client:
        sent = await send(client)
        assert sent.status_code == 200 and sent.json()['sent'] is True
        assert 'development_code' not in sent.json() and 'next_action' not in sent.json()
        assert not dao.created and delivered[0][2] == 'login'
        captcha.assert_awaited_once()
        assert captcha.await_args.kwargs['expected_action'] == 'sms_login'
        assert (await send(client)).status_code == 429 and len(delivered) == 1
        wrong = '000000' if delivered[0][1] != '000000' else '111111'
        rejected = await login(client,wrong)
        assert rejected.status_code == 400 and 'set-cookie' not in rejected.headers and not dao.created
        valid = await login(client,delivered[0][1])
        assert valid.status_code == 200 and valid.json()['session_mode'] == 'cookie'
        assert valid.json()['user_id'] == 'user_new' and len(dao.created) == 1
        assert 'httponly' in valid.headers['set-cookie'].lower()
        assert not {'token','password','password_hash'} & valid.json().keys()
        assert (await login(client,delivered[0][1])).status_code == 400
        grant.assert_awaited_once_with('user_new')
        online.assert_awaited_once_with('user_new')
        await redis.delete(codes._keys('sms','13800138000','login')[1])
        await send(client)
        returning = await login(client,delivered[-1][1])
        assert returning.status_code == 200 and returning.json()['user_id'] == 'user_new'
        assert len(dao.created) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('case',['expired','register_code','disabled','simultaneous'])
async def test_signup_keeps_code_purpose_expiry_account_and_replay_guards(flow,case):
    app,dao,codes,redis,delivered,_,grant,_ = flow
    async with AsyncClient(transport=ASGITransport(app=app),base_url='https://test') as client:
        await send(client)
        code = delivered[-1][1]
        if case == 'expired': redis.hashes.clear()
        if case == 'register_code':
            redis.hashes.clear()
            async def capture(_phone, other_code, _purpose): delivered.append(('',other_code,''))
            await codes.issue(channel='sms',target='13800138000',purpose='register',sender=capture)
            code = delivered[-1][1]
        if case == 'disabled': dao.users['13800138000'] = {'user_id':'blocked','status':'disabled'}
        if case == 'simultaneous':
            results = await asyncio.gather(login(client,code),login(client,code))
            assert sorted(r.status_code for r in results) == [200,400] and len(dao.created) == 1
            grant.assert_awaited_once()
        else:
            result = await login(client,code)
            assert result.status_code == (403 if case == 'disabled' else 400)
            assert 'set-cookie' not in result.headers and not dao.created
            grant.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('case',['captcha','delivery'])
async def test_failed_captcha_or_sms_delivery_never_creates_account_or_valid_code(flow,monkeypatch,case):
    app,dao,_codes,redis,delivered,captcha,grant,_ = flow
    if case == 'captcha': captcha.side_effect = CaptchaInvalid('failed')
    else: monkeypatch.setattr(phone_auth,'build_sms_provider',lambda: type('Provider',(),{'send_code':AsyncMock(side_effect=SmsProviderError('failed'))})())
    async with AsyncClient(transport=ASGITransport(app=app),base_url='https://test') as client:
        result = await send(client)
        assert result.status_code == (400 if case == 'captcha' else 503)
        assert not dao.created and not delivered and not redis.hashes
        grant.assert_not_awaited()
