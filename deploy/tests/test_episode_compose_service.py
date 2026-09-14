import os
from datetime import datetime
from pathlib import Path

import pytest

from services import episode_compose_service


@pytest.fixture(autouse=True)
def isolate_global_audio_tracks(monkeypatch):
    async def list_audio_tracks(_episode_id):
        return []

    monkeypatch.setattr(
        episode_compose_service.EpisodeComposeDAO,
        "list_audio_tracks",
        list_audio_tracks,
    )


def test_compose_output_size_presets_for_mobile_ratios():
    assert episode_compose_service._output_size_for_source(720, 1280) == (1080, 1920, "9:16")
    assert episode_compose_service._output_size_for_source(768, 1024) == (1080, 1440, "3:4")
    assert episode_compose_service._output_size_for_source(1024, 1024) == (1080, 1080, "1:1")
    assert episode_compose_service._output_size_for_source(1920, 1080) == (1920, 1080, "16:9")


def test_global_audio_timeline_normalizes_clip_boundaries_and_bgm_fades():
    timeline = episode_compose_service._global_audio_timeline(
        {
            "track_type": "bgm",
            "generation_params": {
                "timeline": {
                    "startMs": 7_000,
                    "sourceOffsetMs": 1_000,
                    "durationMs": 6_000,
                    "fadeInMs": 1_000,
                    "fadeOutMs": 1_500,
                    "volume": 0,
                }
            },
        },
        source_duration_ms=10_000,
        episode_duration_ms=8_000,
    )

    assert timeline == {
        "start_ms": 7_000,
        "source_offset_ms": 1_000,
        "duration_ms": 6_000,
        "fade_in_ms": 1_000,
        "fade_out_ms": 1_500,
        "volume": 0,
    }


def test_global_audio_timeline_applies_fades_to_sound_effects():
    timeline = episode_compose_service._global_audio_timeline(
        {
            "track_type": "sfx_global",
            "generation_params": {
                "timeline": {
                    "fadeInMs": 1_000,
                    "fadeOutMs": 1_000,
                }
            },
        },
        source_duration_ms=3_000,
        episode_duration_ms=8_000,
    )

    assert timeline["fade_in_ms"] == 1000
    assert timeline["fade_out_ms"] == 1000
    assert timeline["volume"] == 1


def test_editor_timeline_normalizes_order_bounds_and_source_offsets():
    normalized = episode_compose_service._normalize_editor_timeline(
        [
            {"segment_id": "seg_2", "start_ms": 5000, "duration_ms": 0},
            {
                "clip_id": "seg_1-cut",
                "segment_id": "seg_1",
                "start_ms": 0,
                "duration_ms": 1800,
                "source_offset_ms": 1200,
            },
            {"segment_id": "", "duration_ms": 1000},
        ]
    )

    assert normalized == [
        {
            "clip_id": "seg_1-cut",
            "segment_id": "seg_1",
            "start_ms": 0,
            "duration_ms": 1800,
            "source_offset_ms": 1200,
            "source_duration_ms": 0,
            "source_identity": "",
            "transition_after": "cut",
            "transition_duration_ms": 0,
            "_index": 1,
        },
        {
            "clip_id": "seg_2-cut-1",
            "segment_id": "seg_2",
            "start_ms": 5000,
            "duration_ms": 100,
            "source_offset_ms": 0,
            "source_duration_ms": 0,
            "source_identity": "",
            "transition_after": "cut",
            "transition_duration_ms": 0,
            "_index": 0,
        },
    ]


def test_editor_subtitle_normalization_bounds_timeline_style_and_text():
    cues = episode_compose_service._normalize_editor_subtitles(
        [
            {"cue_id": "late", "text": "越界", "start_ms": 9999, "duration_ms": 500},
            {"cue_id": "ok", "text": "  第一行\n第二行  ", "start_ms": -5, "duration_ms": 5000},
            {"cue_id": "empty", "text": "   ", "start_ms": 0, "duration_ms": 1000},
        ],
        3000,
    )
    assert cues == [{
        "cue_id": "ok",
        "text": "第一行\n第二行",
        "start_ms": 0,
        "duration_ms": 3000,
    }]
    style = episode_compose_service._normalize_subtitle_style({
        "font_size": 999,
        "text_color": "#12abef",
        "background_opacity": -1,
        "position": "outside",
    })
    assert style == {
        "font_size": 96,
        "text_color": "#12ABEF",
        "background_color": "#000000",
        "background_opacity": 0.0,
        "position": "bottom",
    }
    many = episode_compose_service._normalize_editor_subtitles(
        [
            {"cue_id": f"cue-{index}", "text": "字" * 600, "start_ms": 0, "duration_ms": 1000}
            for index in range(501)
        ],
        3000,
    )
    assert len(many) == 500
    assert all(len(cue["text"]) == 500 for cue in many)


@pytest.mark.asyncio
@pytest.mark.parametrize("dimensions,coordinates,expected", [
    ((1920, 1080), {}, None),
    ((1920, 1080), {"position_x": 25, "position_y": 70}, r"{\an8\pos(480.000,756.000)}"),
    ((1080, 1920), {"position_x": 25, "position_y": 70}, r"{\an8\pos(270.000,1344.000)}"),
])
async def test_editor_subtitles_are_rendered_with_ass_filter(monkeypatch, tmp_path, dimensions, coordinates, expected):
    video = tmp_path / "final.mp4"
    video.write_bytes(b"video")
    fonts_dir = tmp_path / "fonts"
    fonts_dir.mkdir()
    commands = []

    async def fake_run(cmd):
        commands.append(cmd)
        Path(cmd[-1]).write_bytes(b"subtitled")
        return 0, "", ""

    monkeypatch.setattr(episode_compose_service, "_run", fake_run)
    monkeypatch.setattr(episode_compose_service, "_SUBTITLE_FONTS_DIR", str(fonts_dir))
    count = await episode_compose_service._burn_editor_subtitles(
        [{
            "cue_id": "cue-1",
            "text": "字幕{\\danger}\n第二行",
            "start_ms": 500,
            "duration_ms": 1500,
        }],
        {"position": "top", "font_size": 48, **coordinates},
        str(video),
        4.0,
        str(tmp_path),
        *dimensions,
    )

    assert count == 1
    assert video.read_bytes() == b"subtitled"
    filter_value = commands[0][commands[0].index("-vf") + 1]
    assert "ass=filename=" in filter_value
    assert "fontsdir=" in filter_value
    ass_text = (tmp_path / "editor_subtitles.ass").read_text(encoding="utf-8-sig")
    assert f"PlayResX: {dimensions[0]}" in ass_text
    if expected:
        assert expected in ass_text
    else:
        assert r"\pos(" not in ass_text
    assert "Dialogue: 0,0:00:00.50,0:00:02.00" in ass_text
    assert "字幕（" in ass_text
    assert r"\N第二行" in ass_text


@pytest.mark.asyncio
@pytest.mark.parametrize('dimensions', [(1920, 1080), (1080, 1920)])
async def test_cue_styles_export_independently_without_global_position_or_font_leak(monkeypatch, tmp_path, dimensions):
    video = tmp_path / 'final.mp4'
    video.write_bytes(b'video')

    async def fake_run(cmd):
        Path(cmd[-1]).write_bytes(b'subtitled')
        return 0, '', ''

    monkeypatch.setattr(episode_compose_service, '_run', fake_run)
    cues = [
        {'cue_id': 'title', 'text': 'Title', 'start_ms': 0, 'duration_ms': 1000,
         'style': {'position': 'center', 'position_x': 25, 'position_y': 50, 'font_size': 72}},
        {'cue_id': 'dialogue', 'text': 'Dialogue', 'start_ms': 1000, 'duration_ms': 1000, 'style': {}},
        {'cue_id': 'legacy', 'text': 'Legacy API', 'start_ms': 2000, 'duration_ms': 1000},
    ]
    assert await episode_compose_service._burn_editor_subtitles(cues, {'position': 'top', 'font_size': 90},
        str(video), 3, str(tmp_path), *dimensions) == 3
    lines = (tmp_path / 'editor_subtitles.ass').read_text(encoding='utf-8-sig').splitlines()
    title = next(line.split(',') for line in lines if line.startswith('Style: Cue0,'))
    dialogue = next(line.split(',') for line in lines if line.startswith('Style: Cue1,'))
    assert (title[2], title[18]) == ('72', '5')
    assert (dialogue[2], dialogue[18]) == ('50', '2')
    events = [line for line in lines if line.startswith('Dialogue:')]
    assert f"Cue0,,0,0,0,,{{\\an5\\pos({dimensions[0] * .25:.3f},{dimensions[1] * .5:.3f})}}Title" in events[0]
    assert events[1].endswith('Cue1,,0,0,0,,Dialogue')
    assert events[2].endswith('Default,,0,0,0,,Legacy API')
    assert r'\pos' not in events[1]


def test_per_cue_style_validation_is_bounded_and_does_not_mutate_neighbors():
    styles = [{'position': 'bad', 'font_size': 999, 'position_x': -10, 'position_y': float('inf'),
               'text_color': 'injected', 'background_opacity': -1}, {}]
    cues = episode_compose_service._normalize_editor_subtitles([
        {'cue_id': str(index), 'text': 'text', 'start_ms': index * 1000, 'duration_ms': 1000, 'style': style}
        for index, style in enumerate(styles)
    ], 3000)
    assert cues[0]['style'] == {'position': 'bottom', 'font_size': 96, 'position_x': 0,
        'text_color': '#FFFFFF', 'background_color': '#000000', 'background_opacity': 0}
    assert cues[1]['style'] == episode_compose_service._normalize_subtitle_style(None)
    assert styles[0]['font_size'] == 999


@pytest.mark.asyncio
async def test_get_shots_uses_edited_cut_order_and_allows_repeated_source(monkeypatch):
    async def fake_list_shot_takes(_episode_id):
        return [
            {
                "item_id": "shot_1",
                "audio_url": "/storage/audio/one.mp3",
                "audio_urls": ["/storage/audio/one.mp3"],
                "audio_segments": [],
                "sfx_audio_url": None,
                "audio_ms": 4000,
                "takes": [{"segment_id": "seg_1", "video_url": "/storage/video/one.mp4"}],
            },
            {
                "item_id": "shot_2",
                "audio_url": None,
                "audio_urls": [],
                "audio_segments": [],
                "sfx_audio_url": None,
                "audio_ms": 0,
                "takes": [{"segment_id": "seg_2", "video_url": "/storage/video/two.mp4"}],
            },
        ]

    monkeypatch.setattr(episode_compose_service, "_list_shot_takes", fake_list_shot_takes)
    timeline = [
        {"clip_id": "two", "segment_id": "seg_2", "start_ms": 0, "duration_ms": 900},
        {"clip_id": "one-b", "segment_id": "seg_1", "start_ms": 900, "duration_ms": 1200, "source_offset_ms": 2000},
        {"clip_id": "one-a", "segment_id": "seg_1", "start_ms": 2100, "duration_ms": 1000},
    ]
    shots = await episode_compose_service._get_shots("ep_1", timeline=timeline)

    assert [shot["clip_id"] for shot in shots] == ["two", "one-b", "one-a"]
    assert shots[1]["source_offset_ms"] == 2000
    assert shots[1]["duration_ms"] == 1200
    assert shots[1]["audio_url"] == "/storage/audio/one.mp3"


def test_editor_timeline_normalizes_video_transitions():
    normalized = episode_compose_service._normalize_editor_timeline([
        {
            "segment_id": "fade",
            "duration_ms": 2_000,
            "transition_after": "fade",
            "transition_duration_ms": 99_000,
        },
        {
            "segment_id": "black",
            "duration_ms": 2_000,
            "transition_after": "black",
            "transition_duration_ms": 50,
        },
        {"segment_id": "invalid", "duration_ms": 2_000, "transition_after": "wipe"},
    ])

    assert [(item["transition_after"], item["transition_duration_ms"]) for item in normalized] == [
        ("fade", 3_000),
        ("black", 100),
        ("cut", 0),
    ]


def test_video_transition_filter_fades_to_and_from_black():
    result = episode_compose_service._video_transition_filter(
        "scale=1920:1080",
        4.0,
        fade_in_ms=500,
        fade_out_ms=750,
    )

    assert "fade=t=in:st=0:d=0.500" in result
    assert "fade=t=out:st=3.250:d=0.750" in result


@pytest.mark.asyncio
async def test_get_shots_rejects_missing_timeline_source(monkeypatch):
    async def fake_list_shot_takes(_episode_id):
        return []

    monkeypatch.setattr(episode_compose_service, "_list_shot_takes", fake_list_shot_takes)
    with pytest.raises(RuntimeError, match="foreign"):
        await episode_compose_service._get_shots(
            "ep_1",
            timeline=[{
                "clip_id": "foreign",
                "segment_id": "not-in-episode",
                "start_ms": 0,
                "duration_ms": 5000,
            }],
        )


@pytest.mark.asyncio
async def test_preflight_corrects_only_stale_full_source_duration(monkeypatch, tmp_path):
    video = tmp_path / "video" / "one.mp4"
    video.parent.mkdir(parents=True)
    video.write_bytes(b"original-video")

    async def fake_list_shot_takes(_episode_id):
        return [{
            "item_id": "shot_1",
            "takes": [{"segment_id": "seg_1", "video_url": "/video/one.mp4"}],
        }]

    async def fake_probe(_path):
        return 4.0

    monkeypatch.setattr(episode_compose_service, "_STORAGE", str(tmp_path))
    monkeypatch.setattr(episode_compose_service, "_list_shot_takes", fake_list_shot_takes)
    monkeypatch.setattr(episode_compose_service, "_probe_dur", fake_probe)

    result = await episode_compose_service.preflight_timeline("ep_1", [{
        "clip_id": "seg_1",
        "segment_id": "seg_1",
        "start_ms": 0,
        "duration_ms": 5000,
        "source_offset_ms": 0,
        "source_duration_ms": 5000,
    }])

    assert result[0]["duration_ms"] == 4000
    assert result[0]["source_duration_ms"] == 4000
    assert result[0]["duration_corrected"] is True
    assert len(result[0]["source_identity"]) == 64


@pytest.mark.asyncio
async def test_preflight_rejects_invalid_explicit_trim(monkeypatch, tmp_path):
    video = tmp_path / "video" / "one.mp4"
    video.parent.mkdir(parents=True)
    video.write_bytes(b"original-video")

    async def fake_list_shot_takes(_episode_id):
        return [{
            "item_id": "shot_1",
            "takes": [{"segment_id": "seg_1", "video_url": "/video/one.mp4"}],
        }]

    async def fake_probe(_path):
        return 4.0

    monkeypatch.setattr(episode_compose_service, "_STORAGE", str(tmp_path))
    monkeypatch.setattr(episode_compose_service, "_list_shot_takes", fake_list_shot_takes)
    monkeypatch.setattr(episode_compose_service, "_probe_dur", fake_probe)

    with pytest.raises(RuntimeError, match="trimmed"):
        await episode_compose_service.preflight_timeline("ep_1", [{
            "clip_id": "trimmed",
            "segment_id": "seg_1",
            "start_ms": 0,
            "duration_ms": 3500,
            "source_offset_ms": 1000,
            "source_duration_ms": 5000,
        }])


@pytest.mark.asyncio
async def test_mix_global_audio_tracks_uses_timeline_trim_delay_and_bgm_fades(
    monkeypatch,
    tmp_path,
):
    storage = tmp_path / "storage"
    video = storage / "video" / "final.mp4"
    bgm = storage / "audio" / "bgm.mp3"
    sfx = storage / "audio" / "sfx.mp3"
    for path in (video, bgm, sfx):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"source")

    commands = []

    async def fake_rows(_episode_id):
        return [
            {
                "track_id": "bgm_1",
                "track_type": "bgm",
                "name": "theme",
                "audio_url": "/storage/audio/bgm.mp3",
                "duration_ms": 8_000,
                "generation_params": {
                    "timeline": {
                        "startMs": 1_000,
                        "sourceOffsetMs": 500,
                        "durationMs": 5_000,
                        "fadeInMs": 800,
                        "fadeOutMs": 1_200,
                        "volume": 0.4,
                    }
                },
            },
            {
                "track_id": "sfx_1",
                "track_type": "sfx_global",
                "name": "door",
                "audio_url": "/storage/audio/sfx.mp3",
                "duration_ms": 2_000,
                "generation_params": {
                    "timeline": {
                        "startMs": 3_500,
                        "durationMs": 1_500,
                        "fadeInMs": 200,
                        "fadeOutMs": 400,
                        "volume": 0.8,
                    }
                },
            },
        ]

    async def fake_run(cmd):
        commands.append(cmd)
        Path(cmd[-1]).write_bytes(b"mixed")
        return 0, "", ""

    monkeypatch.setattr(episode_compose_service, "_STORAGE", str(storage))
    monkeypatch.setattr(
        episode_compose_service.EpisodeComposeDAO,
        "list_audio_tracks",
        fake_rows,
    )
    monkeypatch.setattr(episode_compose_service, "_run", fake_run)

    await episode_compose_service._mix_global_audio_tracks(
        "ep_1",
        str(video),
        8.0,
        str(tmp_path),
    )

    assert len(commands) == 1
    cmd = commands[0]
    filters = cmd[cmd.index("-filter_complex") + 1]
    assert "atrim=start=0.500:duration=5.000" in filters
    assert "afade=t=in:st=0:d=0.800" in filters
    assert "afade=t=out:st=3.800:d=1.200" in filters
    assert "volume=0.400" in filters
    assert "adelay=delays=1000:all=1" in filters
    assert "atrim=start=0.000:duration=1.500" in filters
    assert "volume=0.800" in filters
    assert "afade=t=in:st=0:d=0.200" in filters
    assert "afade=t=out:st=1.100:d=0.400" in filters
    assert "adelay=delays=3500:all=1" in filters
    assert "amix=inputs=3:duration=first" in filters
    assert video.read_bytes() == b"mixed"


@pytest.mark.asyncio
async def test_get_takes_groups_video_segments_and_dedupes_join_rows(monkeypatch):
    async def fake_rows(_episode_id):
        created = datetime(2026, 6, 22, 12, 0, 0)
        return [
            {
                "item_id": "shot_1",
                "sort_order": 1,
                "scene_heading": "Scene",
                "dialogue": "Line",
                "audio_url": "/storage/audio/a.mp3",
                "audio_ms": 1200,
                "segment_id": "seg_new",
                "video_url": "/storage/video/new.mp4",
                "thumbnail_url": "/storage/thumb/new.jpg",
                "created_at": created,
            },
            {
                "item_id": "shot_1",
                "sort_order": 1,
                "scene_heading": "Scene",
                "dialogue": "Line",
                "audio_url": "/storage/audio/a.mp3",
                "audio_ms": 1200,
                "segment_id": "seg_new",
                "video_url": "/storage/video/new.mp4",
                "thumbnail_url": "/storage/thumb/duplicate.jpg",
                "created_at": created,
            },
            {
                "item_id": "shot_1",
                "sort_order": 1,
                "scene_heading": "Scene",
                "dialogue": "Line",
                "audio_url": "/storage/audio/a.mp3",
                "audio_ms": 1200,
                "segment_id": "seg_old",
                "video_url": "/storage/video/old.mp4",
                "thumbnail_url": "/storage/thumb/old.jpg",
                "created_at": None,
            },
        ]

    monkeypatch.setattr(episode_compose_service.EpisodeComposeDAO, "list_shot_take_rows", fake_rows)

    shots = await episode_compose_service.get_takes("ep_1")

    assert len(shots) == 1
    assert shots[0]["item_id"] == "shot_1"
    assert shots[0]["audio_url"] == "/storage/audio/a.mp3"
    assert [take["segment_id"] for take in shots[0]["takes"]] == ["seg_new", "seg_old"]
    assert shots[0]["takes"][0]["created_at"] == "2026-06-22T12:00:00"


@pytest.mark.asyncio
async def test_get_shots_uses_selected_take_with_latest_default(monkeypatch):
    async def fake_rows(_episode_id):
        return [
            {
                "item_id": "shot_1",
                "sort_order": 1,
                "scene_heading": "",
                "dialogue": "",
                "audio_url": "/storage/audio/one.mp3",
                "audio_ms": 1000,
                "segment_id": "seg_latest",
                "video_url": "/storage/video/latest.mp4",
                "thumbnail_url": None,
                "created_at": None,
            },
            {
                "item_id": "shot_1",
                "sort_order": 1,
                "scene_heading": "",
                "dialogue": "",
                "audio_url": "/storage/audio/one.mp3",
                "audio_ms": 1000,
                "segment_id": "seg_selected",
                "video_url": "/storage/video/selected.mp4",
                "thumbnail_url": None,
                "created_at": None,
            },
            {
                "item_id": "shot_2",
                "sort_order": 2,
                "scene_heading": "",
                "dialogue": "",
                "audio_url": None,
                "audio_ms": 0,
                "segment_id": "seg_two",
                "video_url": "/storage/video/two.mp4",
                "thumbnail_url": None,
                "created_at": None,
            },
        ]

    monkeypatch.setattr(episode_compose_service.EpisodeComposeDAO, "list_shot_take_rows", fake_rows)

    shots = await episode_compose_service._get_shots("ep_1", {"shot_1": "seg_selected"})

    assert shots == [
        {
            "video_url": "/storage/video/selected.mp4",
            "audio_url": "/storage/audio/one.mp3",
            "audio_urls": ["/storage/audio/one.mp3"],
            "audio_segments": [],
            "sfx_audio_url": None,
            "audio_ms": 1000,
        },
        {
            "video_url": "/storage/video/two.mp4",
            "audio_url": None,
            "audio_urls": [],
            "audio_segments": [],
            "sfx_audio_url": None,
            "audio_ms": 0,
        },
    ]


@pytest.mark.asyncio
async def test_get_shots_uses_persisted_selection_when_request_omits_picks(monkeypatch):
    async def fake_rows(_episode_id):
        return [
            {
                "item_id": "shot_1", "sort_order": 1, "scene_heading": "", "dialogue": "",
                "audio_url": None, "audio_ms": 0, "segment_id": "seg_latest",
                "video_url": "/storage/video/latest.mp4", "thumbnail_url": None,
                "created_at": None, "take_id": "take_latest", "is_selected": False,
            },
            {
                "item_id": "shot_1", "sort_order": 1, "scene_heading": "", "dialogue": "",
                "audio_url": None, "audio_ms": 0, "segment_id": "seg_chosen",
                "video_url": "/storage/video/chosen.mp4", "thumbnail_url": None,
                "created_at": None, "take_id": "take_chosen", "is_selected": True,
            },
        ]

    monkeypatch.setattr(episode_compose_service.EpisodeComposeDAO, "list_shot_take_rows", fake_rows)

    takes = await episode_compose_service.get_takes("ep_1")
    shots = await episode_compose_service._get_shots("ep_1")

    assert takes[0]["selected_segment_id"] == "seg_chosen"
    assert shots[0]["video_url"] == "/storage/video/chosen.mp4"


@pytest.mark.asyncio
async def test_get_shots_falls_back_to_storyboard_audio_parts_when_mixed_missing(monkeypatch):
    async def fake_rows(_episode_id):
        return [
            {
                "item_id": "shot_1",
                "sort_order": 1,
                "scene_heading": "",
                "dialogue": "",
                "audio_url": None,
                "dialogue_audio_url": "/storage/audio/dialogue.mp3",
                "narration_audio_url": "/storage/audio/narration.mp3",
                "sfx_audio_url": "/storage/audio/sfx.mp3",
                "audio_ms": 3200,
                "segment_id": "seg_1",
                "video_url": "/storage/video/one.mp4",
                "thumbnail_url": None,
                "created_at": None,
            },
        ]

    monkeypatch.setattr(episode_compose_service.EpisodeComposeDAO, "list_shot_take_rows", fake_rows)

    shots = await episode_compose_service._get_shots("ep_1")

    assert shots == [
        {
            "video_url": "/storage/video/one.mp4",
            "audio_url": "/storage/audio/dialogue.mp3",
            "audio_urls": [
                "/storage/audio/dialogue.mp3",
                "/storage/audio/narration.mp3",
                "/storage/audio/sfx.mp3",
            ],
            "audio_segments": [],
            "sfx_audio_url": "/storage/audio/sfx.mp3",
            "audio_ms": 3200,
        },
    ]


@pytest.mark.asyncio
async def test_get_shots_preserves_ordered_audio_segments(monkeypatch):
    async def fake_rows(_episode_id):
        return [
            {
                "item_id": "shot_1",
                "sort_order": 1,
                "scene_heading": "",
                "dialogue": "",
                "audio_url": None,
                "dialogue_audio_url": "/storage/audio/legacy.mp3",
                "narration_audio_url": None,
                "sfx_audio_url": None,
                "audio_segments": [
                    {
                        "segmentId": "speech-2",
                        "kind": "speech",
                        "sequenceIndex": 2,
                        "audioUrl": "/storage/audio/two.mp3",
                        "durationMs": 2200,
                    },
                    {
                        "segmentId": "speech-1",
                        "kind": "speech",
                        "sequenceIndex": 0,
                        "audioUrl": "/storage/audio/one.mp3",
                        "durationMs": 1800,
                    },
                    {
                        "segmentId": "pause",
                        "kind": "silence",
                        "sequenceIndex": 1,
                        "durationMs": 1500,
                    },
                ],
                "audio_ms": 0,
                "segment_id": "seg_1",
                "video_url": "/storage/video/one.mp4",
                "thumbnail_url": None,
                "created_at": None,
            },
        ]

    monkeypatch.setattr(episode_compose_service.EpisodeComposeDAO, "list_shot_take_rows", fake_rows)

    shots = await episode_compose_service._get_shots("ep_1")

    assert [segment["segment_id"] for segment in shots[0]["audio_segments"]] == [
        "speech-1",
        "pause",
        "speech-2",
    ]
    assert shots[0]["audio_urls"] == [
        "/storage/audio/one.mp3",
        "/storage/audio/two.mp3",
    ]
    assert shots[0]["audio_ms"] == 5500


@pytest.mark.asyncio
async def test_compose_mixes_multiple_storyboard_audio_parts(monkeypatch, tmp_path):
    storage = tmp_path / "storage"
    video = storage / "video" / "one.mp4"
    dialogue = storage / "audio" / "dialogue.mp3"
    narration = storage / "audio" / "narration.mp3"
    sfx = storage / "audio" / "sfx.mp3"
    for path in (video, dialogue, narration, sfx):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x")

    commands = []

    async def fake_run(cmd):
        commands.append(cmd)
        output_path = cmd[-1]
        if output_path.endswith(".mp4"):
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            Path(output_path).write_bytes(b"video")
        return 0, "", ""

    async def fake_probe(_path):
        return 3.2

    async def fake_video_size(_path):
        return None

    async def fake_has_audio(_path):
        return False

    async def fake_get_shots(_episode_id, _selections=None):
        return [
            {
                "video_url": "/storage/video/one.mp4",
                "audio_url": "/storage/audio/dialogue.mp3",
                "audio_urls": [
                    "/storage/audio/dialogue.mp3",
                    "/storage/audio/narration.mp3",
                    "/storage/audio/sfx.mp3",
                ],
                "audio_ms": 3200,
            }
        ]

    async def fake_create_final_cut_records(**_kwargs):
        return None

    monkeypatch.setattr(episode_compose_service, "_STORAGE", str(storage))
    monkeypatch.setattr(episode_compose_service, "_ensure_media_tools", lambda: None)
    monkeypatch.setattr(episode_compose_service, "_run", fake_run)
    monkeypatch.setattr(episode_compose_service, "_probe_dur", fake_probe)
    monkeypatch.setattr(episode_compose_service, "_probe_video_size", fake_video_size)
    monkeypatch.setattr(episode_compose_service, "_probe_has_audio", fake_has_audio)
    monkeypatch.setattr(episode_compose_service, "_get_shots", fake_get_shots)
    monkeypatch.setattr(episode_compose_service.EpisodeComposeDAO, "create_final_cut_records", fake_create_final_cut_records)

    job = {}
    await episode_compose_service._compose("ep_1", "user_1", "proj_1", job)

    clip_cmd = commands[0]
    filter_arg = clip_cmd[clip_cmd.index("-filter_complex") + 1]
    normalized_cmd = [os.path.normpath(str(part)) for part in clip_cmd]
    assert "amix=inputs=3" in filter_arg
    assert "-i" in clip_cmd
    assert os.path.normpath(str(dialogue)) in normalized_cmd
    assert os.path.normpath(str(narration)) in normalized_cmd
    assert os.path.normpath(str(sfx)) in normalized_cmd
    assert job["status"] == "done"


@pytest.mark.asyncio
async def test_compose_concats_ordered_speech_and_silence_segments(monkeypatch, tmp_path):
    storage = tmp_path / "storage"
    video = storage / "video" / "one.mp4"
    first = storage / "audio" / "first.mp3"
    second = storage / "audio" / "second.mp3"
    for path in (video, first, second):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x")

    commands = []

    async def fake_run(cmd):
        commands.append(cmd)
        output_path = cmd[-1]
        if output_path.endswith(".mp4"):
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            Path(output_path).write_bytes(b"video")
        return 0, "", ""

    async def fake_probe(_path):
        return 4.0

    async def fake_video_size(_path):
        return None

    async def fake_has_audio(_path):
        return False

    async def fake_get_shots(_episode_id, _selections=None):
        return [
            {
                "video_url": "/storage/video/one.mp4",
                "audio_url": "/storage/audio/first.mp3",
                "audio_urls": [
                    "/storage/audio/first.mp3",
                    "/storage/audio/second.mp3",
                ],
                "audio_segments": [
                    {
                        "kind": "speech",
                        "audio_url": "/storage/audio/first.mp3",
                        "duration_ms": 1800,
                    },
                    {"kind": "silence", "duration_ms": 1500},
                    {
                        "kind": "speech",
                        "audio_url": "/storage/audio/second.mp3",
                        "duration_ms": 2200,
                    },
                ],
                "sfx_audio_url": None,
                "audio_ms": 5500,
            }
        ]

    async def fake_create_final_cut_records(**_kwargs):
        return None

    monkeypatch.setattr(episode_compose_service, "_STORAGE", str(storage))
    monkeypatch.setattr(episode_compose_service, "_ensure_media_tools", lambda: None)
    monkeypatch.setattr(episode_compose_service, "_run", fake_run)
    monkeypatch.setattr(episode_compose_service, "_probe_dur", fake_probe)
    monkeypatch.setattr(episode_compose_service, "_probe_video_size", fake_video_size)
    monkeypatch.setattr(episode_compose_service, "_probe_has_audio", fake_has_audio)
    monkeypatch.setattr(episode_compose_service, "_get_shots", fake_get_shots)
    monkeypatch.setattr(
        episode_compose_service.EpisodeComposeDAO,
        "create_final_cut_records",
        fake_create_final_cut_records,
    )

    await episode_compose_service._compose("ep_1", "user_1", "proj_1", {})

    clip_cmd = commands[0]
    filter_arg = clip_cmd[clip_cmd.index("-filter_complex") + 1]
    normalized_cmd = [os.path.normpath(str(part)) for part in clip_cmd]
    assert "concat=n=3:v=0:a=1[voice]" in filter_arg
    assert "anullsrc=r=48000:cl=stereo:d=1.500[seq1]" in filter_arg
    assert "amix=inputs=2" not in filter_arg
    assert os.path.normpath(str(first)) in normalized_cmd
    assert os.path.normpath(str(second)) in normalized_cmd


@pytest.mark.asyncio
@pytest.mark.parametrize("references", [
    {"audio_urls": ["/storage/audio/unused.mp3"], "audio_ms": 0},
    {"audio_segments": [{"kind": "speech", "audio_url": "/storage/audio/unused.mp3", "duration_ms": 0}]},
    {"audio_segments": [{"kind": "speech", "audio_url": "/storage/audio/unused.mp3", "duration_ms": "invalid"}]},
])
async def test_original_audio_does_not_resolve_unused_references(monkeypatch, tmp_path, references):
    from unittest.mock import AsyncMock

    storage = tmp_path / "storage"
    video = storage / "video" / "one.mp4"
    video.parent.mkdir(parents=True)
    video.write_bytes(b"video")
    commands = []
    original_local = episode_compose_service._local

    def local(url):
        if url and "/audio/" in url:
            raise RuntimeError("Unused reference must not be resolved")
        return original_local(url)

    async def run(command):
        commands.append(command)
        output = Path(command[-1])
        if output.suffix == ".mp4":
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(b"video")
        return 0, "", ""

    monkeypatch.setattr(episode_compose_service, "_STORAGE", str(storage))
    monkeypatch.setattr(episode_compose_service, "_local", local)
    monkeypatch.setattr(episode_compose_service, "_ensure_media_tools", lambda: None)
    monkeypatch.setattr(episode_compose_service, "_run", run)
    monkeypatch.setattr(episode_compose_service, "_probe_dur", AsyncMock(return_value=4.0))
    monkeypatch.setattr(episode_compose_service, "_probe_has_audio", AsyncMock(return_value=True))
    monkeypatch.setattr(episode_compose_service, "_probe_video_size", AsyncMock(return_value=(1280, 720)))
    monkeypatch.setattr(episode_compose_service, "_get_shots", AsyncMock(return_value=[{
        "video_url": "/storage/video/one.mp4", **references,
    }]))
    monkeypatch.setattr(episode_compose_service.EpisodeComposeDAO, "create_final_cut_records", AsyncMock())

    job = {}
    await episode_compose_service._compose("ep_1", "user_1", "proj_1", job, audio_mode="video_original")
    assert job["status"] == "done"
    assert "[0:a]apad[a]" in commands[0][commands[0].index("-filter_complex") + 1]


@pytest.mark.asyncio
async def test_compose_respects_explicit_video_original_mode(monkeypatch, tmp_path):
    storage = tmp_path / "storage"
    video = storage / "video" / "one.mp4"
    reference_audio = storage / "audio" / "reference.mp3"
    for path in (video, reference_audio):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x")

    commands = []

    async def fake_run(cmd):
        commands.append(cmd)
        output_path = cmd[-1]
        if output_path.endswith(".mp4"):
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            Path(output_path).write_bytes(b"video")
        return 0, "", ""

    async def fake_probe(_path):
        return 4.0

    async def fake_has_audio(_path):
        return True

    async def fake_video_size(_path):
        return None

    async def fake_get_shots(_episode_id, _selections=None, timeline=None):
        row = {
            "video_url": "/storage/video/one.mp4",
            "audio_url": "/storage/audio/reference.mp3",
            "audio_urls": ["/storage/audio/reference.mp3"],
            "audio_ms": 4000,
        }
        if timeline:
            row.update({"source_offset_ms": 1250, "duration_ms": 1750})
        return [row]

    async def fake_create_final_cut_records(**_kwargs):
        return None

    monkeypatch.setattr(episode_compose_service, "_STORAGE", str(storage))
    monkeypatch.setattr(episode_compose_service, "_ensure_media_tools", lambda: None)
    monkeypatch.setattr(episode_compose_service, "_run", fake_run)
    monkeypatch.setattr(episode_compose_service, "_probe_dur", fake_probe)
    monkeypatch.setattr(episode_compose_service, "_probe_has_audio", fake_has_audio)
    monkeypatch.setattr(episode_compose_service, "_probe_video_size", fake_video_size)
    monkeypatch.setattr(episode_compose_service, "_get_shots", fake_get_shots)
    monkeypatch.setattr(episode_compose_service.EpisodeComposeDAO, "create_final_cut_records", fake_create_final_cut_records)

    job = {}
    await episode_compose_service._compose(
        "ep_1",
        "user_1",
        "proj_1",
        job,
        audio_mode="video_original",
    )

    clip_cmd = commands[0]
    filter_arg = clip_cmd[clip_cmd.index("-filter_complex") + 1]
    assert "[0:a]apad[a]" in filter_arg
    assert "anullsrc=r=48000:cl=stereo" not in clip_cmd
    assert os.path.normpath(str(reference_audio)) not in [os.path.normpath(str(part)) for part in clip_cmd]
    assert clip_cmd[clip_cmd.index("-map", clip_cmd.index("-map") + 1) + 1] == "[a]"
    assert job["status"] == "done"

    commands.clear()
    await episode_compose_service._compose(
        "ep_1",
        "user_1",
        "proj_1",
        {},
        audio_mode="reference_dubbing",
    )
    reference_cmd = commands[0]
    reference_filter = reference_cmd[reference_cmd.index("-filter_complex") + 1]
    assert "[1:a]anull[mixed]" in reference_filter
    assert "atrim=start=0.000:end=4.000" in reference_filter
    assert os.path.normpath(str(reference_audio)) in [os.path.normpath(str(part)) for part in reference_cmd]

    commands.clear()
    await episode_compose_service._compose(
        "ep_1",
        "user_1",
        "proj_1",
        {},
        audio_mode="reference_dubbing",
        timeline=[{"segment_id": "seg_1", "duration_ms": 1750, "source_offset_ms": 1250}],
    )
    trimmed_cmd = commands[0]
    trimmed_filter = trimmed_cmd[trimmed_cmd.index("-filter_complex") + 1]
    assert trimmed_cmd[trimmed_cmd.index("-ss") + 1] == "1.250"
    assert trimmed_cmd[trimmed_cmd.index("-t") + 1] == "1.75"
    assert "atrim=start=1.250:end=3.000" in trimmed_filter

    async def silent_video(_path):
        return False

    monkeypatch.setattr(episode_compose_service, "_probe_has_audio", silent_video)
    commands.clear()
    await episode_compose_service._compose("ep_1", "user_1", "proj_1", {}, audio_mode="video_original")
    fallback_filter = commands[0][commands[0].index("-filter_complex") + 1]
    assert "[1:a]anull[mixed]" in fallback_filter
    assert os.path.normpath(str(reference_audio)) in [os.path.normpath(str(part)) for part in commands[0]]


@pytest.mark.asyncio
async def test_compose_uses_portrait_canvas_for_vertical_clips(monkeypatch, tmp_path):
    storage = tmp_path / "storage"
    video = storage / "video" / "vertical.mp4"
    video.parent.mkdir(parents=True, exist_ok=True)
    video.write_bytes(b"x")

    commands = []
    burned = []

    async def fake_run(cmd):
        commands.append(cmd)
        output_path = cmd[-1]
        if output_path.endswith(".mp4"):
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            Path(output_path).write_bytes(b"video")
        return 0, "", ""

    async def fake_probe(_path):
        return 4.0

    async def fake_has_audio(_path):
        return False

    async def fake_video_size(_path):
        return (720, 1280)

    async def fake_burn(cues, style, _path, _duration, _tmp, width, height, source_spans=None):
        assert source_spans == [(0, 4000, 720, 1280)]
        burned.append((cues, style, width, height))
        return 1

    async def fake_get_shots(_episode_id, _selections=None):
        return [
            {
                "video_url": "/storage/video/vertical.mp4",
                "audio_url": None,
                "audio_urls": [],
                "audio_ms": 0,
            }
        ]

    async def fake_create_final_cut_records(**kwargs):
        assert kwargs["metadata"]["output_width"] == 1080
        assert kwargs["metadata"]["output_height"] == 1920
        assert kwargs["metadata"]["output_aspect"] == "9:16"
        assert kwargs["metadata"]["audio_mode"] == "video_original"
        assert kwargs["metadata"]["subtitle_count"] == 1

    monkeypatch.setattr(episode_compose_service, "_STORAGE", str(storage))
    monkeypatch.setattr(episode_compose_service, "_ensure_media_tools", lambda: None)
    monkeypatch.setattr(episode_compose_service, "_run", fake_run)
    monkeypatch.setattr(episode_compose_service, "_probe_dur", fake_probe)
    monkeypatch.setattr(episode_compose_service, "_probe_has_audio", fake_has_audio)
    monkeypatch.setattr(episode_compose_service, "_probe_video_size", fake_video_size)
    monkeypatch.setattr(episode_compose_service, "_burn_editor_subtitles", fake_burn)
    monkeypatch.setattr(episode_compose_service, "_get_shots", fake_get_shots)
    monkeypatch.setattr(episode_compose_service.EpisodeComposeDAO, "create_final_cut_records", fake_create_final_cut_records)

    job = {}
    subtitles = [{"cue_id": "cue-1", "text": "竖屏字幕", "start_ms": 0, "duration_ms": 1000}]
    subtitle_style = {"position": "bottom"}
    await episode_compose_service._compose(
        "ep_1",
        "user_1",
        "proj_1",
        job,
        subtitles=subtitles,
        subtitle_style=subtitle_style,
    )

    clip_cmd = commands[0]
    filter_arg = clip_cmd[clip_cmd.index("-filter_complex") + 1]
    assert "scale=1080:1920" in filter_arg
    assert "pad=1080:1920" in filter_arg
    assert job["output_width"] == 1080
    assert job["output_height"] == 1920
    assert job["output_aspect"] == "9:16"
    assert job["status"] == "done"
    assert burned == [(subtitles, subtitle_style, 1080, 1920)]


@pytest.mark.asyncio
async def test_compose_reports_missing_ffmpeg_tools_before_processing(monkeypatch):
    monkeypatch.setattr(episode_compose_service.shutil, "which", lambda _name: None)

    async def fail_get_shots(*_args, **_kwargs):
        pytest.fail("compose should validate ffmpeg tools before loading shots")

    monkeypatch.setattr(episode_compose_service, "_get_shots", fail_get_shots)

    with pytest.raises(RuntimeError, match="ffmpeg.*ffprobe"):
        await episode_compose_service._compose("ep_1", "user_1", "proj_1", {})


@pytest.mark.asyncio
async def test_compose_inserts_black_transition_without_counting_it_as_a_shot(monkeypatch, tmp_path):
    storage = tmp_path / "storage"
    first = storage / "video" / "first.mp4"
    second = storage / "video" / "second.mp4"
    for path in (first, second):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"video")

    commands = []
    saved = {}
    spans = []

    async def capture_subtitles(*_args, source_spans=None):
        spans.extend(source_spans)
        return 0

    monkeypatch.setattr(episode_compose_service, '_burn_editor_subtitles', capture_subtitles)

    async def fake_run(command):
        commands.append(command)
        output = Path(command[-1])
        if output.suffix == ".mp4":
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(b"encoded")
        return 0, "", ""

    async def fake_get_shots(_episode_id, _selections=None, _timeline=None):
        return [
            {
                "video_url": "/storage/video/first.mp4",
                "audio_urls": [],
                "audio_ms": 0,
                "transition_after": "black",
                "transition_duration_ms": 700,
            },
            {
                "video_url": "/storage/video/second.mp4",
                "audio_urls": [],
                "audio_ms": 0,
            },
        ]

    async def fake_create_final_cut_records(**kwargs):
        saved.update(kwargs)

    monkeypatch.setattr(episode_compose_service, "_STORAGE", str(storage))
    monkeypatch.setattr(episode_compose_service, "_ensure_media_tools", lambda: None)
    monkeypatch.setattr(episode_compose_service, "_run", fake_run)
    monkeypatch.setattr(episode_compose_service, "_probe_dur", lambda _path: _async_value(2.0))
    monkeypatch.setattr(episode_compose_service, "_probe_has_audio", lambda _path: _async_value(False))
    monkeypatch.setattr(episode_compose_service, "_probe_video_size", lambda _path: _async_value((1920, 1080)))
    monkeypatch.setattr(episode_compose_service, "_get_shots", fake_get_shots)
    monkeypatch.setattr(episode_compose_service.EpisodeComposeDAO, "create_final_cut_records", fake_create_final_cut_records)

    job = {}
    await episode_compose_service._compose("ep_1", "user_1", "proj_1", job)

    black_commands = [command for command in commands if any("color=c=black" in str(part) for part in command)]
    assert len(black_commands) == 1
    assert "d=0.700" in next(part for part in black_commands[0] if "color=c=black" in str(part))
    assert job["done"] == 2
    assert "(2 镜)" in saved["title"]
    assert spans == [(0, 2000, 1920, 1080), (2000, 2700, 1920, 1080), (2700, 4700, 1920, 1080)]


async def _async_value(value):
    return value
