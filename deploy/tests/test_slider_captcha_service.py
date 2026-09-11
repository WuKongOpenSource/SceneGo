import asyncio
import base64
import io
import json
import secrets
from dataclasses import replace
from unittest.mock import AsyncMock

import fakeredis.aioredis
import pytest
from PIL import Image

from services import slider_captcha_service as service


@pytest.fixture
def context(monkeypatch):
    monkeypatch.setattr(service.time, 'time', lambda: 2000000000.0)
    return dict(redis_client=fakeredis.aioredis.FakeRedis(decode_responses=True), settings=service.CaptchaSettings(required=True, secret='test-secret-' * 4), session_id=secrets.token_urlsafe(32), remote_ip='192.0.2.1', action='sms_register')


async def challenge(context, monkeypatch):
    result = await service.create_challenge(**context)
    record = json.loads(await context['redis_client'].get('auth:captcha:challenge:' + result['challenge_id']))
    monkeypatch.setattr(service.time, 'time', lambda: record['issued_at'] + 1)
    return result, record['x']


async def proof(context, monkeypatch):
    result, x = await challenge(context, monkeypatch)
    return await service.check_challenge(**context, challenge_id=result['challenge_id'], x=x)


def verification_context(context):
    return {**{k: v for k, v in context.items() if k != 'action'}, 'expected_action': context['action']}


@pytest.mark.asyncio
async def test_images_are_local_and_answer_stays_server_side(context, monkeypatch):
    result, _ = await challenge(context, monkeypatch)
    assert 'x' not in result and 'binding' not in result and 'secret' not in result
    for key, size in [('background', (320, 160)), ('piece', (56, 56))]:
        image = Image.open(io.BytesIO(base64.b64decode(result[key].split(',')[1])))
        assert image.size == size
    assert await context['redis_client'].ttl('auth:captcha:challenge:' + result['challenge_id']) > 0


@pytest.mark.asyncio
async def test_proof_is_consumed_exactly_once_under_concurrency(context, monkeypatch):
    result = await proof(context, monkeypatch)
    outcomes = await asyncio.gather(*(service.verify_captcha(result['captcha_verification'], **verification_context(context)) for _ in range(8)), return_exceptions=True)
    assert sum(value is None for value in outcomes) == 1
    assert sum(isinstance(value, service.CaptchaInvalid) for value in outcomes) == 7


@pytest.mark.asyncio
@pytest.mark.parametrize('change', [{'session_id': 'A' * 43}, {'remote_ip': '192.0.2.2'}, {'expected_action': 'login'}])
async def test_proof_cannot_cross_session_ip_or_action(context, monkeypatch, change):
    result = await proof(context, monkeypatch)
    with pytest.raises(service.CaptchaInvalid):
        await service.verify_captcha(result['captcha_verification'], **{**verification_context(context), **change})
    await service.verify_captcha(result['captcha_verification'], **verification_context(context))


@pytest.mark.asyncio
async def test_incorrect_answer_burns_challenge(context, monkeypatch):
    result, x = await challenge(context, monkeypatch)
    with pytest.raises(service.CaptchaInvalid, match='未对齐'):
        await service.check_challenge(**context, challenge_id=result['challenge_id'], x=x + 15)
    with pytest.raises(service.CaptchaInvalid, match='过期或已使用'):
        await service.check_challenge(**context, challenge_id=result['challenge_id'], x=x)


@pytest.mark.asyncio
async def test_challenge_cannot_be_swapped_between_operations(context, monkeypatch):
    result, x = await challenge(context, monkeypatch)
    with pytest.raises(service.CaptchaInvalid):
        await service.check_challenge(**{**context, 'action': 'login'}, challenge_id=result['challenge_id'], x=x)
    await service.check_challenge(**context, challenge_id=result['challenge_id'], x=x)


@pytest.mark.asyncio
async def test_expired_challenge_and_proof_fail_closed(context, monkeypatch):
    result, x = await challenge(context, monkeypatch)
    await context['redis_client'].delete('auth:captcha:challenge:' + result['challenge_id'])
    with pytest.raises(service.CaptchaInvalid):
        await service.check_challenge(**context, challenge_id=result['challenge_id'], x=x)
    result = await proof(context, monkeypatch)
    await context['redis_client'].delete('auth:captcha:proof:' + result['captcha_verification'].split('.')[1])
    with pytest.raises(service.CaptchaInvalid):
        await service.verify_captcha(result['captcha_verification'], **verification_context(context))


@pytest.mark.asyncio
async def test_challenge_rate_limit_does_not_store_raw_ip(context):
    context['settings'] = replace(context['settings'], ip_limit=2)
    await service.create_challenge(**context)
    await service.create_challenge(**context)
    with pytest.raises(service.CaptchaRateLimited):
        await service.create_challenge(**context)
    assert all(context['remote_ip'] not in key for key in await context['redis_client'].keys('*'))


@pytest.mark.asyncio
async def test_unavailable_redis_and_forged_proof_are_not_success(context):
    with pytest.raises(service.CaptchaInvalid):
        await service.verify_captcha('slider.' + 'A' * 43, **verification_context(context))
    with pytest.raises(service.CaptchaUnavailable):
        await service.create_challenge(**{**context, 'redis_client': None})
    broken = AsyncMock()
    broken.eval.side_effect = RuntimeError('private error')
    with pytest.raises(service.CaptchaUnavailable, match='暂不可用'):
        await service.create_challenge(**{**context, 'redis_client': broken})


@pytest.mark.asyncio
@pytest.mark.parametrize('value', [None, '', 'true', 'slider.invalid', 'x' * 9000])
async def test_unverified_and_malformed_tokens_are_rejected(context, value):
    with pytest.raises(service.CaptchaInvalid):
        await service.verify_captcha(value, **verification_context(context))


@pytest.mark.asyncio
async def test_no_cookie_is_rejected(context):
    with pytest.raises(service.CaptchaInvalid):
        await service.create_challenge(**{**context, 'session_id': ''})


@pytest.mark.asyncio
async def test_old_and_impossibly_fast_answers_are_rejected(context, monkeypatch):
    result, x = await challenge(context, monkeypatch)
    monkeypatch.setattr(service.time, 'time', lambda: 2000000000.0)
    with pytest.raises(service.CaptchaInvalid):
        await service.check_challenge(**context, challenge_id=result['challenge_id'], x=x)
