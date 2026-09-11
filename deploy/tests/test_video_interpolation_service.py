from __future__ import annotations

import pytest

from services.video_interpolation_service import (
    build_video_interpolation_workflow,
    normalize_target_fps,
    prepare_video_interpolation_task,
)


def test_build_video_interpolation_workflow_preserves_audio_and_target_fps():
    workflow = build_video_interpolation_workflow("input.mp4", 60)

    assert workflow["1"]["inputs"]["video"] == "input.mp4"
    assert workflow["1"]["inputs"]["force_rate"] == 60
    assert workflow["2"]["class_type"] == "VHS_VideoCombine"
    assert workflow["2"]["inputs"]["images"] == ["1", 0]
    assert workflow["2"]["inputs"]["audio"] == ["1", 2]
    assert workflow["2"]["inputs"]["frame_rate"] == 60
    assert all(
        node["class_type"] not in {"FrameInterpolationModelLoader", "FrameInterpolate"}
        for node in workflow.values()
    )


@pytest.mark.parametrize(
    ("value", "expected"),
    [(30, 30), (60, 60), (120, 120), (24, 60), (None, 60), ("bad", 60)],
)
def test_normalize_target_fps(value, expected):
    assert normalize_target_fps(value) == expected


@pytest.mark.asyncio
async def test_prepare_video_interpolation_task_attaches_file_and_workflow():
    class FakeTaskService:
        async def resolve_agent_file(self, param, file_ref, username):
            assert (param, file_ref, username) == ("video_filename", "/storage/input.mp4", "Yuan")
            return {
                "param": "video_filename",
                "filename": "input.mp4",
                "url": "/api/files/file_123/download",
            }

    task_data = {"video_filename": "/storage/input.mp4", "target_fps": 120}
    await prepare_video_interpolation_task(task_data, "Yuan", FakeTaskService())

    assert task_data["video_filename"] == "input.mp4"
    assert task_data["target_fps"] == 120
    assert task_data["workflow_name"] == "video_interpolation_vhs_portable"
    assert task_data["agent_files"][0]["filename"] == "input.mp4"
    assert task_data["workflow_json"]["2"]["inputs"]["frame_rate"] == 120


@pytest.mark.asyncio
async def test_prepare_video_interpolation_task_rejects_missing_video():
    class FakeTaskService:
        async def resolve_agent_file(self, *_args):
            return None

    with pytest.raises(ValueError, match="video_filename"):
        await prepare_video_interpolation_task({}, "Yuan", FakeTaskService())
