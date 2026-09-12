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
