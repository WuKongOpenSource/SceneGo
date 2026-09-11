"""No provider calls: original-byte probes, billing boundary and legacy workers."""
import base64
import copy
import io
import wave
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from services import seedance_audio_validation_service as audio
from services.generation_access_service import GenerationAccessDenied
from services.api_provider_runtime import (
    seedance_error_is_input_rejection, seedance_error_is_non_retryable, seedance_user_facing_error,
)
from seedance_audio_contract import assert_audio_rejected_before_billing, data, wav_bytes


@pytest.mark.asyncio
@pytest.mark.parametrize('durations', [[15.804], [8.028, 8.028], [1.5], [15.001]])
async def test_real_bytes_reject_single_and_aggregate_even_when_client_forges_duration(durations):
    params = {'sub_model': 'mini', 'media_inputs': [data(n, duration_seconds=2) for n in durations]}
    original = copy.deepcopy(params)
    with patch.object(audio, 'require_generation_request_access', new=AsyncMock()):
        with pytest.raises(audio.SeedanceAudioValidationError, match='合计.*15 秒'):
            await audio.validate_seedance_reference_audio('seedance_multi', params, 'user', file_dao=MagicMock())
    assert params == original


@pytest.mark.asyncio
@pytest.mark.parametrize('model', ['mini', 'fast', 'standard'])
async def test_valid_boundary_preserves_every_original_byte_and_does_not_require_client_duration(model):
    media = [data(7), data(8)]
    with patch.object(audio, 'require_generation_request_access', new=AsyncMock()) as access:
        resolved = await audio.validate_seedance_reference_audio(
            'seedance_multi', {'sub_model': model, 'media_inputs': media}, 'user', file_dao=MagicMock(),
        )
    assert resolved == {i: item['url'] for i, item in enumerate(media)}
    assert access.await_args.args[1] == 'user'


@pytest.mark.asyncio
async def test_missing_or_revoked_permission_never_reads_bytes():
    params = {'media_inputs': [{'kind': 'audio', 'file_id': 'file_other', 'url': '/api/files/file_owned'}]}
    with patch.object(audio, 'require_generation_request_access', new=AsyncMock(side_effect=GenerationAccessDenied())) as access, \
         patch.object(audio, 'provider_audio_or_video_reference', new=AsyncMock()) as read:
        with pytest.raises(audio.SeedanceAudioValidationError, match='无权访问'):
            await audio.validate_seedance_reference_audio('seedance_multi', params, 'user', file_dao=MagicMock())
    assert access.await_args.args[2] == ['file_other', '/api/files/file_owned']
    read.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('task_type,model', [('kling_multi', 'mini'), ('seedance_i2v', 'agent_plan')])
async def test_other_model_contracts_unchanged(task_type, model):
    with patch.object(audio, 'require_generation_request_access', new=AsyncMock()) as access:
        assert await audio.validate_seedance_reference_audio(task_type, {'sub_model': model, 'media_inputs': [data(30)]}, 'user') == {}
    access.assert_not_awaited()


@pytest.mark.parametrize('payload', [b'not audio', b'#EXTM3U\nhttp://127.0.0.1/internal'])
def test_unreadable_or_playlist_input_is_not_assumed_five_seconds(payload):
    with pytest.raises(audio.SeedanceAudioValidationError, match='真实时长'):
        audio._probe_audio_bytes(payload)


@pytest.mark.asyncio
async def test_submission_rejects_before_reserving_credits_or_enqueue():
    from services.online_provider_task_service import OnlineProviderTaskService
    await assert_audio_rejected_before_billing(
        OnlineProviderTaskService(AsyncMock(), model_access_checker=AsyncMock()),
    )


@pytest.mark.asyncio
async def test_worker_checks_legacy_task_before_any_provider_create():
    from core.online_provider_tasks import OnlineProviderTaskHandlers
    from core.online_provider_task_model import OnlineProviderTask
    handler = OnlineProviderTaskHandlers()
    handler.task_queue = AsyncMock()
    task = OnlineProviderTask('legacy', 'seedance_multi', {'sub_model': 'mini', 'media_inputs': [data(16)]}, user_id='user')
    with patch.object(audio, 'require_generation_request_access', new=AsyncMock()), \
         patch('seedance_api.get_seedance_client') as factory, \
         patch('services.api_provider_health_monitor.cache_provider_health_result', new=AsyncMock()) as health:
        assert await handler._process_seedance_task(task) is False
    factory.return_value.create_video_task.assert_not_called()
    assert handler.task_queue.fail_task.await_args.kwargs['retry'] is False
    health.assert_not_awaited()


def test_supplier_parameter_rejection_is_not_a_health_or_moderation_error():
    import requests
    response = requests.Response()
    response.status_code = 400
    response._content = b'{"error":{"code":"InvalidParameter","message":"audio duration must be <= 15.2 seconds"}}'
    error = requests.HTTPError('Bad request', response=response)
    assert seedance_error_is_input_rejection(error)
    assert seedance_error_is_non_retryable(error)
    message = seedance_user_facing_error(error)
    assert '配音时长' in message and '审核' not in message and '15.2' not in message


@pytest.mark.asyncio
async def test_remote_audio_is_inlined_after_probe_to_avoid_url_content_changing():
    payload = wav_bytes(3)
    with patch.object(audio, 'require_generation_request_access', new=AsyncMock()), \
         patch.object(audio, 'provider_audio_or_video_reference', new=AsyncMock(return_value='https://example.test/a.mp3')), \
         patch.object(audio, '_download_audio', new=AsyncMock(return_value=payload)):
        resolved = await audio.validate_seedance_reference_audio('seedance_multi', {'media_inputs': [{'kind': 'audio', 'url': 'https://example.test/a.mp3'}]}, 'user')
    assert base64.b64decode(resolved[0].split(',')[1]) == payload


@pytest.mark.parametrize('source,expected', [
    ([15.804, 8.028], [9.947, 5.052]), ([23.832], [15]),
    ([2, 100, 2], [2, 11, 2]), ([3, 4], [3, 4]), ([6, 6, 6], [5, 5, 5]),
])
def test_proportional_allocation_preserves_each_voice_and_total_budget(source, expected):
    from services.seedance_audio_reference_service import allocate_audio_budget
    result = allocate_audio_budget(source)
    assert result == expected
    assert sum(result) <= 15
    assert all(2 <= length <= original for length, original in zip(result, source))


@pytest.mark.asyncio
async def test_explicit_trim_preflight_does_not_create_copies_or_mutate_request():
    params = {'reference_audio_policy': 'trim_to_15', 'media_inputs': [data(15.804), data(8.028)], 'duration': 15}
    original = copy.deepcopy(params)
    with patch.object(audio, 'require_generation_request_access', new=AsyncMock()), \
         patch('services.seedance_audio_reference_service.trim_audio_copy') as trim:
        await audio.preflight_seedance_reference_audio('seedance_multi', params, 'user')
    assert params == original
    trim.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize('model', ['standard', 'fast', 'mini'])
async def test_worker_trims_only_reference_copies_and_creates_one_video(model):
    from core.online_provider_tasks import OnlineProviderTaskHandlers
    from core.online_provider_task_model import OnlineProviderTask
    handler = OnlineProviderTaskHandlers()
    handler.task_queue = AsyncMock()
    handler._save_external_video = AsyncMock(return_value={'url': '/video.mp4'})
    params = {'sub_model': model, 'prompt': 'same scene', 'duration': 15,
              'reference_audio_policy': 'trim_to_15', 'media_inputs': [data(15.804), data(8.028)],
              'workspace_group_id': 'merged-original', 'mergedFrom': [{'id': 'one'}, {'id': 'two'}]}
    original = copy.deepcopy(params)
    task = OnlineProviderTask('one-video', 'seedance_multi', params, user_id='user')
    client = MagicMock()
    client.create_video_task.return_value = 'accepted'
    client.query_task.return_value = {'status': 'succeeded', 'content': {'video_url': 'https://example.test/video'}}
    client.download_video.return_value = b'video'
    with patch.object(audio, 'require_generation_request_access', new=AsyncMock()), \
         patch('seedance_api.get_seedance_client', return_value=client):
        assert await handler._process_seedance_task(task) is True
    assert task.data == original
    client.create_video_task.assert_called_once()
    assert client.create_video_task.call_args.kwargs['duration'] == 15
    assert 'reference_audio_policy' not in client.create_video_task.call_args.kwargs
    contents = client.create_video_task.call_args.args[1]
    reference_content = [item['audio_url']['url'] for item in contents if item['type'] == 'audio_url']
    actual = [audio._probe_audio_bytes(base64.b64decode(uri.split(',')[1])) for uri in reference_content]
    assert actual == [9.947, 5.052]
    assert sum(actual) <= 15
    handler.task_queue.complete_task.assert_awaited_once()


@pytest.mark.asyncio
async def test_trim_policy_still_rejects_short_source_and_invalid_policy():
    with patch.object(audio, 'require_generation_request_access', new=AsyncMock()):
        for policy, duration in [('trim_to_15', 1.5), ('unknown', 20)]:
            with pytest.raises(HTTPException) as caught:
                await audio.preflight_seedance_reference_audio('seedance_multi', {
                    'reference_audio_policy': policy, 'media_inputs': [data(duration)],
                }, 'user')
            assert caught.value.status_code == 400


def test_schema_rejects_misspelled_policy_and_preserves_explicit_choice():
    from schemas.generation import GenerateRequest
    assert GenerateRequest(task_type='seedance_multi').reference_audio_policy == 'preserve'
    assert GenerateRequest(task_type='seedance_multi', reference_audio_policy='trim_to_15').model_dump()['reference_audio_policy'] == 'trim_to_15'
    with pytest.raises(ValueError):
        GenerateRequest(task_type='seedance_multi', reference_audio_policy='unknown')


def test_reference_copy_is_a_prefix_at_original_speed_not_a_retimed_full_recording():
    from services.seedance_audio_reference_service import trim_audio_copy
    # Distinct stereo PCM samples allow an exact sample comparison after the
    # WAV wrapper changes; silence would not detect a speed/content regression.
    samples = bytes(range(256)) * 3000
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as writer:
        writer.setparams((2, 2, 48000, 0, 'NONE', 'not compressed'))
        writer.writeframes(samples)
    original = buffer.getvalue()
    result = trim_audio_copy(original, 2.5)
    with wave.open(io.BytesIO(result), 'rb') as reader:
        assert reader.getframerate() == 48000
        assert reader.getnframes() == 120000
        assert reader.readframes(120000) == samples[:120000 * 4]
    assert buffer.getvalue() == original


@pytest.mark.asyncio
async def test_actual_connector_rejects_private_dns_answers():
    with patch.object(audio.aiohttp.resolver.DefaultResolver, 'resolve', new=AsyncMock(return_value=[{'host': '127.0.0.1'}])):
        resolver = audio._PublicResolver()
        try:
            with pytest.raises(audio.SeedanceAudioValidationError):
                await resolver.resolve('example.test', 443)
        finally:
            await resolver.close()
