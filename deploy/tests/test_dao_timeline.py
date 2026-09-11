


import pytest


async def test_create_timeline_track(test_db):
    from dao_timeline import TimelineDAO
    result = await TimelineDAO.create(
        episode_id="ep_test1", track_type="video",
        track_name="视频轨道", sort_order=0
    )
    assert result is not None
    assert result["track_id"].startswith("track_")
    assert result["track_type"] == "video"


async def test_get_by_episode(test_db):
    from dao_timeline import TimelineDAO
    await TimelineDAO.create(episode_id="ep_1", track_type="video", track_name="视频")
    await TimelineDAO.create(episode_id="ep_1", track_type="audio", track_name="音频")
    results = await TimelineDAO.get_by_episode("ep_1")
    assert len(results) >= 2


async def test_update_items(test_db):
    from dao_timeline import TimelineDAO
    created = await TimelineDAO.create(
        episode_id="ep_1", track_type="video", track_name="轨道"
    )
    clips = [{"id": "c1", "start": 0, "duration": 3000}]
    updated = await TimelineDAO.update(created["track_id"], items=clips)
    assert len(updated["items"]) == 1
    assert updated["items"][0]["id"] == "c1"
