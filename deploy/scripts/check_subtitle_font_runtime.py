"""Fail the release gate when the actual FFmpeg runtime cannot render Chinese."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.subtitle_font_service import verify_subtitle_font_runtime


if __name__ == "__main__":
    try:
        verify_subtitle_font_runtime()
    except Exception:
        print("Subtitle font check failed: install Chinese fonts and verify FFmpeg/libass font access.", file=sys.stderr)
        raise SystemExit(1)
    print("Subtitle font runtime OK: Chinese, traditional Chinese, Latin and punctuation rendered.")
