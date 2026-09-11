import asyncio
import base64
import io
import shutil
import wave
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from services import audio_transcription_service as service
from services.subtitle_word_timing import word_timestamps_to_cues


def wav_data_uri(duration_ms=800, value=200):
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(value.to_bytes(2, 'little', signed=True) * (16 * duration_ms))
    return 'data:audio/wav;base64,' + base64.b64encode(buffer.getvalue()).decode()


def clip(**kwargs):
    return {'clip_id': 'v1', 'audio_url': '/api/files/f1/download', 'media_kind': 'video', 'source_offset_ms': 200, 'duration_ms': 500, **kwargs}


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv('SUBTITLE_TRANSCRIPTION_ENGINE', 'whisper')
    config = SimpleNamespace(api_key='test-key', endpoint='https://example.test/v1beta', requests_kwargs=lambda: {})
    monkeypatch.setattr(service, 'resolve_provider', lambda *a, **kw: config)
    monkeypatch.setattr(service, 'provider_audio_or_video_reference', AsyncMock(return_value=wav_data_uri()))
    monkeypatch.setattr(service, '_extract_audio', lambda *args: (b'audio', 500))
    return config


@pytest.mark.parametrize('endpoint', ['https://example.test/v1', 'https://example.test/v1beta', 'https://example.test/v1/chat/completions', 'https://example.test/v1beta/openai', 'https://example.test/v1/audio/transcriptions'])
def test_endpoint_uses_same_configured_gateway(endpoint):
    assert service.transcription_endpoint(endpoint) == 'https://example.test/v1/audio/transcriptions'


def test_capability_requires_explicit_opt_in(monkeypatch):
    monkeypatch.delenv('SUBTITLE_TRANSCRIPTION_ENGINE', raising=False)
    assert service.transcription_capability()['available'] is False


@pytest.mark.skipif(not shutil.which('ffmpeg') or not shutil.which('ffprobe'), reason='media tools unavailable')
def test_extract_preserves_crop_duration_and_skips_silence():
    content, duration = service._extract_audio(wav_data_uri(), 200, 300)
    assert content and duration == 300
    assert service._extract_audio(wav_data_uri(value=0), 200, 300) == (b'', 300)
    with pytest.raises(service.AudioTranscriptionError, match='超过'):
        service._extract_audio(wav_data_uri(), 700, 400)


async def test_transcription_uses_word_timestamps_without_guessing(configured, monkeypatch):
    post = AsyncMock(return_value={'text': '你好。', 'words': [{'word': '你好', 'start': .1, 'end': .45}]})
    monkeypatch.setattr(service, '_post_form_request_async', post)
    result = await service.transcribe_timeline_audio([clip()], file_dao=object(), user_id='user1')
    assert result == [{'clip_id': 'v1', 'start_ms': 100, 'end_ms': 450, 'text': '你好。'}]
    args = post.await_args.kwargs
    assert args['url'] == 'https://example.test/v1/audio/transcriptions'
    assert args['data']['model'] == 'whisper-1'
    assert args['data']['timestamp_granularities[]'] == ['word', 'segment']
    assert args['request_kwargs']['allow_redirects'] is False
    assert 'user1' not in service._busy_users


@pytest.mark.parametrize('override', [{'duration_ms': 60001}, {'duration_ms': True}, {'source_offset_ms': -1}, {'duration_ms': '500'}, {'audio_url': 'data:audio/wav;base64,AA=='}, {'audio_url': 'blob:source'}])
async def test_invalid_requests_never_call_upstream(configured, monkeypatch, override):
    post = AsyncMock()
    monkeypatch.setattr(service, '_post_form_request_async', post)
    with pytest.raises(service.AudioTranscriptionError):
        await service.transcribe_timeline_audio([clip(**override)], file_dao=object(), user_id='user1')
    post.assert_not_called()


async def test_remote_sources_must_be_imported_and_no_audio_skips_provider(configured, monkeypatch):
    post = AsyncMock()
    monkeypatch.setattr(service, '_post_form_request_async', post)
    monkeypatch.setattr(service, 'provider_audio_or_video_reference', AsyncMock(return_value='https://example.test/video.mp4'))
    with pytest.raises(service.AudioTranscriptionError, match='上传'):
        await service.transcribe_timeline_audio([clip()], file_dao=object(), user_id='user1')
    monkeypatch.setattr(service, 'provider_audio_or_video_reference', AsyncMock(return_value=wav_data_uri()))
    monkeypatch.setattr(service, '_extract_audio', lambda *a: (b'', 500))
    assert await service.transcribe_timeline_audio([clip()], file_dao=object(), user_id='user1') == []
    post.assert_not_called()


async def test_cancellation_keeps_user_slot_until_upstream_finishes(configured, monkeypatch):
    started, release = asyncio.Event(), asyncio.Event()
    async def post(**kwargs):
        started.set()
        await release.wait()
        return {'text': '', 'words': []}
    monkeypatch.setattr(service, '_post_form_request_async', post)
    pending = asyncio.create_task(service.transcribe_timeline_audio([clip()], file_dao=object(), user_id='user1'))
    await started.wait()
    pending.cancel()
    await asyncio.sleep(0)
    with pytest.raises(service.AudioTranscriptionBusy):
        await service.transcribe_timeline_audio([clip()], file_dao=object(), user_id='user1')
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await pending
    assert 'user1' not in service._busy_users


@pytest.mark.parametrize('body', [None, {'text': 'speech'}, {'text': 'speech', 'words': []}, {'words': [{'word': 'hello', 'start': float('nan'), 'end': 1}]}, {'words': [{'word': 'a', 'start': .5, 'end': 1}, {'word': 'b', 'start': .1, 'end': .8}]}, {'words': [{'word': 'a', 'start': 0, 'end': 3}]}])
def test_word_clocks_fail_closed(body):
    with pytest.raises(ValueError):
        word_timestamps_to_cues(body, 2000)


def test_word_clocks_keep_real_pauses_and_punctuation_without_duplicates():
    assert word_timestamps_to_cues({'text': '你好，世界。', 'words': [
        {'word': '你好', 'start': .1, 'end': .3}, {'word': '，', 'start': .3, 'end': .3},
        {'word': '世界。', 'start': .9, 'end': 1.2},
    ]}, 2000) == [{'start_ms': 100, 'end_ms': 300, 'text': '你好，'}, {'start_ms': 900, 'end_ms': 1200, 'text': '世界。'}]


def test_no_speech_segments_do_not_become_subtitles():
    assert word_timestamps_to_cues({'text': 'noise', 'words': [{'word': 'noise', 'start': 0, 'end': 1}], 'segments': [{'start': 0, 'end': 2, 'no_speech_prob': .9}]}, 2000) == []
