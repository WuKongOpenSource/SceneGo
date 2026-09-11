from pathlib import Path

import pytest

from services.audio_generation_service import (
    AudioGenerationMissingAudioError,
    AudioGenerationProviderError,
    AudioGenerationValidationError,
    attach_local_generated_audio_file,
    generate_minimax_tts_sync_response,
)


class _Logger:
    warnings = []
    errors = []
    infos = []

    @classmethod
    def warning(cls, *args, **kwargs):
        cls.warnings.append((args, kwargs))

    @classmethod
    def error(cls, *args, **kwargs):
        cls.errors.append((args, kwargs))

    @classmethod
    def info(cls, *args, **kwargs):
        cls.infos.append((args, kwargs))


@pytest.fixture(autouse=True)
def _reset_logger():
    _Logger.warnings = []
    _Logger.errors = []
    _Logger.infos = []
    _CharacterVoiceDAO.updates = []
    _CharacterVoiceDAO.error = None


class _TTSRequest:
    def __init__(self, **kwargs):
        self.text = kwargs.pop("text", "hello")
        self.voice_id = kwargs.pop("voice_id", "voice_1")
        self.model = kwargs.pop("model", "speech-2.8-hd")
        self.speed = kwargs.pop("speed", 1.0)
        self.pitch = kwargs.pop("pitch", 0)
        self.emotion = kwargs.pop("emotion", None)
        self.entity_type = kwargs.pop("entity_type", "storyboard")
        self.entity_id = kwargs.pop("entity_id", "shot_1")
        self.file_role = kwargs.pop("file_role", None)
        self.project_id = kwargs.pop("project_id", "proj_1")
        self.episode_id = kwargs.pop("episode_id", "ep_1")
        self.storyboard_lineage_id = kwargs.pop("storyboard_lineage_id", "line_1")
        self.bind_to_character_voice_id = kwargs.pop("bind_to_character_voice_id", None)


class _TTSClient:
    def __init__(self, result=None, error=None):
        self.result = result if result is not None else {"audio_bytes": b"mp3", "duration_ms": 12, "trace_id": "trace_1"}
        self.error = error
        self.calls = []

    async def tts_sync(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.result


class _CharacterVoiceDAO:
    updates = []
    error = None

    @classmethod
    async def update_sample_audio_url(cls, voice_id, file_url):
        cls.updates.append((voice_id, file_url))
        if cls.error:
            raise cls.error


@pytest.mark.asyncio
async def test_attach_local_generated_audio_file_saves_file_and_syncs_media(tmp_path: Path):
    audio_path = tmp_path / "sample.mp3"
    audio_path.write_bytes(b"audio-bytes")
    save_calls = []
    media_calls = []

    async def fake_save(**kwargs):
        save_calls.append(kwargs)
        return {"file_id": "file_1", "file_url": "/storage/audio/file_1.mp3"}

    async def fake_media(**kwargs):
        media_calls.append(kwargs)

    result = await attach_local_generated_audio_file(
        {"audio_url": "/uploads/audio/sample.mp3", "duration_ms": 123},
        audio_upload_dir=tmp_path,
        user_id="yuan",
        source="minimax",
        entity_type="storyboard",
        entity_id="shot_1",
        file_role="dialogue_audio",
        episode_id="ep_1",
        media_source="generated_audio_minimax",
        title="short title",
        logger=_Logger,
        save_generated_file_to_db=fake_save,
        create_media_library_item=fake_media,
    )

    assert result == {
        "audio_url": "/uploads/audio/sample.mp3",
        "duration_ms": 123,
        "file_id": "file_1",
        "file_url": "/storage/audio/file_1.mp3",
    }
    assert save_calls[0]["content"] == b"audio-bytes"
    assert save_calls[0]["file_type"] == "audio"
    assert save_calls[0]["source"] == "minimax"
    assert save_calls[0]["file_role"] == "dialogue_audio"
    assert save_calls[0]["original_ext"] == ".mp3"
    assert save_calls[0]["episode_id"] == "ep_1"
    assert media_calls[0]["file_record"] == {"file_id": "file_1", "file_url": "/storage/audio/file_1.mp3"}
    assert media_calls[0]["source"] == "generated_audio_minimax"
    assert media_calls[0]["title"] == "short title"


@pytest.mark.asyncio
async def test_attach_local_generated_audio_file_uses_basename_and_ignores_missing_file(tmp_path: Path):
    save_called = False

    async def fake_save(**_kwargs):
        nonlocal save_called
        save_called = True
        return {}

    result = await attach_local_generated_audio_file(
        {"audio_url": "https://cdn.example.com/path/missing.mp3"},
        audio_upload_dir=tmp_path,
        user_id="yuan",
        source="gemini",
        entity_type=None,
        entity_id=None,
        file_role="dialogue_audio",
        episode_id=None,
        media_source="generated_audio_gemini_speech",
        title=None,
        logger=_Logger,
        save_generated_file_to_db=fake_save,
        create_media_library_item=None,
    )

    assert result == {"audio_url": "https://cdn.example.com/path/missing.mp3"}
    assert save_called is False
    assert _Logger.warnings


@pytest.mark.asyncio
async def test_attach_local_generated_audio_file_keeps_result_when_save_or_media_fails(tmp_path: Path):
    audio_path = tmp_path / "sample.wav"
    audio_path.write_bytes(b"audio-bytes")

    async def broken_save(**_kwargs):
        raise RuntimeError("db down")

    result = await attach_local_generated_audio_file(
        {"audio_url": "/audio/sample.wav"},
        audio_upload_dir=tmp_path,
        user_id="yuan",
        source="minimax",
        entity_type=None,
        entity_id=None,
        file_role="sfx_audio",
        episode_id=None,
        media_source="generated_audio_minimax_sfx",
        title=None,
        logger=_Logger,
        save_generated_file_to_db=broken_save,
        create_media_library_item=None,
    )

    assert result == {"audio_url": "/audio/sample.wav"}
    assert _Logger.warnings

    async def fake_save(**_kwargs):
        return {"file_id": "file_2", "file_url": "/storage/audio/file_2.wav"}

    async def broken_media(**_kwargs):
        raise RuntimeError("media down")

    result = await attach_local_generated_audio_file(
        {"audio_url": "/audio/sample.wav"},
        audio_upload_dir=tmp_path,
        user_id="yuan",
        source="minimax",
        entity_type=None,
        entity_id=None,
        file_role="sfx_audio",
        episode_id=None,
        media_source="generated_audio_minimax_sfx",
        title=None,
        logger=_Logger,
        save_generated_file_to_db=fake_save,
        create_media_library_item=broken_media,
    )

    assert result["file_id"] == "file_2"
    assert result["file_url"] == "/storage/audio/file_2.wav"


@pytest.mark.asyncio
async def test_generate_minimax_tts_sync_response_saves_media_and_binds_voice():
    save_calls = []
    media_calls = []

    async def fake_save(**kwargs):
        save_calls.append(kwargs)
        return {"file_id": "file_tts", "file_url": "/storage/audio/file_tts.mp3"}

    async def fake_media(**kwargs):
        media_calls.append(kwargs)

    request = _TTSRequest(text="hello world", emotion="happy", bind_to_character_voice_id="voice_db_1")
    client = _TTSClient()

    result = await generate_minimax_tts_sync_response(
        request,
        user_id="yuan",
        client=client,
        character_voice_dao=_CharacterVoiceDAO,
        logger=_Logger,
        save_generated_file_to_db=fake_save,
        create_media_library_item=fake_media,
    )

    assert client.calls[0] == {
        "text": "hello world",
        "voice_id": "voice_1",
        "model": "speech-2.8-hd",
        "speed": 1.0,
        "pitch": 0,
        "emotion": "happy",
    }
    assert save_calls[0]["content"] == b"mp3"
    assert save_calls[0]["file_type"] == "audio"
    assert save_calls[0]["source"] == "minimax"
    assert save_calls[0]["file_role"] == "dialogue_audio"
    assert save_calls[0]["project_id"] == "proj_1"
    assert save_calls[0]["original_ext"] == ".mp3"
    assert save_calls[0]["extra_metadata"] == {
        "storyboard_lineage_id": "line_1",
        "requested_entity_id": "shot_1",
    }
    assert media_calls[0]["source"] == "generated_audio_minimax"
    assert media_calls[0]["project_id"] == "proj_1"
    assert media_calls[0]["title"] == "hello world"
    assert _CharacterVoiceDAO.updates == [("voice_db_1", "/storage/audio/file_tts.mp3")]
    assert result == {
        "success": True,
        "audio_url": "/storage/audio/file_tts.mp3",
        "file_id": "file_tts",
        "file_url": "/storage/audio/file_tts.mp3",
        "duration_ms": 12,
        "minimax_trace_id": "trace_1",
    }


@pytest.mark.asyncio
async def test_generate_minimax_tts_sync_response_validates_text():
    async def fake_save(**_kwargs):
        return {}

    with pytest.raises(AudioGenerationValidationError) as empty_exc:
        await generate_minimax_tts_sync_response(
            _TTSRequest(text="  "),
            user_id="yuan",
            client=_TTSClient(),
            character_voice_dao=_CharacterVoiceDAO,
            logger=_Logger,
            save_generated_file_to_db=fake_save,
            create_media_library_item=None,
        )
    assert empty_exc.value.status_code == 400

    with pytest.raises(AudioGenerationValidationError) as long_exc:
        await generate_minimax_tts_sync_response(
            _TTSRequest(text="x" * 1001),
            user_id="yuan",
            client=_TTSClient(),
            character_voice_dao=_CharacterVoiceDAO,
            logger=_Logger,
            save_generated_file_to_db=fake_save,
            create_media_library_item=None,
        )
    assert long_exc.value.status_code == 413


@pytest.mark.asyncio
async def test_generate_minimax_tts_sync_response_maps_provider_and_missing_audio_errors():
    async def fake_save(**_kwargs):
        return {}

    with pytest.raises(AudioGenerationProviderError):
        await generate_minimax_tts_sync_response(
            _TTSRequest(),
            user_id="yuan",
            client=_TTSClient(error=RuntimeError("provider down")),
            character_voice_dao=_CharacterVoiceDAO,
            logger=_Logger,
            save_generated_file_to_db=fake_save,
            create_media_library_item=None,
        )

    with pytest.raises(AudioGenerationMissingAudioError):
        await generate_minimax_tts_sync_response(
            _TTSRequest(),
            user_id="yuan",
            client=_TTSClient(result={"trace_id": "trace_empty"}),
            character_voice_dao=_CharacterVoiceDAO,
            logger=_Logger,
            save_generated_file_to_db=fake_save,
            create_media_library_item=None,
        )


@pytest.mark.asyncio
async def test_generate_minimax_tts_sync_response_keeps_success_when_media_or_voice_update_fails():
    async def fake_save(**_kwargs):
        return {"file_id": "file_tts", "file_url": "/storage/audio/file_tts.mp3"}

    async def broken_media(**_kwargs):
        raise RuntimeError("media down")

    _CharacterVoiceDAO.error = RuntimeError("voice update failed")

    result = await generate_minimax_tts_sync_response(
        _TTSRequest(bind_to_character_voice_id="voice_db_1"),
        user_id="yuan",
        client=_TTSClient(),
        character_voice_dao=_CharacterVoiceDAO,
        logger=_Logger,
        save_generated_file_to_db=fake_save,
        create_media_library_item=broken_media,
    )

    assert result["file_id"] == "file_tts"
    assert len(_Logger.warnings) == 2
