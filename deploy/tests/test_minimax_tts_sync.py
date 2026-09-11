"""Unit tests for MinimaxAudioClient.tts_sync (POST /v1/t2a_v2)."""
import asyncio
import os
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import minimax_audio


@pytest.fixture
def tmp_audio_dir(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(minimax_audio, "AUDIO_UPLOAD_DIR", d)
        yield d


def _fake_aiohttp_response(payload: dict, status: int = 200):
    """Build a context-manager-shaped mock for `async with session.post(...) as resp`."""
    resp = MagicMock()
    resp.status = status
    resp.json = AsyncMock(return_value=payload)
    # Implementation calls `await resp.text()` on non-200; mock it too so the
    # http_non_200 test can reach the RuntimeError instead of awaiting a MagicMock.
    resp.text = AsyncMock(return_value=str(payload))
    resp.__aenter__ = AsyncMock(return_value=resp)
    resp.__aexit__ = AsyncMock(return_value=False)
    return resp


def _fake_session(post_response):
    session = MagicMock()
    session.post = MagicMock(return_value=post_response)
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    return session


@pytest.mark.parametrize(
    ("emotion", "expected"),
    [
        ("excited", "happy"),
        ("兴奋", "happy"),
        (" happy ", "happy"),
        ("neutral", None),
        ("auto", None),
        ("legacy-unknown-emotion", None),
    ],
)
def test_map_emotion_for_tts_normalizes_ui_and_legacy_values(emotion, expected):
    assert minimax_audio._map_emotion_for_tts(emotion) == expected


async def test_tts_sync_happy_path_writes_hex_to_audio_dir(tmp_audio_dir):
    # Mock MiniMax /v1/t2a_v2 response: 4 bytes (0x49 0x44 0x33 0x04) = "ID3\x04" mp3-ish header hex
    mock_payload = {
        "data": {"audio": "49443304", "status": 2},
        "extra_info": {"audio_length": 1234, "audio_format": "mp3", "audio_size": 4},
        "trace_id": "trace-abc-123",
        "base_resp": {"status_code": 0, "status_msg": "success"},
    }
    fake_resp = _fake_aiohttp_response(mock_payload)
    fake_session_ctx = _fake_session(fake_resp)

    client = minimax_audio.MinimaxAudioClient(api_key="fake")
    with patch("aiohttp.ClientSession", return_value=fake_session_ctx) as session_factory:
        result = await client.tts_sync(
            text="测试文本", voice_id="presenter_male", model="speech-2.8-hd",
        )

    # audio_url returned
    assert result["audio_url"].startswith("/storage/audio/")
    assert result["audio_url"].endswith(".mp3")
    # duration_ms taken from extra_info.audio_length (NOT estimated from byte size)
    assert result["duration_ms"] == 1234
    # trace_id surfaced for diagnostics
    assert result["trace_id"] == "trace-abc-123"
    # File written to AUDIO_UPLOAD_DIR with the decoded hex bytes
    filename = result["audio_url"].rsplit("/", 1)[-1]
    filepath = os.path.join(tmp_audio_dir, filename)
    assert os.path.exists(filepath)
    with open(filepath, "rb") as f:
        assert f.read() == bytes.fromhex("49443304")
    assert session_factory.call_args.kwargs["timeout"].total == 60
    post_args, post_kwargs = fake_session_ctx.post.call_args
    assert post_args[0].endswith("/t2a_v2")
    assert post_kwargs["json"]["text"] == "测试文本"
    assert post_kwargs["json"]["model"] == "speech-2.8-hd"
    assert post_kwargs["headers"]["Authorization"] == "Bearer fake"


async def test_tts_sync_maps_excited_to_supported_happy(tmp_audio_dir):
    mock_payload = {
        "data": {"audio": "49443304", "status": 2},
        "extra_info": {"audio_length": 1234, "audio_format": "mp3", "audio_size": 4},
        "trace_id": "trace-emotion-1",
        "base_resp": {"status_code": 0, "status_msg": "success"},
    }
    fake_session_ctx = _fake_session(_fake_aiohttp_response(mock_payload))
    client = minimax_audio.MinimaxAudioClient(api_key="fake")

    with patch("aiohttp.ClientSession", return_value=fake_session_ctx):
        await client.tts_sync(
            text="测试文本",
            voice_id="presenter_male",
            model="speech-2.8-hd",
            emotion="excited",
        )

    payload = fake_session_ctx.post.call_args.kwargs["json"]
    assert payload["voice_setting"]["emotion"] == "happy"


async def test_tts_sync_raises_when_base_resp_status_nonzero(tmp_audio_dir):

    mock_payload = {
        "data": None,
        "base_resp": {"status_code": 1004, "status_msg": "auth failed"},
        "trace_id": "trace-fail-1",
    }
    fake_resp = _fake_aiohttp_response(mock_payload)
    fake_session_ctx = _fake_session(fake_resp)

    client = minimax_audio.MinimaxAudioClient(api_key="bad")
    with patch("aiohttp.ClientSession", return_value=fake_session_ctx):
        with pytest.raises(RuntimeError, match="status_code=1004"):
            await client.tts_sync(text="x", voice_id="v")


async def test_tts_sync_raises_when_http_non_200(tmp_audio_dir):
    fake_resp = _fake_aiohttp_response({"any": "thing"}, status=500)
    fake_session_ctx = _fake_session(fake_resp)
    client = minimax_audio.MinimaxAudioClient(api_key="x")
    with patch("aiohttp.ClientSession", return_value=fake_session_ctx):
        with pytest.raises(RuntimeError, match="http_status=500"):
            await client.tts_sync(text="hi", voice_id="v")


async def test_tts_sync_empty_text_rejected_before_http(tmp_audio_dir):

    client = minimax_audio.MinimaxAudioClient(api_key="x")
    with pytest.raises(ValueError, match="text"):
        await client.tts_sync(text="   ", voice_id="v")


async def test_tts_sync_rejects_oversized_hex_before_writing(tmp_audio_dir, monkeypatch):
    monkeypatch.setenv("MAX_PROVIDER_AUDIO_OUTPUT_BYTES", "3")
    mock_payload = {
        "data": {"audio": "49443304", "status": 2},
        "extra_info": {"audio_length": 100, "audio_format": "mp3", "audio_size": 4},
        "trace_id": "trace-too-large",
        "base_resp": {"status_code": 0, "status_msg": "success"},
    }
    fake_session_ctx = _fake_session(_fake_aiohttp_response(mock_payload))
    client = minimax_audio.MinimaxAudioClient(api_key="fake")

    with patch("aiohttp.ClientSession", return_value=fake_session_ctx):
        with pytest.raises(RuntimeError, match="超过大小限制"):
            await client.tts_sync(text="测试文本", voice_id="presenter_male")

    assert os.listdir(tmp_audio_dir) == []
