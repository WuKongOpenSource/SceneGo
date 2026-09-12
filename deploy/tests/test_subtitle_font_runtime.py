from pathlib import Path
from types import SimpleNamespace

import pytest

from services import subtitle_font_service as fonts
from services import episode_compose_service as compose
from services.compose_error_service import public_compose_error


def test_missing_glyph_is_rejected_but_successful_fallback_is_allowed():
    fonts.require_subtitle_glyphs('Glyph 0x8BF7 not found, selecting one more font\nfontselect: Noto Sans CJK SC')
    with pytest.raises(RuntimeError, match=fonts.FONT_ERROR):
        fonts.require_subtitle_glyphs('fontselect: failed to find any fallback with glyph 0x8BF7 for font: /private/font')
    assert public_compose_error(RuntimeError(fonts.FONT_ERROR)) == '字幕字体不可用，请联系管理员修复字体后重新合成。'


@pytest.mark.asyncio
async def test_zero_exit_with_missing_glyph_does_not_replace_video(monkeypatch, tmp_path):
    video = tmp_path / 'final.mp4'
    video.write_bytes(b'original')

    async def run(cmd):
        assert cmd[cmd.index('-loglevel') + 1] == 'warning'
        Path(cmd[-1]).write_bytes(b'broken-subtitles')
        return 0, '', 'fontselect: failed to find any fallback with glyph 0x8BF7'

    monkeypatch.setattr(compose, '_run', run)
    with pytest.raises(RuntimeError, match=fonts.FONT_ERROR):
        await compose._burn_editor_subtitles([{'text': '请问，有桂花乌龙吗？', 'start_ms': 0, 'duration_ms': 1000}],
            {}, str(video), 1, str(tmp_path), 640, 360)
    assert video.read_bytes() == b'original'


@pytest.mark.parametrize('returncode,warning,fails', [(0, '', False), (0, 'fontselect: failed to find any fallback with glyph 0x8BF7', True), (1, '', True)])
def test_runtime_gate_renders_utf8_chinese_instead_of_only_checking_directory(monkeypatch, returncode, warning, fails):
    def run(cmd, **kwargs):
        assert 'warning' in cmd
        filter_value = cmd[cmd.index('-vf') + 1]
        assert 'ass=filename=' in filter_value
        assert kwargs['timeout'] == 30
        ass_path = filter_value.split("'")[1].replace(r'\:', ':')
        text = Path(ass_path).read_text(encoding='utf-8-sig')
        assert '请问，有桂花乌龙吗？繁體字幕 ABC 123' in text
        return SimpleNamespace(returncode=returncode, stderr=warning.encode())

    monkeypatch.setattr(fonts.subprocess, 'run', run)
    if fails:
        with pytest.raises(RuntimeError, match=fonts.FONT_ERROR):
            fonts.verify_subtitle_font_runtime()
    else:
        fonts.verify_subtitle_font_runtime()
