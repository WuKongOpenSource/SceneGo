


import pytest
from unittest.mock import AsyncMock, patch


async def test_provider_interface_contract():
    from audio_provider import AudioProvider
    provider = AudioProvider()
    with pytest.raises(NotImplementedError):
        await provider.generate_speech("text", persona="narrator")
    with pytest.raises(NotImplementedError):
        await provider.generate_sfx("explosion")
    with pytest.raises(NotImplementedError):
        await provider.generate_music("sad piano")


async def test_minimax_generate_speech_maps_legacy_persona_to_voice_id():
    from audio_provider import MinimaxAudioProvider
    with patch('external_api.audio.minimax_audio.get_minimax_audio_client') as get_client:
        client = get_client.return_value
        client.tts_sync = AsyncMock(return_value={
            "audio_url": "/storage/audio/speech_test.mp3", "duration_ms": 3200,
        })
        provider = MinimaxAudioProvider()
        result = await provider.generate_speech("你好世界", persona="narrator", emotion="neutral")

    assert result["audio_url"].endswith(".mp3")
    client.tts_sync.assert_awaited_once_with(
        text="你好世界",
        voice_id="presenter_male",
        speed=1.0,
        pitch=0,
        emotion="neutral",
    )


async def test_minimax_generate_music_via_music_generate():
    from audio_provider import MinimaxAudioProvider
    with patch('external_api.audio.minimax_audio.get_minimax_audio_client') as get_client:
        client = get_client.return_value
        client.music_generate = AsyncMock(return_value={
            "audio_url": "/storage/audio/music_test.mp3", "duration_ms": 30000,
        })
        provider = MinimaxAudioProvider()
        result = await provider.generate_music("紧张悬疑的背景音乐", duration_ms=30000)
        assert result["audio_url"].endswith(".mp3")
        assert result["duration_ms"] == 30000
        client.music_generate.assert_awaited_once_with(
            lyrics="",
            prompt="紧张悬疑的背景音乐",
            model=None,
            is_instrumental=True,
            lyrics_optimizer=False,
            refer_voice="",
            refer_instrumental="",
        )


async def test_minimax_generate_sfx_via_music_generate():
    from audio_provider import MinimaxAudioProvider
    with patch('external_api.audio.minimax_audio.get_minimax_audio_client') as get_client:
        client = get_client.return_value
        client.music_generate = AsyncMock(return_value={
            "audio_url": "/storage/audio/music_sfx.mp3", "duration_ms": 1200,
        })
        provider = MinimaxAudioProvider()
        result = await provider.generate_sfx("explosion")
        assert result["audio_url"].endswith(".mp3")
        client.music_generate.assert_awaited_once_with(
            prompt="explosion",
            is_instrumental=True,
            model=None,
            refer_voice="",
            refer_instrumental="",
        )


async def test_get_audio_provider_factory():
    from audio_provider import get_audio_provider, MinimaxAudioProvider
    provider = get_audio_provider()
    assert isinstance(provider, MinimaxAudioProvider)


async def test_gemini_audio_provider_is_retired():
    from audio_provider import get_audio_provider
    with pytest.raises(ValueError, match="Unknown audio provider"):
        get_audio_provider('gemini')


async def test_get_audio_provider_unknown_raises():
    from audio_provider import get_audio_provider
    with pytest.raises(ValueError, match="Unknown audio provider"):
        get_audio_provider('nonexistent')
