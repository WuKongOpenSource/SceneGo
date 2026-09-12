"""Verify real libass glyph rendering instead of trusting encoder exit status."""
from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

SUBTITLE_FONTS_DIR = os.environ.get("OSTORY_SUBTITLE_FONTS_DIR", "/usr/share/fonts/opentype/noto")
SUBTITLE_FONT_FAMILY = os.environ.get("OSTORY_SUBTITLE_FONT_FAMILY", "Noto Sans CJK SC")
FONT_ERROR = "Subtitle font unavailable"


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
