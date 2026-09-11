from __future__ import annotations

import pytest

from services import script_timeline_service


class FakeEpisodeScriptSegmentDAO:
    by_script_calls = []
    by_episode_calls = []
    batch_replace_calls = []
    delete_calls = []

    @classmethod
    async def list_by_script(cls, episode_id, script_id):
        cls.by_script_calls.append((episode_id, script_id))
        return [{"segment_id": "seg_1", "script_id": script_id}]

    @classmethod
    async def list_by_episode(cls, episode_id):
        cls.by_episode_calls.append(episode_id)
        return [{"segment_id": "seg_all"}]

    @classmethod
    async def batch_replace(cls, episode_id, script_id, segments):
        cls.batch_replace_calls.append((episode_id, script_id, segments))
        return [{"segment_id": "seg_new", **segments[0]}] if segments else []

    @classmethod
    async def delete_by_script(cls, episode_id, script_id):
        cls.delete_calls.append((episode_id, script_id))
        return 2


class FakeEpisodeScriptDAO:
    scripts = [
        {"script_id": "script_1", "episode_id": "ep_1", "file_name": "a", "sort_order": 0},
        {"script_id": "script_2", "episode_id": "ep_1", "file_name": "b", "sort_order": 1},
    ]
    saved = None
    created = None
    source_created = None
    updated = None
    deleted = []

    @classmethod
    async def get_by_episode(cls, episode_id):
        for script in cls.scripts:
            if script["episode_id"] == episode_id:
                return script
        return None

    @classmethod
    async def save_or_update(cls, **kwargs):
        cls.saved = kwargs
        if kwargs["episode_id"] == "fail":
            return None
        return {"script_id": "script_saved", **kwargs}

    @classmethod
    async def list_by_episode(cls, episode_id):
        return [script for script in cls.scripts if script["episode_id"] == episode_id]

    @staticmethod
    async def get_next_sort_order(episode_id):
        return 9

    @classmethod
    async def create(cls, **kwargs):
        cls.created = kwargs
        if kwargs["episode_id"] == "fail":
            return None
        return {"script_id": "script_new", **kwargs}

    @classmethod
    async def get_or_create_by_source(cls, episode_id, **kwargs):
        cls.source_created = {"episode_id": episode_id, **kwargs}
        return ({"script_id": "script_source", "episode_id": episode_id, **kwargs}, False)

    @classmethod
    async def update(cls, script_id, **kwargs):
        cls.updated = {"script_id": script_id, **kwargs}
        if script_id == "missing":
            return None
        return cls.updated

    @classmethod
    async def delete_by_id(cls, script_id):
        cls.deleted.append(script_id)
        return script_id != "missing"


class FakeTimelineDAO:
    tracks = [{"track_id": "track_1", "episode_id": "ep_1", "track_type": "video"}]
    created = None
    updated = None

    @classmethod
    async def get_by_episode(cls, episode_id):
        return [track for track in cls.tracks if track["episode_id"] == episode_id]

    @classmethod
    async def create(cls, **kwargs):
        cls.created = kwargs
        if kwargs["episode_id"] == "fail":
            return None
        return {"track_id": "track_new", **kwargs}

    @classmethod
    async def update(cls, track_id, **kwargs):
        cls.updated = {"track_id": track_id, **kwargs}
        if track_id == "missing":
            return None
        return cls.updated


def setup_function():
    FakeEpisodeScriptSegmentDAO.by_script_calls = []
    FakeEpisodeScriptSegmentDAO.by_episode_calls = []
    FakeEpisodeScriptSegmentDAO.batch_replace_calls = []
    FakeEpisodeScriptSegmentDAO.delete_calls = []
    FakeEpisodeScriptDAO.saved = None
    FakeEpisodeScriptDAO.created = None
    FakeEpisodeScriptDAO.source_created = None
    FakeEpisodeScriptDAO.updated = None
    FakeEpisodeScriptDAO.deleted = []
    FakeTimelineDAO.created = None
    FakeTimelineDAO.updated = None


async def test_list_script_segments_uses_script_filter_when_present():
    result = await script_timeline_service.list_script_segments(
        "ep_1",
        "script_1",
        episode_script_segment_dao=FakeEpisodeScriptSegmentDAO,
    )

    assert result["segments"] == [{"segment_id": "seg_1", "script_id": "script_1"}]
    assert FakeEpisodeScriptSegmentDAO.by_script_calls == [("ep_1", "script_1")]


async def test_batch_save_script_segments_delegates_replace():
    result = await script_timeline_service.batch_save_script_segments(
        "ep_1",
        None,
        [{"source_text": "hello"}],
        episode_script_segment_dao=FakeEpisodeScriptSegmentDAO,
    )

    assert result["success"] is True
    assert result["segments"][0]["source_text"] == "hello"


async def test_update_primary_script_defaults_missing_text_to_empty_string():
    result = await script_timeline_service.update_primary_script(
        "ep_1",
        original_content=None,
        adapted_script=None,
        metadata={"a": 1},
        episode_script_dao=FakeEpisodeScriptDAO,
    )

    assert result["script"]["script_id"] == "script_saved"
    assert FakeEpisodeScriptDAO.saved["original_content"] == ""
    assert FakeEpisodeScriptDAO.saved["adapted_script"] == ""


async def test_create_script_file_resolves_sort_order():
    result = await script_timeline_service.create_script_file(
        "ep_1",
        file_name="story.txt",
        original_content="raw",
        adapted_script="script",
        sort_order=None,
        metadata=None,
        episode_script_dao=FakeEpisodeScriptDAO,
    )

    assert result["script"]["script_id"] == "script_new"
    assert FakeEpisodeScriptDAO.created["sort_order"] == 9


async def test_create_script_file_is_idempotent_for_external_source():
    result = await script_timeline_service.create_script_file(
        "ep_1",
        file_name="reverse candidate",
        original_content="raw",
        adapted_script="script",
        sort_order=None,
        metadata={"source": "reverse"},
        source_type="video_reverse",
        source_id="reverse_1",
        episode_script_dao=FakeEpisodeScriptDAO,
    )

    assert result["script"]["script_id"] == "script_source"
    assert result["created"] is False
    assert FakeEpisodeScriptDAO.created is None
    assert FakeEpisodeScriptDAO.source_created == {
        "episode_id": "ep_1",
        "source_type": "video_reverse",
        "source_id": "reverse_1",
        "file_name": "reverse candidate",
        "original_content": "raw",
        "adapted_script": "script",
        "sort_order": 9,
        "metadata": {"source": "reverse"},
    }


async def test_create_script_file_requires_complete_source_identity():
    with pytest.raises(script_timeline_service.ScriptFileCreateFailed):
        await script_timeline_service.create_script_file(
            "ep_1",
            file_name="reverse candidate",
            original_content="raw",
            adapted_script="script",
            sort_order=1,
            metadata=None,
            source_type="video_reverse",
            source_id=None,
            episode_script_dao=FakeEpisodeScriptDAO,
        )


async def test_update_script_file_raises_when_missing():
    with pytest.raises(script_timeline_service.ScriptFileNotFound):
        await script_timeline_service.update_script_file(
            "missing",
            file_name=None,
            original_content=None,
            adapted_script=None,
            metadata=None,
            episode_script_dao=FakeEpisodeScriptDAO,
        )


async def test_delete_script_file_returns_success():
    result = await script_timeline_service.delete_script_file(
        "script_1",
        episode_script_dao=FakeEpisodeScriptDAO,
    )

    assert result == {"success": True}
    assert FakeEpisodeScriptDAO.deleted == ["script_1"]


async def test_list_timeline_tracks_returns_dict_rows():
    result = await script_timeline_service.list_timeline_tracks("ep_1", timeline_dao=FakeTimelineDAO)

    assert result["tracks"] == [{"track_id": "track_1", "episode_id": "ep_1", "track_type": "video"}]


async def test_create_timeline_track_passes_expected_fields():
    result = await script_timeline_service.create_timeline_track(
        "ep_1",
        track_type="video",
        track_name="main",
        sort_order=2,
        items=[{"id": "clip_1"}],
        timeline_dao=FakeTimelineDAO,
    )

    assert result["track"]["track_id"] == "track_new"
    assert FakeTimelineDAO.created == {
        "episode_id": "ep_1",
        "track_type": "video",
        "track_name": "main",
        "sort_order": 2,
        "items": [{"id": "clip_1"}],
    }


async def test_update_timeline_track_raises_when_missing():
    with pytest.raises(script_timeline_service.TimelineTrackNotFound):
        await script_timeline_service.update_timeline_track(
            "missing",
            {"track_name": "new"},
            timeline_dao=FakeTimelineDAO,
        )
