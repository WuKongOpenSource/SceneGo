import base64
import io
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from PIL import Image
from schemas.generation import DoubaoImageRequest
from services import seedance_portrait_reference_service as policy
from services import seedance_image_provenance as provenance
from services import api_provider_runtime as runtime
from services import ai_proxy_doubao_image_service as generation
from services.ai_proxy_types import AIProxyError

MODEL = 'doubao-seedream-5-0-lite-260128'
VIDEO = 'doubao-seedance-2-0-260128'
ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3'
KEY = 'test-key-not-a-credential'


@pytest.fixture
def context(monkeypatch):
    import requests
    monkeypatch.setattr(requests.sessions.Session, 'request', Mock(side_effect=AssertionError('No paid network calls')))
    output = io.BytesIO()
    Image.new('RGB', (8, 8), 'blue').save(output, format='PNG')
    content = output.getvalue()
    def metadata(purpose, **overrides):
        settings = dict(model=MODEL, endpoint=ENDPOINT, api_key=KEY, reference_count=0,
                        protected=True, created_at=int(time.time()), model_verified=True, purpose=purpose)
        settings.update(overrides)
        return provenance.SeedreamImageBatch([], **settings).original_metadata(content)
    rows = {
        'file_character': {'file_id': 'file_character', 'metadata': metadata('character_four_view')},
        'file_background': {'file_id': 'file_background', 'metadata': metadata('pure_background')},
    }
    dao = SimpleNamespace(get_file=AsyncMock(side_effect=lambda key: rows.get(key)))
    monkeypatch.setattr(policy, 'require_generation_request_access', AsyncMock())
    monkeypatch.setattr(policy, '_require_current_model_access', AsyncMock())
    monkeypatch.setattr(policy, '_read_local_record', lambda *a, **kw: content)
    monkeypatch.setattr(policy, 'resolve_media_file_record', AsyncMock(side_effect=lambda url, dao: rows.get(url)))
    config = SimpleNamespace(api_key=KEY, endpoint=ENDPOINT, model_name=VIDEO, extra={})
    monkeypatch.setattr(runtime, 'resolve_seedance_model_name', lambda *a, **kw: VIDEO)
    monkeypatch.setattr(runtime, 'resolve_provider', lambda provider, *a, **kw: config)
    data = dict(sub_model='standard', reference_mode='reference', portrait_reference_mode='character_background',
        media_inputs=[dict(kind='image', file_id=key, url=key) for key in rows])
    return SimpleNamespace(content=content, rows=rows, dao=dao, data=data, metadata=metadata, config=config)


@pytest.mark.asyncio
async def test_preserves_original_bytes_and_checks_permissions_twice(context):
    c = context
    assert await policy.validate_portrait_references('seedance_multi', c.data, 'user', file_dao=c.dao) == {}
    actual = await policy.validate_portrait_references('seedance_multi', c.data, 'user', file_dao=c.dao, prepare=True)
    assert len(actual) == 2
    assert all(base64.b64decode(value.split(',')[1]) == c.content for value in actual.values())
    assert policy.require_generation_request_access.await_count == 2
    assert policy._require_current_model_access.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('bad', ['i2i', 'old', 'unknown_model', 'purpose_tamper', 'expired', 'sha', 'account', 'permission', 'missing', 'url', 'base64', 'fast', 'first_last', 'video', 'one_purpose', 'model_redirect'])
async def test_rejects_invalid_references(context, monkeypatch, bad):
    c = context
    row = c.rows['file_character']
    if bad == 'i2i':
        # Genuinely signed I2I metadata, not merely a broken signature.
        row['metadata'] = c.metadata(None, reference_count=1)
        signed = row['metadata'][provenance.PROVENANCE_KEY]
        signed['purpose'] = 'character_four_view'
        signed['signature'] = provenance._signature({k: v for k, v in signed.items() if k != 'signature'}, KEY)
    elif bad == 'old': row['metadata'] = c.metadata(None)
    elif bad == 'unknown_model': row['metadata'] = c.metadata(None, model_verified=False)
    elif bad == 'purpose_tamper': row['metadata'][provenance.PROVENANCE_KEY]['purpose'] = 'pure_background'
    elif bad == 'expired': row['metadata'] = c.metadata('character_four_view', created_at=int(time.time()) - provenance.TRUST_SECONDS)
    elif bad == 'sha': monkeypatch.setattr(policy, '_read_local_record', lambda *a, **kw: b'changed')
    elif bad == 'account': c.config.api_key = 'another-test-key'
    elif bad == 'permission': policy.require_generation_request_access.side_effect = policy.GenerationAccessDenied()
    elif bad == 'missing': del c.rows['file_character']
    elif bad == 'url': c.data['media_inputs'][0]['url'] = 'file_background'
    elif bad == 'base64': c.data['media_inputs'][0].pop('file_id')
    elif bad == 'fast': c.data['sub_model'] = 'fast'
    elif bad == 'first_last': c.data['media_inputs'][0]['role'] = 'first_frame'
    elif bad == 'video': c.data['media_inputs'].append(dict(kind='video', url='video.mp4'))
    elif bad == 'one_purpose': row['metadata'] = c.metadata('pure_background')
    elif bad == 'model_redirect': c.config.model_name = 'doubao-seedance-1.5-pro'
    with pytest.raises(provenance.SeedanceInputProvenanceError):
        await policy.validate_portrait_references('seedance_multi', c.data, 'user', file_dao=c.dao, prepare=True)


@pytest.mark.parametrize('changes', [{'references': ['ref']}, {'reference_metadata': [{'name': 'ref'}]}, {'count': 2}, {'sequential': 'auto'}])
def test_schema_rejects_any_reference_or_batch(changes):
    with pytest.raises(ValueError):
        DoubaoImageRequest(prompt='test', reference_purpose='character_four_view', **changes)


@pytest.mark.parametrize('reference_count', [0, 1, 2])
def test_only_signed_actual_t2i_has_label(context, reference_count):
    metadata = context.metadata(None, reference_count=reference_count)
    label = provenance.verified_text_to_image_source(metadata)
    assert bool(label) is (reference_count == 0)
    if label: assert label['label'] == 'Seedream 5.0 Lite · 文生图'


def test_unknown_mode_and_unknown_reference_count_never_label(context):
    for changes in ({'generation_mode': None}, {'reference_count': None}, {'reference_count': False}, {'model_verified': False}):
        proof = context.metadata(None)[provenance.PROVENANCE_KEY]
        proof.update(changes)
        proof['signature'] = provenance._signature({k: v for k, v in proof.items() if k != 'signature'}, KEY)
        assert provenance.verified_text_to_image_source({provenance.PROVENANCE_KEY: proof}) == {}


@pytest.mark.parametrize('count, label', [(0, '文生图'), (1, '图生图'), (2, '图生图')])
def test_material_picker_distinguishes_signed_generation_modes(context, count, label):
    metadata = context.metadata(None, reference_count=count)
    assert provenance.image_generation_source(metadata)['mode_label'] == label
    if count:
        assert provenance.verified_text_to_image_source(metadata) == {}


@pytest.mark.parametrize('metadata, expected', [
    ({'source': 'gemini', 'reference_snapshot': []}, '文生图'),
    ({'source': 'doubao', 'reference_snapshot': [{'file_id': 'ref'}]}, '图生图'),
    ({'source': 'gpt', 'ref_count': 1, 'reference_snapshot': []}, None),
    ({'source': 'uploaded', 'reference_snapshot': []}, None),
    ({'source': 'doubao', 'prompt': '纯文字生成'}, None),
    ({'source': 'gemini', 'reference_snapshot': [], 'seedance_provenance': {}}, None),
])
def test_material_labels_need_explicit_server_history(metadata, expected):
    assert provenance.image_generation_source(metadata).get('mode_label') == expected


@pytest.mark.parametrize('source,model,refs,label', [
    ('doubao', MODEL, [], 'Seedream 5.0 Lite · 文生图'),
    ('doubao', MODEL, [{}], 'Seedream 5.0 Lite · 图生图'),
    ('gemini', 'gemini-3.1-flash-image-preview', [{}], 'Gemini 3.1-flash-image Preview · 图生图'),
    ('gpt-image-official', 'gpt-image-2', [], 'GPT Image 2 · 文生图'),
    ('gpt-image-vip', 'gpt-image-2-vip', [{}], 'GPT Image 2 VIP · 图生图'),
])
def test_model_and_mode_display_is_provider_aware(source, model, refs, label):
    result = provenance.image_generation_source({'source': source, 'model': model, 'reference_snapshot': refs})
    assert result['display_label'] == label


def test_source_labels_never_echo_a_server_path_or_invent_a_mode():
    assert provenance.image_generation_source({'source': 'gemini', 'model': '/private/service/image'}) == {}
    assert provenance.image_generation_source({'source': 'gemini', 'model': 'gemini-3.1'})['display_label'] == 'Gemini 3.1 · 方式待确认'


@pytest.mark.asyncio
@pytest.mark.parametrize('returned_model', [MODEL, '', 'unknown-model'])
async def test_generation_requires_actual_model_and_no_paid_fallback(context, monkeypatch, returned_model):
    config = SimpleNamespace(api_key=KEY, endpoint=ENDPOINT, model_name=MODEL)
    monkeypatch.setattr(generation, 'resolve_provider', lambda provider, *a, **kw: config if provider == 'doubao' else context.config)
    response = generation.ReturnedImageList(['data:image/png;base64,' + base64.b64encode(context.content).decode()], {'model': returned_model})
    post = AsyncMock(return_value=response)
    monkeypatch.setattr(generation, '_post_doubao_image_generation', post)
    args = dict(prompt='人物', reference_inputs=[], size='2K', sequential='disabled', count=1,
                model=MODEL, reference_purpose='character_four_view')
    if returned_model == MODEL:
        result = await generation.generate_doubao_images(**args)
        assert result.original_metadata(context.content)[provenance.PROVENANCE_KEY]['purpose'] == 'character_four_view'
    else:
        with pytest.raises(AIProxyError): await generation.generate_doubao_images(**args)
    post.assert_awaited_once()
    payload = post.call_args.kwargs['payload']
    assert 'image' not in payload
    assert '四视图' in payload['prompt']


@pytest.mark.asyncio
async def test_ordinary_tasks_not_changed():
    assert await policy.validate_portrait_references('seedance_i2v', {}, '') == {}


@pytest.mark.asyncio
async def test_reference_star_checks_original_and_current_scope_without_generation(context, monkeypatch):
    c = context
    result = await policy.portrait_reference_badge(c.rows['file_character'])
    assert result['portrait_reference_scopes'] == ['workflow', 'studio']
    assert result['portrait_reference_expires_at'] > time.time()
    monkeypatch.setattr(runtime, 'resolve_provider', lambda *a, usage_scope=None, **kw:
        c.config if usage_scope == 'workflow' else SimpleNamespace(api_key='test-other-key', endpoint=ENDPOINT, model_name=VIDEO))
    assert (await policy.portrait_reference_badge(c.rows['file_character']))['portrait_reference_scopes'] == ['workflow']


@pytest.mark.asyncio
@pytest.mark.parametrize('bad', ['i2i', 'upload', 'unsigned', 'unknown', 'expired', 'sha', 'missing', 'unprotected', 'account', 'redirect'])
async def test_reference_star_fails_closed(context, monkeypatch, bad):
    c = context
    row = c.rows['file_character']
    if bad == 'i2i': row['metadata'] = c.metadata(None, reference_count=1)
    elif bad == 'upload': row['metadata'] = {'source': 'upload', 'model': MODEL, 'reference_snapshot': []}
    elif bad == 'unsigned': row['metadata'] = {'source': 'doubao', 'model': MODEL, 'reference_snapshot': []}
    elif bad == 'unknown': row['metadata'] = c.metadata(None, model_verified=False)
    elif bad == 'expired': row['metadata'] = c.metadata(None, created_at=int(time.time()) - provenance.TRUST_SECONDS)
    elif bad == 'sha': monkeypatch.setattr(policy, '_read_local_record', lambda *a, **kw: b'changed')
    elif bad == 'missing': row = None
    elif bad == 'unprotected': row['metadata'] = c.metadata(None, protected=False)
    elif bad == 'account': c.config.api_key = 'test-another-key'
    elif bad == 'redirect': c.config.model_name = 'doubao-seedance-1.5-pro'
    assert await policy.portrait_reference_badge(row) == {}


@pytest.mark.asyncio
async def test_source_endpoint_authorizes_before_reading_or_marking(context, monkeypatch):
    from routers.ai_proxy import create_ai_proxy_router
    from schemas.generation import ImageReferenceValidationRequest
    from services import media_reference_service
    badge = AsyncMock(return_value={'portrait_reference_scopes': ['workflow']})
    resolver = AsyncMock(return_value=context.rows['file_character'])
    access = AsyncMock(side_effect=policy.GenerationAccessDenied())
    monkeypatch.setattr(policy, 'portrait_reference_badge', badge)
    monkeypatch.setattr(media_reference_service, 'resolve_media_file_record', resolver)
    router = create_ai_proxy_router(require_auth_dependency=lambda: 'user', get_main_event_loop=lambda: None,
        get_redis_client=lambda: None, file_dao=context.dao, generation_access_checker=access)
    endpoint = next(route.endpoint for route in router.routes if route.path == '/api/materials/seedream-source')
    request = ImageReferenceValidationRequest(references=['file_character'], include_portrait_eligibility=True)
    assert await endpoint(request, 'user') == {'items': {'file_character': {}}}
    resolver.assert_not_awaited()
    badge.assert_not_awaited()
    access.side_effect = None
    result = await endpoint(request, 'user')
    assert result['items']['file_character']['portrait_reference_scopes'] == ['workflow']
    badge.assert_awaited_once()


def test_gate_is_wired_in_both_submission_services_and_shared_worker():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    for name in ('task_service.py', 'online_provider_task_service.py'):
        if name == 'task_service.py' and not (root / 'services' / name).exists():
            # The reviewed public profile has only the online submission service.
            assert (root / 'services/online_provider_task_service.py').is_file()
            continue
        source = (root / 'services' / name).read_text(encoding='utf-8')
        assert 'await preflight_portrait_references(task_type, task_data, user_id)' in source
    worker = (root / 'core/online_provider_tasks.py').read_text(encoding='utf-8')
    assert 'verified_images.get(idx) or await self._provider_media_reference' in worker
    assert worker.index('verified_images = await validate_portrait_references') < worker.index('ark_task_id = client.create_video_task')
