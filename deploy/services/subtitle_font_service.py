"""Verify real libass glyph rendering instead of trusting encoder exit status."""
from __future__ import annotations

import os
import struct
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path

SUBTITLE_FONTS_DIR = os.environ.get("OSTORY_SUBTITLE_FONTS_DIR", "/usr/share/fonts/opentype/noto")
SUBTITLE_FONT_FAMILY = os.environ.get("OSTORY_SUBTITLE_FONT_FAMILY", "Noto Sans CJK SC")
FONT_ERROR = "Subtitle font unavailable"


def _ass_em_ratio(font_path: str, face_index: int = 0) -> float:
    """Convert CSS em pixels to libass REAL_DIM pixels using the selected face.

    libass uses Win ascent + descent (then typo/hhea metrics as fallbacks),
    whereas browser font-size specifies unitsPerEm. Do not guess a fixed ratio:
    it differs between fonts, including otherwise similar CJK families.
    """
    with open(font_path, 'rb') as font:
        def read_at(offset: int, length: int) -> bytes:
            font.seek(offset)
            value = font.read(length)
            if len(value) != length:
                raise ValueError('Incomplete font metrics')
            return value

        offset = 0
        if read_at(0, 4) == b'ttcf':
            count = struct.unpack('>I', read_at(8, 4))[0]
            if not 0 <= face_index < min(count, 1024):
                raise ValueError('Invalid font face')
            offset = struct.unpack('>I', read_at(12 + face_index * 4, 4))[0]
        count = struct.unpack('>H', read_at(offset + 4, 2))[0]
        if count > 256:
            raise ValueError('Invalid font tables')
        tables = {}
        for index in range(count):
            tag, _checksum, start, length = struct.unpack('>4sIII', read_at(offset + 12 + index * 16, 16))
            tables[tag] = (start, length)
        units = struct.unpack('>H', read_at(tables[b'head'][0] + 18, 2))[0]
        if not units:
            raise ValueError('Invalid font em size')
        ascent = descent = 0
        if b'OS/2' in tables and tables[b'OS/2'][1] >= 78:
            start = tables[b'OS/2'][0]
            ascent, descent = struct.unpack('>hh', read_at(start + 74, 4))
            if not ascent + descent:
                ascent, descent = struct.unpack('>hh', read_at(start + 68, 4))
                descent = -descent
        if not ascent + descent:
            ascent, descent = struct.unpack('>hh', read_at(tables[b'hhea'][0] + 4, 4))
            descent = -descent
        ratio = (ascent + descent) / units
        if not 0.5 <= ratio <= 4:
            raise ValueError('Invalid font em metrics')
        return ratio


@lru_cache(maxsize=8)
def subtitle_css_to_ass_ratio(family: str) -> float:
    """Resolve the installed rendering face once, without reading user media."""
    try:
        result = subprocess.run(
            ['fc-match', '-f', '%{file}\n%{index}\n', family],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5, check=True,
        )
        lines = result.stdout.decode('utf-8').splitlines()
        return _ass_em_ratio(lines[0], int(lines[1]) & 0xFFFF)
    except (OSError, ValueError, KeyError, IndexError, struct.error, subprocess.SubprocessError) as exc:
        raise RuntimeError(FONT_ERROR) from exc


def require_subtitle_glyphs(stderr: str) -> None:
    # libass reports missing fallback glyphs as warnings and FFmpeg still exits 0.
    # A successful fallback is not an error; reject only exhausted font selection.
    lowered = stderr.lower()
    if "fontselect: failed to find" in lowered:
        raise RuntimeError(FONT_ERROR)


def ffmpeg_font_path(path: str) -> str:
    return path.replace("\\", "/").replace(":", r"\:").replace("'", r"\'")


def verify_subtitle_font_runtime() -> None:
    """Render Chinese and Latin glyphs in the installed runtime, without user media."""
    family = "".join(c for c in SUBTITLE_FONT_FAMILY[:100] if c not in {",", "\r", "\n"}).strip() or "Noto Sans CJK SC"
    with tempfile.TemporaryDirectory(prefix="subtitle-font-check-") as scratch:
        ass = Path(scratch) / "check.ass"
        ass.write_text(
            "[Script Info]\nScriptType: v4.00+\nPlayResX: 640\nPlayResY: 360\n"
            "[V4+ Styles]\n"
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
            f"Style: Default,{family},32,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,24,1\n"
            "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
            "Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,请问，有桂花乌龙吗？繁體字幕 ABC 123\n",
            encoding="utf-8-sig",
        )
        filter_value = f"ass=filename='{ffmpeg_font_path(str(ass))}'"
        if os.path.isdir(SUBTITLE_FONTS_DIR):
            filter_value += f":fontsdir='{ffmpeg_font_path(SUBTITLE_FONTS_DIR)}'"
        result = subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "warning",
             "-filter_threads", "1", "-f", "lavfi", "-i", "color=black:s=640x360:r=1:d=1",
             "-vf", filter_value, "-frames:v", "1", "-threads", "1", "-f", "null", "-"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30,
        )
        if result.returncode:
            raise RuntimeError(FONT_ERROR)
        require_subtitle_glyphs(result.stderr.decode("utf-8", "replace"))
