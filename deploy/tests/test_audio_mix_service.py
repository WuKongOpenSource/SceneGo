"""Unit tests for audio_mix_service.

NOTE: These tests are adapted for the project's actual
`file_service.save_generated_file_to_db(content, file_type, user_id, source, ...)`
signature, which differs from the original plan's assumed signature. The
implementation in `audio_mix_service.py` reads bytes from the ffmpeg output,
probes duration via `_probe_duration_ms` (ffprobe wrapper), and passes them
through. Tests mock those helpers accordingly.
"""
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from audio_mix_service import (
    MixInput,
    MixResult,
    compute_mix_hash,
    mix_storyboard_audio,
)


def test_compute_mix_hash_is_stable_and_order_independent():
    a = compute_mix_hash(MixInput(
        dialogue_url="https://x/a.mp3", narration_url="https://x/b.mp3", sfx_url=None,
        dialogue_gain_db=0.0, narration_gain_db=-3.0, sfx_gain_db=-8.0,
    ))
    b = compute_mix_hash(MixInput(
        dialogue_url="https://x/a.mp3", narration_url="https://x/b.mp3", sfx_url=None,
        dialogue_gain_db=0.0, narration_gain_db=-3.0, sfx_gain_db=-8.0,
    ))
    assert a == b
    assert len(a) == 64


def test_compute_mix_hash_changes_when_gain_changes():
    a = compute_mix_hash(MixInput(
        dialogue_url="https://x/a.mp3", narration_url=None, sfx_url=None,
        dialogue_gain_db=0.0, narration_gain_db=-3.0, sfx_gain_db=-8.0,
    ))
    b = compute_mix_hash(MixInput(
        dialogue_url="https://x/a.mp3", narration_url=None, sfx_url=None,
        dialogue_gain_db=-1.5, narration_gain_db=-3.0, sfx_gain_db=-8.0,
    ))
    assert a != b


@pytest.mark.asyncio
async def test_mix_returns_cached_when_hash_matches(tmp_path, monkeypatch):
    item_id = "sb_test_01"
    cached_url = "/storage/audio/mixed_cached.mp3"

    inp = MixInput(
        dialogue_url="https://x/a.mp3", narration_url=None, sfx_url=None,
        dialogue_gain_db=0.0, narration_gain_db=-3.0, sfx_gain_db=-8.0,
    )
    expected_hash = compute_mix_hash(inp)

    fake_dao = MagicMock()
    fake_dao.get_by_id = AsyncMock(return_value={
        "item_id": item_id,
        "mixed_audio_url": cached_url,
        "mixed_audio_hash": expected_hash,
        "audio_duration_ms": 0,
        "episode_id": "ep_x",
    })
    fake_dao.update = AsyncMock(return_value={"item_id": item_id})

    with patch("audio_mix_service.StoryboardDAO", fake_dao), \
         patch("audio_mix_service._run_ffmpeg_mix", new=AsyncMock()) as mock_ff:
        result: MixResult = await mix_storyboard_audio(item_id, inp, user_id="user_test")

    assert result.cached is True
    assert result.mixed_audio_url == cached_url
    mock_ff.assert_not_called()


@pytest.mark.asyncio
async def test_mix_runs_ffmpeg_and_persists_when_no_cache(tmp_path):
    item_id = "sb_test_02"
    inp = MixInput(
        dialogue_url="https://x/a.mp3", narration_url="https://x/b.mp3", sfx_url=None,
        dialogue_gain_db=0.0, narration_gain_db=-3.0, sfx_gain_db=-8.0,
    )

    fake_dao = MagicMock()
    fake_dao.get_by_id = AsyncMock(return_value={
        "item_id": item_id, "mixed_audio_url": None, "mixed_audio_hash": None,
        "audio_duration_ms": 0, "episode_id": "ep_x",
    })
    fake_dao.update = AsyncMock(return_value={"item_id": item_id})

    fake_save = AsyncMock(return_value={
        "file_id": "f_new",
        "file_url": "/storage/audio/mixed_new.mp3",
        "file_path": "/tmp/x.mp3",
    })

    async def fake_ffmpeg(inputs, output_path):
        # Simulate ffmpeg writing the output file so .read() works
        with open(output_path, "wb") as f:
            f.write(b"\x00" * 16)
        return output_path

    with patch("audio_mix_service.StoryboardDAO", fake_dao), \
         patch("audio_mix_service._download", new=AsyncMock()), \
         patch("audio_mix_service._run_ffmpeg_mix", new=fake_ffmpeg), \
         patch("audio_mix_service._probe_duration_ms", new=AsyncMock(return_value=4500)), \
         patch("audio_mix_service.save_generated_file_to_db", new=fake_save):
        result: MixResult = await mix_storyboard_audio(item_id, inp, user_id="user_test")

    assert result.cached is False
    assert result.mixed_audio_url == "/storage/audio/mixed_new.mp3"
    assert result.duration_ms == 4500
    fake_dao.update.assert_called_once()
    args, kwargs = fake_dao.update.call_args
    assert kwargs.get("mixed_audio_url") == "/storage/audio/mixed_new.mp3"
    assert kwargs.get("mixed_audio_hash") == compute_mix_hash(inp)


@pytest.mark.asyncio
async def test_mix_passes_through_when_only_one_track():
    item_id = "sb_test_03"
    inp = MixInput(
        dialogue_url="https://x/a.mp3", narration_url=None, sfx_url=None,
        dialogue_gain_db=0.0, narration_gain_db=-3.0, sfx_gain_db=-8.0,
    )

    fake_dao = MagicMock()
    fake_dao.get_by_id = AsyncMock(return_value={
        "item_id": item_id, "mixed_audio_url": None, "mixed_audio_hash": None,
        "audio_duration_ms": 0, "episode_id": "ep_x",
    })
    fake_dao.update = AsyncMock(return_value={"item_id": item_id})

    async def fake_ffmpeg(inputs, output_path):
        with open(output_path, "wb") as f:
            f.write(b"\x00" * 16)
        return output_path

    with patch("audio_mix_service.StoryboardDAO", fake_dao), \
         patch("audio_mix_service._download", new=AsyncMock()), \
         patch("audio_mix_service._run_ffmpeg_mix", new=fake_ffmpeg) as mock_ff, \
         patch("audio_mix_service._probe_duration_ms", new=AsyncMock(return_value=3000)), \
         patch("audio_mix_service.save_generated_file_to_db",
               new=AsyncMock(return_value={"file_id": "f", "file_url": "/storage/audio/x.mp3", "file_path": "/tmp/x"})):
        result = await mix_storyboard_audio(item_id, inp, user_id="user_test")

    assert result.cached is False
    assert result.mixed_audio_url == "/storage/audio/x.mp3"


@pytest.mark.asyncio
async def test_mix_raises_when_all_tracks_empty():
    inp = MixInput(
        dialogue_url=None, narration_url=None, sfx_url=None,
        dialogue_gain_db=0.0, narration_gain_db=-3.0, sfx_gain_db=-8.0,
    )
    with pytest.raises(ValueError, match="at least one"):
        await mix_storyboard_audio("sb_test_04", inp, user_id="user_test")


@pytest.mark.asyncio
async def test_mix_propagates_ffmpeg_failure():
    item_id = "sb_test_05"
    inp = MixInput(
        dialogue_url="https://x/a.mp3", narration_url="https://x/b.mp3", sfx_url=None,
        dialogue_gain_db=0.0, narration_gain_db=-3.0, sfx_gain_db=-8.0,
    )
    fake_dao = MagicMock()
    fake_dao.get_by_id = AsyncMock(return_value={
        "item_id": item_id, "mixed_audio_url": None, "mixed_audio_hash": None,
        "audio_duration_ms": 0, "episode_id": "ep_x",
    })

    with patch("audio_mix_service.StoryboardDAO", fake_dao), \
         patch("audio_mix_service._download", new=AsyncMock()), \
         patch("audio_mix_service._run_ffmpeg_mix",
               new=AsyncMock(side_effect=RuntimeError("ffmpeg not found"))):
        with pytest.raises(RuntimeError, match="ffmpeg"):
            await mix_storyboard_audio(item_id, inp, user_id="user_test")
