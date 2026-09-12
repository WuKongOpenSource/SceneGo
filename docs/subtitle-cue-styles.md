# Independent subtitle styles

Each subtitle has its own position, font size, colors and background settings.
Dragging in the preview or editing the sidebar changes only the selected cue.
Manual and AI-generated cues start at bottom center with the default 42 px size
(scaled to the source picture in preview). A cue can be reset to the default
position and size without changing other cues.

Styles are stored on each subtitle timeline item and travel with the cue through
save/reload, undo/redo and the composition request. The compositor validates every
cue style and generates independent ASS styles for the final video.

Historical cues without an individual style use the default style; the old global
placement and font size are not inherited. Text and timing remain unchanged. No
bulk database rewrite is performed. Existing API clients that explicitly submit
only the legacy global composition style remain compatible.

## Font readiness and export safety

The encoding is UTF-8. The FFmpeg runtime also needs Chinese glyphs: on Debian
install `fonts-noto-cjk` and `fontconfig`, then refresh the font cache. Configure
`OSTORY_SUBTITLE_FONTS_DIR` and `OSTORY_SUBTITLE_FONT_FAMILY` when using another
font installation. Run `python deploy/scripts/check_subtitle_font_runtime.py`
inside the actual runtime before release, including incremental image builds.
The check renders simplified/traditional Chinese, punctuation and Latin text.

FFmpeg can exit successfully even when libass substitutes boxes for missing
glyphs. Composition now rejects exhausted font fallback warnings before publishing
the result and returns a path-free error. Existing videos are not rewritten;
recompose after repairing the font environment to replace burnt-in boxes.

## Discarding a final version

Both the latest final and history cards have a delete action with confirmation.
It uses the authorized media-library soft-delete operation, which removes only
that final from the list and makes its review share unavailable. Source video,
audio, timeline, other finals and the underlying media bytes are retained.
