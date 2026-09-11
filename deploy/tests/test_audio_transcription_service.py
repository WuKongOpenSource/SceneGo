import asyncio
import base64
import io
import wave
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services import audio_transcription_service as service


def wav_data_uri(duration_ms=500):
    frames = b"\x00\x00" * int(16_000 * duration_ms / 1000)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16_000)
        output.writeframes(frames)
    return "data:audio/wav;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def test_normalize_transcription_segments_validates_and_orders_provider_json():
    value = '```json\n{"segments":[{"start_ms":800,"end_ms":1200,"text":" 后句 "},{"start_ms":0,"end_ms":500,"text":"前句"},{"start_ms":900,"end_ms":850,"text":"坏数据"}]}\n```'
    assert service.normalize_transcription_segments(value, duration_ms=1000) == [
        {"start_ms": 0, "end_ms": 500, "text": "前句"},
        {"start_ms": 800, "end_ms": 1000, "text": "后句"},
    ]


def test_trim_audio_data_uri_applies_the_requested_clip_boundary():
    trimmed = service._trim_audio_data_uri(
        wav_data_uri(800),
        source_offset_ms=200,
        duration_ms=300,
    )
    assert trimmed.startswith("data:audio/wav;base64,")
    assert len(base64.b64decode(trimmed.split(",", 1)[1])) > 100


@pytest.mark.asyncio
async def test_transcription_uses_authorized_audio_and_returns_clip_relative_timestamps(monkeypatch):
    config = SimpleNamespace(
        provider="gemini-text",
        api_key="test-key",
        endpoint="https://example.test/v1",
        model_name="gemini-2.5-flash",
        requests_kwargs=lambda: {},
    )
    post = AsyncMock(return_value={"candidates": [{"content": {"parts": [{
        "text": '{"segments":[{"start_ms":100,"end_ms":600,"text":"你好"}]}',
    }]}}]})
    monkeypatch.setattr(service, "resolve_provider", lambda *args, **kwargs: config)
    monkeypatch.setattr(service, "provider_audio_or_video_reference", AsyncMock(return_value=wav_data_uri()))
    monkeypatch.setattr(service, "_trim_audio_data_uri", lambda *args, **kwargs: wav_data_uri(300))
    monkeypatch.setattr(service, "_post_json_request_async", post)

    result = await service.transcribe_timeline_audio([{
        "clip_id": "voice-1",
        "audio_url": "/api/files/file_voice/download",
        "source_offset_ms": 200,
        "duration_ms": 800,
    }], file_dao=object())

    assert result == [{
        "clip_id": "voice-1", "start_ms": 100, "end_ms": 600, "text": "你好",
    }]
    assert post.await_args.kwargs["url"] == (
        "https://example.test/v1beta/models/gemini-2.5-flash:generateContent"
    )
    parts = post.await_args.kwargs["payload"]["contents"][0]["parts"]
    assert parts[1]["inlineData"]["mimeType"] == "audio/wav"
    assert parts[1]["inlineData"]["data"]


@pytest.mark.asyncio
async def test_transcription_splits_long_audio_into_bounded_native_requests(monkeypatch):
    config = SimpleNamespace(
        provider="gemini-text",
        api_key="test-key",
        endpoint="https://example.test/v1beta",
        model_name="gemini-2.5-flash",
        requests_kwargs=lambda: {},
    )
    post = AsyncMock(return_value={"candidates": [{"content": {"parts": [{
        "text": '{"segments":[{"start_ms":0,"end_ms":1000,"text":"片段"}]}',
    }]}}]})
    trims = []
    monkeypatch.setattr(service, "resolve_provider", lambda *args, **kwargs: config)
    monkeypatch.setattr(service, "provider_audio_or_video_reference", AsyncMock(return_value=wav_data_uri()))

    def fake_trim(*_args, **kwargs):
        trims.append((kwargs["source_offset_ms"], kwargs["duration_ms"]))
        return wav_data_uri(100)

    monkeypatch.setattr(service, "_trim_audio_data_uri", fake_trim)
    monkeypatch.setattr(service, "_post_json_request_async", post)

    result = await service.transcribe_timeline_audio([{
        "clip_id": "voice-1",
        "audio_url": "/api/files/file_voice/download",
        "source_offset_ms": 2000,
        "duration_ms": 125000,
    }], file_dao=object())

    assert trims == [(2000, 60000), (62000, 60000), (122000, 5000)]
    assert [item["start_ms"] for item in result] == [0, 60000, 120000]
    assert post.await_count == 3
