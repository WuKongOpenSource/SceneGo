from pathlib import Path

import pytest
from PIL import Image

from file_optimization import FileOptimizationService


def test_video_thumbnail_positions_are_early_and_bounded():
    assert FileOptimizationService._video_thumbnail_positions(0.2) == [0.05]
    assert FileOptimizationService._video_thumbnail_positions(6.0) == [
        0.05,
        0.25,
        0.5,
        1.0,
        1.5,
        2.0,
        3.0,
        5.0,
    ]


def test_frame_visibility_rejects_black_but_keeps_dark_detail(tmp_path):
    black = tmp_path / "black.jpg"
    visible = tmp_path / "visible.jpg"
    Image.new("RGB", (64, 64), color=(0, 0, 0)).save(black)
    frame = Image.new("RGB", (64, 64), color=(0, 0, 0))
    for x in range(24, 40):
        for y in range(24, 40):
            frame.putpixel((x, y), (80, 80, 80))
    frame.save(visible)

    assert FileOptimizationService._frame_has_visible_content(str(black)) is False
    assert FileOptimizationService._frame_has_visible_content(str(visible)) is True


@pytest.mark.asyncio
async def test_create_video_thumbnail_selects_first_non_black_frame(tmp_path, monkeypatch):
    output = tmp_path / "thumb.jpg"
    sampled = []

    monkeypatch.setattr(FileOptimizationService, "_probe_video_duration", lambda _path: 2.0)

    def fake_extract(_video_path: str, output_path: str, position: float):
        sampled.append(position)
        color = (40, 50, 60) if position >= 0.5 else (0, 0, 0)
        Image.new("RGB", (1280, 720), color=color).save(output_path, format="JPEG")

    monkeypatch.setattr(FileOptimizationService, "_extract_video_frame", fake_extract)

    result = await FileOptimizationService.create_video_thumbnail(
        "clip.mp4",
        str(output),
        max_size=(640, 360),
    )

    assert result["success"] is True
    assert result["non_black"] is True
    assert result["time_position"] == 0.5
    assert sampled == [0.05, 0.25, 0.5]
    with Image.open(output) as image:
        assert image.size == (640, 360)
