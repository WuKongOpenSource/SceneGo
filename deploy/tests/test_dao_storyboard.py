


import json

import pytest


def test_video_field_set_includes_prompt_context():
    from dao.creative.storyboard import StoryboardDAO

    fields = StoryboardDAO.FIELD_SETS["video"]
    assert "action_text" in fields
    assert "dialogue" in fields
    assert "image_prompt" in fields
    assert "video_prompt" in fields
    assert "script_segment_id" in fields
    assert "source_video_shot_no" in fields
    assert "video_script_block" in fields


@pytest.mark.parametrize("projection", ["audio", "audio_stage", "materials", "video"])
def test_workflow_projections_keep_script_identity_and_order(projection):
    from dao.creative.storyboard import StoryboardDAO

    columns = StoryboardDAO._select_columns(projection).split(", ")
    for field in ("item_id", "sort_order", "script_segment_id", "source_video_shot_no", "video_script_block"):
        assert field in columns
    assert len(columns) == len(set(columns))


async def test_create_storyboard_item(test_db):
    from dao_storyboard import StoryboardDAO
    result = await StoryboardDAO.create(
        episode_id="ep_test1", sort_order=1,
        dialogue="你好世界", image_prompt="一个少年站在阳光下"
    )
    assert result is not None
    assert result["item_id"].startswith("sb_")
    assert result["dialogue"] == "你好世界"
    assert result["audio_duration_ms"] is None


async def test_get_items_by_episode_sorted(test_db):
    from dao_storyboard import StoryboardDAO
    await StoryboardDAO.create(episode_id="ep_1", sort_order=2, dialogue="第二")
    await StoryboardDAO.create(episode_id="ep_1", sort_order=1, dialogue="第一")
    items = await StoryboardDAO.get_by_episode("ep_1")
    assert len(items) >= 2
    assert items[0]["sort_order"] <= items[1]["sort_order"]


async def test_update_audio_duration_writes_back(test_db):
    from dao_storyboard import StoryboardDAO
    created = await StoryboardDAO.create(
        episode_id="ep_1", sort_order=1, dialogue="测试"
    )
    updated = await StoryboardDAO.update(
        created["item_id"], audio_duration_ms=3200
    )
    assert updated["audio_duration_ms"] == 3200


async def test_update_serializes_audio_segments_as_jsonb(monkeypatch):
    from dao.creative import storyboard as storyboard_module

    class FakeDB:
        query = None
        values = None

        async def fetchrow(self, query, *values):
            self.query = query
            self.values = values
            return {"item_id": "sb_audio"}

    fake_db = FakeDB()
    monkeypatch.setattr(storyboard_module, "get_db_manager", lambda: fake_db)
    segments = [
        {
            "segmentId": "sb_audio:speech:1",
            "type": "speech",
            "durationMs": 1800,
            "audioUrl": "/audio/line-1.wav",
        },
        {
            "segmentId": "sb_audio:silence:2",
            "type": "silence",
            "durationMs": 700,
        },
    ]

    await storyboard_module.StoryboardDAO.update(
        "sb_audio",
        audio_segments=segments,
        planned_duration_ms=2500,
    )

    assert "audio_segments = $1::jsonb" in fake_db.query
    assert "planned_duration_ms = $2" in fake_db.query
    assert json.loads(fake_db.values[0]) == segments
    assert fake_db.values[1:] == (2500, "sb_audio")


async def test_reorder_items(test_db):
    from dao_storyboard import StoryboardDAO
    a = await StoryboardDAO.create(episode_id="ep_1", sort_order=1, dialogue="A")
    b = await StoryboardDAO.create(episode_id="ep_1", sort_order=2, dialogue="B")
    await StoryboardDAO.reorder("ep_1", [b["item_id"], a["item_id"]])
    items = await StoryboardDAO.get_by_episode("ep_1")
    ids_ordered = [i["item_id"] for i in items]
    assert ids_ordered.index(b["item_id"]) < ids_ordered.index(a["item_id"])


async def test_delete_item(test_db):
    from dao_storyboard import StoryboardDAO
    created = await StoryboardDAO.create(
        episode_id="ep_1", sort_order=1, dialogue="删除我"
    )
    await StoryboardDAO.delete(created["item_id"])
    result = await StoryboardDAO.get_by_id(created["item_id"])
    assert result is None
