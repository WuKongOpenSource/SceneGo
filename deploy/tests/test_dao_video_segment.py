


import pytest


async def test_create_video_segment(test_db):
    from dao_video_segment import VideoSegmentDAO
    result = await VideoSegmentDAO.create(
        episode_id="ep_test1", sort_order=1,
        generation_mode="i2v", model="wan"
    )
    assert result is not None
    assert result["segment_id"].startswith("seg_")
    assert result["generation_mode"] == "i2v"


async def test_get_by_episode(test_db):
    from dao_video_segment import VideoSegmentDAO
    await VideoSegmentDAO.create(episode_id="ep_1", sort_order=1)
    await VideoSegmentDAO.create(episode_id="ep_1", sort_order=2)
    results = await VideoSegmentDAO.get_by_episode("ep_1")
    assert len(results) >= 2


async def test_update_status(test_db):
    from dao_video_segment import VideoSegmentDAO
    created = await VideoSegmentDAO.create(episode_id="ep_1", sort_order=1)
    updated = await VideoSegmentDAO.update(
        created["segment_id"], status="completed",
        video_url="/uploads/video/test.mp4", duration_ms=5000
    )
    assert updated["status"] == "completed"
    assert updated["video_url"] == "/uploads/video/test.mp4"
    assert updated["duration_ms"] == 5000


async def test_delete_segment(test_db):
    from dao_video_segment import VideoSegmentDAO
    created = await VideoSegmentDAO.create(episode_id="ep_1", sort_order=1)
    await VideoSegmentDAO.delete(created["segment_id"])
    result = await VideoSegmentDAO.get_by_id(created["segment_id"])
    assert result is None
