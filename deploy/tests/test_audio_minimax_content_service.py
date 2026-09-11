from pathlib import Path

import pytest

from services.audio_minimax_content_service import (
    generate_minimax_lyrics_response,
    generate_minimax_music_response,
    query_minimax_tts_response,
)


class _Logger:
    warnings = []

    @classmethod
    def warning(cls, *args, **kwargs):
        cls.warnings.append((args, kwargs))


@pytest.fixture(autouse=True)
def _reset_logger():
    _Logger.warnings = []


class _MusicRequest:
    def __init__(self, **kwargs):
        self.prompt = kwargs.pop("prompt", "cinematic orchestral")
        self.lyrics = kwargs.pop("lyrics", "line one")
        self.model = kwargs.pop("model", None)
        self.is_instrumental = kwargs.pop("is_instrumental", False)
        self.lyrics_optimizer = kwargs.pop("lyrics_optimizer", False)
        self.refer_voice = kwargs.pop("refer_voice", "voice_ref")
        self.refer_instrumental = kwargs.pop("refer_instrumental", "inst_ref")
        self.entity_type = kwargs.pop("entity_type", "storyboard")
        self.entity_id = kwargs.pop("entity_id", "shot_1")
        self.file_role = kwargs.pop("file_role", None)
        self.episode_id = kwargs.pop("episode_id", "ep_1")


class _Client:
    def __init__(self):
        self.calls = []

    async def tts_query(self, task_id):
        self.calls.append(("tts_query", task_id))
        return {"task_id": task_id, "status": "Done"}

    async def music_generate(self, **kwargs):
        self.calls.append(("music_generate", kwargs))
        return {"audio_url": "/audio/song.mp3", "duration_ms": 4321}

    async def lyrics_generate(self, **kwargs):
        self.calls.append(("lyrics_generate", kwargs))
        return {"data": {"lyrics": "generated lyrics"}}


@pytest.mark.asyncio
async def test_query_minimax_tts_response_wraps_client_result():
    client = _Client()

    result = await query_minimax_tts_response(client=client, task_id="mx_task_1")

    assert result == {"success": True, "task_id": "mx_task_1", "status": "Done"}
    assert client.calls == [("tts_query", "mx_task_1")]


@pytest.mark.asyncio
async def test_generate_minimax_music_response_persists_local_audio(tmp_path: Path):
    audio_file = tmp_path / "song.mp3"
    audio_file.write_bytes(b"music")
    client = _Client()
    save_calls = []
    media_calls = []

    async def fake_save(**kwargs):
        save_calls.append(kwargs)
        return {"file_id": "file_music", "file_url": "/storage/audio/file_music.mp3"}

    async def fake_media(**kwargs):
        media_calls.append(kwargs)

    result = await generate_minimax_music_response(
        _MusicRequest(lyrics="a" * 90),
        user_id="yuan",
        client=client,
        audio_upload_dir=tmp_path,
        logger=_Logger,
        save_generated_file_to_db=fake_save,
        create_media_library_item=fake_media,
    )

    assert client.calls == [
        (
            "music_generate",
            {
                "lyrics": "a" * 90,
                "prompt": "cinematic orchestral",
                "refer_voice": "voice_ref",
                "refer_instrumental": "inst_ref",
                "model": None,
                "is_instrumental": False,
                "lyrics_optimizer": False,
            },
        )
    ]
    assert result == {
        "success": True,
        "audio_url": "/audio/song.mp3",
        "duration_ms": 4321,
        "file_id": "file_music",
        "file_url": "/storage/audio/file_music.mp3",
    }
    assert save_calls[0]["content"] == b"music"
    assert save_calls[0]["source"] == "minimax"
    assert save_calls[0]["file_role"] == "background_music"
    assert save_calls[0]["episode_id"] == "ep_1"
    assert media_calls[0]["source"] == "generated_audio_minimax_music"
    assert media_calls[0]["title"] == "a" * 80


@pytest.mark.asyncio
async def test_generate_minimax_lyrics_response_extracts_nested_lyrics():
    client = _Client()

    result = await generate_minimax_lyrics_response(client=client, text="write a chorus", language="zh")

    assert result == {
        "success": True,
        "lyrics": "generated lyrics",
        "song_title": "",
        "style_tags": "",
    }
    assert client.calls == [(
        "lyrics_generate",
        {
            "text": "write a chorus",
            "language": "zh",
            "mode": "write_full_song",
            "lyrics": "",
            "title": "",
        },
    )]


@pytest.mark.asyncio
async def test_generate_minimax_lyrics_response_prefers_current_top_level_contract():
    class CurrentLyricsClient:
        async def lyrics_generate(self, **kwargs):
            assert kwargs == {
                "text": "写一首校园歌曲",
                "language": "zh",
                "mode": "write_full_song",
                "lyrics": "",
                "title": "",
            }
            return {
                "lyrics": "[Verse]\n下课铃响起",
                "song_title": "下课以后",
                "style_tags": "Mandopop, Campus",
            }

    result = await generate_minimax_lyrics_response(
        client=CurrentLyricsClient(),
        text="写一首校园歌曲",
        language="zh",
    )

    assert result == {
        "success": True,
        "lyrics": "[Verse]\n下课铃响起",
        "song_title": "下课以后",
        "style_tags": "Mandopop, Campus",
    }
