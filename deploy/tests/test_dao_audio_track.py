


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


async def test_create_track_is_idempotent_for_the_same_source_task(test_db):
    from dao_audio_track import AudioTrackDAO

    first = await AudioTrackDAO.create(
        episode_id="ep_task_idempotent",
        track_type="bgm",
        name="第一次完成",
        audio_url="/storage/audio/generated.mp3",
        generation_params={"task_id": "music-task-1"},
    )
    second = await AudioTrackDAO.create(
        episode_id="ep_task_idempotent",
        track_type="bgm",
        name="重复回调",
        audio_url="/storage/audio/generated.mp3",
        generation_params={"task_id": "music-task-1"},
    )

    assert second["track_id"] == first["track_id"]
    tracks = await AudioTrackDAO.get_by_episode("ep_task_idempotent")
    assert [track["track_id"] for track in tracks].count(first["track_id"]) == 1


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
