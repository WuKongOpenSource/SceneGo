"""Preview source pixels and export pixels must describe the same glyph ratio."""
from copy import deepcopy
from pathlib import Path
import struct

import pytest

from services import episode_compose_service as compose
from services import subtitle_font_service as fonts


def cue(**style):
    return compose._normalize_editor_subtitles([{
        'cue_id': 'a', 'text': '请问有桂花乌龙吗？', 'start_ms': 0, 'duration_ms': 2000,
        'style': {'font_size_unit': 'source_em', 'font_size': 42, **style},
    }], 2000)[0]


@pytest.mark.parametrize('source,output', [
    ((1280, 720), (1920, 1080)), ((1920, 1080), (3840, 2160)),
    ((3840, 2160), (1920, 1080)), ((720, 1280), (1080, 1920)),
    ((1024, 1024), (1920, 1080)),
])
def test_export_em_to_picture_ratio_matches_css_preview(source, output):
    original = cue(background_opacity=0, position_y=90)
    before = deepcopy(original)
    width, height = source
    ow, oh = output
    events = compose._preview_subtitle_events([original], {}, [(0, 2000, width, height)], ow, oh, 1.448)
    style = events[0]['style']
    picture_height = height * min(ow / width, oh / height)
    # Divide out libass REAL_DIM metrics to get the actual CSS em size.
    assert style['_render_font_size'] / 1.448 / picture_height == pytest.approx(42 / height)
    assert style['background_opacity'] == 0
    assert original == before


def test_cross_shot_cue_splits_at_resolution_changes_without_editing_saved_cue():
    original = cue(font_size=96)
    events = compose._preview_subtitle_events([original], {}, [
        (0, 750, 1280, 720), (750, 1000, 1280, 720), (1000, 2000, 1920, 1080),
    ], 1920, 1080, 1.448)
    assert [(e['start_ms'], e['duration_ms']) for e in events] == [(0, 1000), (1000, 1000)]
    assert [e['style']['_render_font_size'] for e in events] == pytest.approx([208.512, 139.008])
    assert original['style']['font_size'] == 96
    assert original['duration_ms'] == 2000


def test_letterboxed_position_stays_inside_the_same_source_picture():
    events = compose._preview_subtitle_events([cue(position_x=10, position_y=90)], {},
        [(0, 2000, 720, 1280)], 1920, 1080, 1.448)
    assert events[0]['style']['position_x'] == pytest.approx(37.34375)
    assert events[0]['style']['position_y'] == 90


def test_legacy_font_units_remain_unchanged_and_unknown_render_fields_are_dropped():
    legacy = cue()
    del legacy['style']['font_size_unit']
    assert compose._preview_subtitle_events([legacy], {}, [(0, 2000, 1280, 720)], 1920, 1080, 1.448) == [legacy]
    assert 'font_size_unit' not in compose._normalize_subtitle_style({'font_size_unit': 'other'})
    assert '_render_font_size' not in compose._normalize_subtitle_style({'_render_font_size': 999999})


@pytest.mark.asyncio
async def test_burn_contract_keeps_cue_count_and_scaled_per_cue_styles(monkeypatch, tmp_path):
    video = tmp_path / 'video.mp4'
    video.write_bytes(b'video')
    monkeypatch.setattr(compose, 'subtitle_css_to_ass_ratio', lambda _family: 1.448)

    async def run(cmd):
        Path(cmd[-1]).write_bytes(b'rendered')
        return 0, '', ''

    monkeypatch.setattr(compose, '_run', run)
    count = await compose._burn_editor_subtitles([cue(font_size=96)], {}, str(video), 2, str(tmp_path), 1920, 1080,
        [(0, 1000, 1280, 720), (1000, 2000, 1920, 1080)])
    ass = (tmp_path / 'editor_subtitles.ass').read_text(encoding='utf-8-sig')
    assert count == 1
    assert '208.512' in ass and '139.008' in ass
    assert ass.count('Dialogue:') == 2
    assert '请问有桂花乌龙吗？' in ass
    assert video.read_bytes() == b'rendered'


def font_fixture(tmp_path, win=(1160, 288), typo=(900, -200), collection=False):
    tables = {b'head': bytearray(54), b'OS/2': bytearray(78), b'hhea': bytearray(36)}
    struct.pack_into('>H', tables[b'head'], 18, 1000)
    struct.pack_into('>hh', tables[b'OS/2'], 74, *win)
    struct.pack_into('>hh', tables[b'OS/2'], 68, *typo)
    struct.pack_into('>hh', tables[b'hhea'], 4, 800, -200)
    base = 16 if collection else 0
    content = bytearray(b'ttcf' + struct.pack('>III', 0x10000, 1, base)) if collection else bytearray()
    content += struct.pack('>IHHHH', 0x10000, 3, 0, 0, 0)
    offset = base + 12 + 3 * 16
    for tag, data in tables.items():
        content += struct.pack('>4sIII', tag, 0, offset, len(data))
        offset += len(data)
    for data in tables.values():
        content += data
    path = tmp_path / 'font.bin'
    path.write_bytes(content)
    return path


@pytest.mark.parametrize('collection', [False, True])
@pytest.mark.parametrize('win,typo,ratio', [((1160, 288), (900, -200), 1.448), ((0, 0), (900, -200), 1.1), ((0, 0), (0, 0), 1.0)])
def test_font_metrics_use_em_and_libass_fallback_order(tmp_path, collection, win, typo, ratio):
    assert fonts._ass_em_ratio(str(font_fixture(tmp_path, win, typo, collection))) == ratio


def test_invalid_font_metrics_fail_closed(tmp_path, monkeypatch):
    font = tmp_path / 'broken.ttf'
    font.write_bytes(b'broken')
    with pytest.raises(ValueError):
        fonts._ass_em_ratio(str(font))
    fonts.subtitle_css_to_ass_ratio.cache_clear()
    def missing(*args, **kwargs):
        raise FileNotFoundError('font tool')
    monkeypatch.setattr(fonts.subprocess, 'run', missing)
    with pytest.raises(RuntimeError, match=fonts.FONT_ERROR):
        fonts.subtitle_css_to_ass_ratio('Test font')
