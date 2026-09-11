from __future__ import annotations

import pytest

from services import episode_video_service


class FakeVideoSegmentDAO:
    rows = [
        {"segment_id": "seg_1", "episode_id": "ep_1", "sort_order": 1},
        {"segment_id": "seg_2", "episode_id": "ep_1", "sort_order": 2},
    ]
    created = None
    updated = None
    deleted = []

    @classmethod
    async def get_by_episode(cls, episode_id: str):
        return [row for row in cls.rows if row["episode_id"] == episode_id]

    @classmethod
    async def get_by_id(cls, segment_id: str):
        return next((row for row in cls.rows if row["segment_id"] == segment_id), None)

    @classmethod
    async def create(cls, **kwargs):
        cls.created = kwargs
        return {"segment_id": "seg_new", **kwargs}

    @classmethod
    async def update(cls, segment_id: str, **kwargs):
        cls.updated = {"segment_id": segment_id, **kwargs}
        if segment_id == "missing":
            return None
        return cls.updated

    @classmethod
    async def delete(cls, segment_id: str):
        cls.deleted.append(segment_id)
        return segment_id != "missing"


class FakeEpisodeDAO:
    project_id = "proj_1"

    @classmethod
    async def get_project_id(cls, episode_id: str):
        return cls.project_id


class FakeComposeService:
    started = None

    @staticmethod
    async def get_takes(episode_id: str):
        return [{"episode_id": episode_id, "takes": []}]

    @classmethod
    def start_compose(
        cls,
        episode_id: str,
        user_id: str,
        project_id: str,
        selections,
        audio_mode="reference_dubbing",
        timeline=None,
        subtitles=None,
        subtitle_style=None,
    ):
        cls.started = {
            "episode_id": episode_id,
            "user_id": user_id,
            "project_id": project_id,
            "selections": selections,
            "audio_mode": audio_mode,
        }
        if timeline is not None:
            cls.started["timeline"] = timeline
        if subtitles is not None:
            cls.started["subtitles"] = subtitles
        if subtitle_style is not None:
            cls.started["subtitle_style"] = subtitle_style
        return {
            "status": "running",
            "total": 3,
            "done": 1,
            "audio_mode": audio_mode,
        }

    @staticmethod
    def get_status(episode_id: str):
        return {"status": "running", "episode_id": episode_id}


def setup_function():
    FakeVideoSegmentDAO.created = None
    FakeVideoSegmentDAO.updated = None
    FakeVideoSegmentDAO.deleted = []
    FakeEpisodeDAO.project_id = "proj_1"
    FakeComposeService.started = None


async def test_list_video_segments_returns_dict_rows():
    result = await episode_video_service.list_video_segments(
        "ep_1",
        video_segment_dao=FakeVideoSegmentDAO,
    )

    assert result["success"] is True
    assert [row["segment_id"] for row in result["segments"]] == ["seg_1", "seg_2"]


async def test_require_episode_access_delegates_project_role_check():
    calls = []

    async def check(project_id, identity, role):
        calls.append((project_id, identity, role))

    project_id = await episode_video_service.require_episode_access(
        "ep_1",
        "user_1",
        "readonly",
        episode_dao=FakeEpisodeDAO,
        project_access_checker=check,
    )

    assert project_id == "proj_1"
    assert calls == [("proj_1", "user_1", "readonly")]


async def test_require_video_segment_access_rejects_missing_segment():
    async def check(project_id, identity, role):
        raise AssertionError("project access should not be checked")

    with pytest.raises(episode_video_service.VideoSegmentNotFound):
        await episode_video_service.require_video_segment_access(
            "missing",
            "user_1",
            video_segment_dao=FakeVideoSegmentDAO,
            episode_dao=FakeEpisodeDAO,
            project_access_checker=check,
        )


async def test_create_video_segment_passes_expected_fields():
    result = await episode_video_service.create_video_segment(
        "ep_1",
        sort_order=7,
        storyboard_item_id="shot_1",
        generation_mode="i2v",
        model="seedance",
        input_params={"duration": 5},
        video_segment_dao=FakeVideoSegmentDAO,
    )

    assert result["segment"]["segment_id"] == "seg_new"
    assert FakeVideoSegmentDAO.created == {
        "episode_id": "ep_1",
        "sort_order": 7,
        "storyboard_item_id": "shot_1",
        "generation_mode": "i2v",
        "model": "seedance",
        "input_params": {"duration": 5},
    }


async def test_update_video_segment_raises_when_missing():
    with pytest.raises(episode_video_service.VideoSegmentNotFound):
        await episode_video_service.update_video_segment(
            "missing",
            {"status": "done"},
            video_segment_dao=FakeVideoSegmentDAO,
        )


async def test_delete_video_segment_returns_success():
    result = await episode_video_service.delete_video_segment(
        "seg_1",
        video_segment_dao=FakeVideoSegmentDAO,
    )

    assert result == {"success": True}
    assert FakeVideoSegmentDAO.deleted == ["seg_1"]


async def test_start_episode_compose_uses_project_id_and_selections():
    result = await episode_video_service.start_episode_compose(
        "ep_1",
        "user_1",
        {"shot_1": "seg_1"},
        episode_dao=FakeEpisodeDAO,
        compose_service=FakeComposeService,
    )

    assert result == {
        "success": True,
        "status": "running",
        "total": 3,
        "done": 1,
        "audio_mode": "reference_dubbing",
    }
    assert FakeComposeService.started == {
        "episode_id": "ep_1",
        "user_id": "user_1",
        "project_id": "proj_1",
        "selections": {"shot_1": "seg_1"},
        "audio_mode": "reference_dubbing",
    }


async def test_start_episode_compose_preserves_explicit_video_original_mode():
    result = await episode_video_service.start_episode_compose(
        "ep_1",
        "user_1",
        None,
        "video_original",
        episode_dao=FakeEpisodeDAO,
        compose_service=FakeComposeService,
    )

    assert result["audio_mode"] == "video_original"
    assert FakeComposeService.started["audio_mode"] == "video_original"


async def test_start_episode_compose_forwards_edited_timeline():
    timeline = [
        {
            "clip_id": "seg_1-cut-2",
            "segment_id": "seg_1",
            "start_ms": 0,
            "duration_ms": 1800,
            "source_offset_ms": 1200,
        }
    ]

    await episode_video_service.start_episode_compose(
        "ep_1",
        "user_1",
        None,
        "reference_dubbing",
        timeline,
        episode_dao=FakeEpisodeDAO,
        compose_service=FakeComposeService,
    )

    assert FakeComposeService.started["timeline"] == timeline


async def test_start_episode_compose_forwards_subtitle_contract():
    subtitles = [{"cue_id": "cue-1", "text": "中文字幕", "start_ms": 0, "duration_ms": 1500}]
    subtitle_style = {"font_size": 42, "position": "bottom"}

    await episode_video_service.start_episode_compose(
        "ep_1",
        "user_1",
        None,
        "reference_dubbing",
        [],
        subtitles,
        subtitle_style,
        episode_dao=FakeEpisodeDAO,
        compose_service=FakeComposeService,
    )

    assert FakeComposeService.started["subtitles"] == subtitles
    assert FakeComposeService.started["subtitle_style"] == subtitle_style


async def test_start_episode_compose_raises_when_episode_missing():
    FakeEpisodeDAO.project_id = None

    with pytest.raises(episode_video_service.EpisodeNotFound):
        await episode_video_service.start_episode_compose(
            "missing",
            "user_1",
            None,
            episode_dao=FakeEpisodeDAO,
            compose_service=FakeComposeService,
        )
