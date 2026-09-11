














from unittest.mock import AsyncMock, MagicMock

import pytest

import dao_character_voice
from dao_character_voice import CharacterVoiceDAO


def _install_fake_db(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    fake_db = MagicMock()
    fake_db.execute = AsyncMock(return_value="UPDATE 1")
    fake_db.fetchrow = AsyncMock(return_value=None)
    monkeypatch.setattr(dao_character_voice, "get_db_manager", lambda: fake_db)
    return fake_db


async def test_update_sample_audio_url_issues_single_field_update(monkeypatch):
    fake_db = _install_fake_db(monkeypatch)
    voice_id = "11111111-2222-3333-4444-555555555555"
    new_url = "/storage/audio/preview_xyz.mp3"

    result = await CharacterVoiceDAO.update_sample_audio_url(voice_id, new_url)

    assert result is None, "single-field write back should not return a row"
    assert fake_db.execute.await_count == 1, "expected exactly one execute() call"
    assert fake_db.fetchrow.await_count == 0, (
        "should NOT use fetchrow/RETURNING — that re-reads other columns and "
        "defeats the point of a single-field write"
    )

    sql, *args = fake_db.execute.await_args.args
    normalized = " ".join(sql.split()).lower()

    assert "update character_voices" in normalized
    assert "set sample_audio_url = $1" in normalized
    assert "updated_at = now()" in normalized
    assert "where voice_id = $2::uuid" in normalized
    assert "voice_name" not in normalized, "must not touch voice_name"
    assert "voice_params" not in normalized, "must not touch voice_params"
    assert "returning" not in normalized, "should be a fire-and-forget UPDATE"

    assert args == [new_url, voice_id], (
        f"positional args must be (sample_audio_url, voice_id); got {args!r}"
    )


async def test_update_sample_audio_url_noop_when_db_unavailable(monkeypatch):

    monkeypatch.setattr(dao_character_voice, "get_db_manager", lambda: None)

    result = await CharacterVoiceDAO.update_sample_audio_url(
        "11111111-2222-3333-4444-555555555555",
        "/storage/audio/preview_xyz.mp3",
    )

    assert result is None
