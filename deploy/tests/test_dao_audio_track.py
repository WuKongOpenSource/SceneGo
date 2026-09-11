


import pytest


async def test_create_bgm_track(test_db):
    from dao_audio_track import AudioTrackDAO
    result = await AudioTrackDAO.create(
        episode_id="ep_test1", track_type="bgm",
        name="紧张悬疑BGM", duration_ms=30000
    )
    assert result is not None
    assert result["track_id"].startswith("atrk_")
    assert result["track_type"] == "bgm"


async def test_get_tracks_by_episode(test_db):
    from dao_audio_track import AudioTrackDAO
    await AudioTrackDAO.create(episode_id="ep_1", track_type="bgm", name="BGM1")
    await AudioTrackDAO.create(episode_id="ep_1", track_type="sfx_global", name="音效")
    results = await AudioTrackDAO.get_by_episode("ep_1")
    assert len(results) >= 2


async def test_update_track_range(test_db):
    from dao_audio_track import AudioTrackDAO
    created = await AudioTrackDAO.create(
        episode_id="ep_1", track_type="bgm", name="BGM"
    )
    updated = await AudioTrackDAO.update(
        created["track_id"],
        start_item_id="sb_001", end_item_id="sb_005",
        duration_ms=60000
    )
    assert updated["start_item_id"] == "sb_001"
    assert updated["end_item_id"] == "sb_005"
    assert updated["duration_ms"] == 60000


async def test_delete_track(test_db):
    from dao_audio_track import AudioTrackDAO
    created = await AudioTrackDAO.create(
        episode_id="ep_1", track_type="bgm", name="临时"
    )
    await AudioTrackDAO.delete(created["track_id"])
    result = await AudioTrackDAO.get_by_id(created["track_id"])
    assert result is None
