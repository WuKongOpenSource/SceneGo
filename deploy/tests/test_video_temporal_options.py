import pytest
from pydantic import ValidationError

from schemas.generation import GenerateRequest


@pytest.mark.parametrize('window', [5, 9])
def test_video_temporal_windows_are_not_fps_controls(window):
    request = GenerateRequest(task_type='upscale', video_temporal_frames=window)
    assert request.video_temporal_frames == window
    assert request.target_fps == 60  # unrelated interpolation setting is untouched


@pytest.mark.parametrize('window', [1, 4, 8, 13, True, '9'])
def test_api_rejects_unreviewed_temporal_windows(window):
    with pytest.raises(ValidationError):
        GenerateRequest(task_type='upscale', video_temporal_frames=window)


def test_old_requests_do_not_add_a_temporal_override():
    request = GenerateRequest(task_type='upscale')
    assert request.video_temporal_frames is None
    assert 'video_temporal_frames' not in request.model_dump(exclude_unset=True)
