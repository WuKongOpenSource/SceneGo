import base64
import io
import json
import logging
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from PIL import Image

from services import ai_proxy_doubao_image_service as generation
from services import api_provider_runtime as runtime
from services import file_service as storage
from services import provider_media_input_service as media
from services.ai_proxy_image_persistence_service import persist_generated_ai_images
from services.ai_proxy_types import AIProxyConfigError, AIProxyUpstreamError
from services.seedance_image_provenance import (
    PROVENANCE_KEY, SEEDREAM_PRO_MODEL, TRUST_SECONDS, PORTRAIT_VIDEO_MODELS,
    SeedanceInputProvenanceError, SeedreamImageBatch,
    is_official_ark_endpoint, verify_original,
)

ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3'
KEY = 'unit-test-only-key'


def png_bytes():
    output = io.BytesIO()
    Image.new('RGB', (1024, 1024), 'navy').save(output, format='PNG', compress_level=0)
    return output.getvalue()


def batch(content=b'original', **overrides):
    settings = dict(model=SEEDREAM_PRO_MODEL, endpoint=ENDPOINT, api_key=KEY,
                    reference_count=0, protected=True, created_at=int(time.time()))
    settings.update(overrides)
    return SeedreamImageBatch(['data:image/png;base64,' + base64.b64encode(content).decode()], **settings)


@pytest.fixture(autouse=True)
def no_external_requests(monkeypatch):
    import requests
    monkeypatch.setattr(requests.sessions.Session, 'request', Mock(side_effect=AssertionError('Network forbidden')))


@pytest.fixture
def providers(monkeypatch):
    config = SimpleNamespace(api_key=KEY, endpoint=ENDPOINT, model_name=SEEDREAM_PRO_MODEL)
    monkeypatch.setattr(generation, 'resolve_provider', lambda *args, **kwargs: config)
    monkeypatch.setattr(runtime, 'resolve_provider', lambda provider, model, **kwargs:
        SimpleNamespace(**{**vars(config), 'model_name': model}) if provider == 'seedance' else config)
    monkeypatch.setattr(runtime, 'resolve_seedance_model_name', lambda sub, **kwargs: PORTRAIT_VIDEO_MODELS[sub])
    return config


@pytest.mark.parametrize('endpoint', [
    'http://ark.cn-beijing.volces.com/api/v3',
    'https://ark.cn-beijing.volces.com.evil.invalid',
    'https://key@ark.cn-beijing.volces.com',
    'https://:password@ark.cn-beijing.volces.com',
    'https://ark.cn-beijing.volces.com:invalid',
])
def test_provenance_only_accepts_official_endpoint(endpoint):
    assert not is_official_ark_endpoint(endpoint)


def test_provenance_is_private_signed_and_expires_without_renewal():
    images = batch(created_at=1000)
    proof = images.original_metadata(b'original')[PROVENANCE_KEY]
    assert KEY not in json.dumps(proof)
    assert KEY not in json.dumps(images)
    verify_original(proof, b'original', api_key=KEY, endpoint=ENDPOINT, now=1001)
    verify_original(proof, b'original', api_key=KEY, endpoint=ENDPOINT, now=1000 + TRUST_SECONDS - 1)
    with pytest.raises(SeedanceInputProvenanceError, match='30 天'):
        verify_original(proof, b'original', api_key=KEY, endpoint=ENDPOINT, now=1000 + TRUST_SECONDS)


def test_distinct_plan_and_payg_keys_share_v2_provenance_by_account_binding(monkeypatch):
    monkeypatch.setenv('API_CONFIG_ENC_KEY', 'unit-test-signing-secret')
    images = batch(api_key='test-plan-key', account_binding='volc-account-1')
    proof = images.original_metadata(b'original')[PROVENANCE_KEY]

    assert proof['version'] == 2
    assert 'volc-account-1' not in json.dumps(proof)
    verify_original(
        proof,
        b'original',
        api_key='test-payg-key',
        endpoint=ENDPOINT,
        account_binding='volc-account-1',
    )
    with pytest.raises(SeedanceInputProvenanceError):
        verify_original(
            proof,
            b'original',
            api_key='test-payg-key',
            endpoint=ENDPOINT,
            account_binding='another-account',
        )


@pytest.mark.parametrize('change', ['model', 'generation_mode', 'created_at', 'sha256', 'signature'])
def test_cannot_relabel_or_extend_signed_provenance(change):
    proof = batch().original_metadata(b'original')[PROVENANCE_KEY]
    proof[change] = 'tampered'
    with pytest.raises(SeedanceInputProvenanceError):
        verify_original(proof, b'original', api_key=KEY, endpoint=ENDPOINT)


def test_non_ascii_signature_is_a_non_retryable_input_error():
    proof = batch().original_metadata(b'original')[PROVENANCE_KEY]
    proof['signature'] = '不' * 64
    with pytest.raises(SeedanceInputProvenanceError) as error:
        verify_original(proof, b'original', api_key=KEY, endpoint=ENDPOINT)
    assert runtime.seedance_error_is_non_retryable(error.value)


@pytest.mark.parametrize('change', ['key', 'bytes', 'image_to_image', 'third_party'])
def test_rejects_wrong_account_modified_bytes_and_ineligible_generation(change):
    images = batch(reference_count=1 if change == 'image_to_image' else 0,
                   endpoint='https://gateway.example.invalid' if change == 'third_party' else ENDPOINT)
    proof = images.original_metadata(b'original')[PROVENANCE_KEY]
    with pytest.raises(SeedanceInputProvenanceError):
        verify_original(proof, b'changed' if change == 'bytes' else b'original',
                        api_key='test-different-key' if change == 'key' else KEY, endpoint=ENDPOINT)


@pytest.mark.asyncio
@pytest.mark.parametrize('reason', ['reference', 'key', 'gateway', 'downgrade'])
async def test_preflight_rejects_before_paid_generation(monkeypatch, providers, reason):
    post = AsyncMock()
    monkeypatch.setattr(generation, '_post_doubao_image_generation', post)
    if reason == 'key':
        monkeypatch.setattr(runtime, 'resolve_provider', lambda *args, **kwargs: SimpleNamespace(api_key='test-other-key', endpoint=ENDPOINT))
    if reason == 'gateway':
        providers.endpoint = 'https://gateway.example.invalid/api/v3'
    if reason == 'downgrade':
        providers.model_name = 'doubao-seedream-5-0-lite-260128'
    with pytest.raises(AIProxyConfigError):
        await generation.generate_doubao_images(prompt='original storyboard', reference_inputs=['image'] if reason == 'reference' else [],
            size='2K', sequential='disabled', count=1, model=SEEDREAM_PRO_MODEL, seedance_portrait=True)
    post.assert_not_awaited()


@pytest.mark.asyncio
async def test_preflight_accepts_distinct_keys_with_same_account_binding(monkeypatch):
    monkeypatch.setenv('API_CONFIG_ENC_KEY', 'unit-test-signing-secret')
    image_config = SimpleNamespace(
        api_key='test-plan-key', endpoint=ENDPOINT, model_name=SEEDREAM_PRO_MODEL,
        extra={'account_binding': 'volc-account-1'},
    )
    video_config = SimpleNamespace(
        api_key='test-payg-key', endpoint=ENDPOINT, model_name=PORTRAIT_VIDEO_MODELS['standard'],
        extra={'account_binding': 'volc-account-1'},
    )
    monkeypatch.setattr(generation, 'resolve_provider', lambda *args, **kwargs: image_config)
    monkeypatch.setattr(runtime, 'resolve_provider', lambda *args, **kwargs: video_config)
    monkeypatch.setattr(runtime, 'resolve_seedance_model_name', lambda sub, **kwargs: PORTRAIT_VIDEO_MODELS[sub])
    post = AsyncMock(return_value=['data:image/png;base64,' + base64.b64encode(b'original').decode()])
    monkeypatch.setattr(generation, '_post_doubao_image_generation', post)

    images = await generation.generate_doubao_images(
        prompt='original storyboard', reference_inputs=[], size='2K',
        sequential='disabled', count=1, model=SEEDREAM_PRO_MODEL,
        usage_scope='workflow', seedance_portrait=True,
    )

    assert images._account_binding == 'volc-account-1'
    post.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize('reference_kind', ['id', 'url', 'download', 'storyboard'])
async def test_generate_persist_reload_and_submit_identical_original(monkeypatch, tmp_path, providers, reference_kind):
    import media_library_service
    content = png_bytes()
    assert len(content) > 800 * 1024
    post = AsyncMock(return_value=['data:image/png;base64,' + base64.b64encode(content).decode()])
    monkeypatch.setattr(generation, '_post_doubao_image_generation', post)
    images = await generation.generate_doubao_images(prompt='original storyboard', reference_inputs=[], size='2K',
        sequential='disabled', count=1, model=SEEDREAM_PRO_MODEL, usage_scope='workflow', seedance_portrait=True)
    assert post.await_args.kwargs['payload']['model'] == SEEDREAM_PRO_MODEL
    assert 'image' not in post.await_args.kwargs['payload']
    monkeypatch.setattr(storage, 'STORAGE_ROOT', tmp_path)
    created = {}

    async def create_file(**kwargs):
        created.update(kwargs)
        return kwargs

    monkeypatch.setattr(storage.ContentFileDAO, 'create_file', create_file)
    monkeypatch.setattr(media_library_service, 'create_from_file', AsyncMock())
    result = await persist_generated_ai_images(images, user_id='test-user', source='doubao', media_source='doubao',
        prompt='original storyboard', model=SEEDREAM_PRO_MODEL, entity_type=None, entity_id=None, file_role=None,
        episode_id=None, file_metadata={}, logger=logging.getLogger(__name__),
        save_generated_file_to_db=storage.save_generated_file_to_db, get_file_record=AsyncMock(return_value=None))
    assert result[0]['file_id'] == created['file_id']
    assert Path(created['file_path']).suffix == '.png'
    assert Path(created['file_path']).read_bytes() == content
    assert created['mime_type'] == 'image/png'
    assert created['metadata'][PROVENANCE_KEY]['model'] == SEEDREAM_PRO_MODEL
    created['metadata'] = json.dumps(created['metadata'])
    dao = SimpleNamespace(
        get_file=AsyncMock(side_effect=lambda value: created if value == created['file_id'] else None),
        get_file_by_name=AsyncMock(return_value=None),
        get_file_by_url=AsyncMock(side_effect=lambda value: created if value == created['file_url'] else None),
    )
    monkeypatch.setattr(media, 'resolve_allowed_media_file', lambda value, **kwargs: Path(value))
    from dao.creative.storyboard import StoryboardDAO
    monkeypatch.setattr(StoryboardDAO, 'get_by_id', AsyncMock(return_value={'generated_image_url': created['file_url']}))
    reference = {'id': created['file_id'], 'url': created['file_url'],
                 'download': '/api/files/' + created['file_id'] + '/download', 'storyboard': 'sb_test_original'}[reference_kind]
    result_uri = await media.seedance_image_reference_to_data_uri(reference, file_dao=dao)
    assert base64.b64decode(result_uri.split(',', 1)[1]) == content
    assert result_uri.startswith('data:image/png;base64,')
    providers.api_key = 'test-changed-video-key'
    with pytest.raises(SeedanceInputProvenanceError, match='API Key'):
        await media.seedance_image_reference_to_data_uri(reference, file_dao=dao)


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['exception', 'unregistered'])
async def test_protected_output_cannot_report_success_without_registration(failure):
    save = AsyncMock(side_effect=RuntimeError('storage offline')) if failure == 'exception' else AsyncMock(return_value={'file_id': None})
    with pytest.raises(AIProxyUpstreamError, match='保存或登记失败'):
        await persist_generated_ai_images(batch(), user_id='test-user', source='doubao', media_source='doubao',
            prompt='storyboard', model=SEEDREAM_PRO_MODEL, entity_type=None, entity_id=None, file_role=None,
            episode_id=None, file_metadata={}, logger=logging.getLogger(__name__), save_generated_file_to_db=save)


@pytest.mark.asyncio
async def test_legacy_image_is_byte_preserved_but_not_claimed_trusted():
    content = png_bytes()
    uri = 'data:image/png;base64,' + base64.b64encode(content).decode()
    assert await media.seedance_image_reference_to_data_uri(uri, file_dao=None) == uri


@pytest.mark.asyncio
@pytest.mark.parametrize('save_fails', [True, False])
async def test_route_completes_only_after_original_persistence(monkeypatch, save_fails):
    from fastapi import HTTPException
    from routers import ai_proxy
    from schemas.generation import DoubaoImageRequest

    router = ai_proxy.create_ai_proxy_router(require_auth_dependency=AsyncMock(), get_main_event_loop=lambda: None,
        get_redis_client=lambda: None, file_dao=Mock(), generation_access_checker=AsyncMock())
    endpoint = next(route.endpoint for route in router.routes if route.path == '/api/materials/doubao')
    events = []

    async def persist(*args, **kwargs):
        events.append('persist')
        if save_fails:
            raise AIProxyUpstreamError('original save failed', status_code=502)
        return [{'file_id': 'original-id', 'file_url': '/storage/original.png'}]

    async def complete(**kwargs):
        events.append('complete')

    generate = AsyncMock(return_value=batch())
    failed = AsyncMock()
    monkeypatch.setattr(ai_proxy, 'start_ai_proxy_task', AsyncMock(return_value='original-task'))
    monkeypatch.setattr(ai_proxy, 'proxy_generate_doubao_images', generate)
    monkeypatch.setattr(ai_proxy, 'persist_generated_ai_images', persist)
    monkeypatch.setattr(ai_proxy, 'complete_ai_proxy_image_task', complete)
    monkeypatch.setattr(ai_proxy, 'fail_ai_proxy_task', failed)
    request = DoubaoImageRequest(prompt='storyboard', model=SEEDREAM_PRO_MODEL, seedance_portrait=True)
    if save_fails:
        with pytest.raises(HTTPException) as error:
            await endpoint(request, username='test-user')
        assert error.value.status_code == 502
        assert events == ['persist']
        failed.assert_awaited_once()
    else:
        response = await endpoint(request, username='test-user')
        assert events == ['persist', 'complete']
        assert response['files'][0]['file_id'] == 'original-id'
        assert KEY not in json.dumps(response)
        failed.assert_not_awaited()
    assert generate.await_args.kwargs['seedance_portrait'] is True
