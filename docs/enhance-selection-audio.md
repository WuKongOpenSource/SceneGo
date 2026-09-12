# Enhancement export and audio editing

Use **Export to enhancement** after choosing each card's active video. The export
waits for workspace saving, validates every selected file in its episode, and commits
the ordered selections and editor cut list in one database transaction. Historical
files and merged-away segments remain intact; they are excluded from the exported
timeline. Invalid, deleted or ambiguous selections stop export without partial writes.
Existing cuts, transitions, subtitles and audio edits for surviving sources remain.

The selected segment URL is authoritative. Entity-file history is only a fallback
when no selection exists. Composition includes manual cards without storyboard links.

Select a music or sound-effect clip to edit position, source in-point, duration and
volume. Volume supports 0–100%, including mute and keyboard changes. Audio edits are
stored with video and subtitles in the enhancement timeline, using an ordered save
queue and a final flush when leaving the page. Existing audio-track metadata remains
the fallback for older timelines and newly added tracks. The saved enhancement edits
are also applied by the final mixer; a long clip extending past the film is trimmed
at the end, never shifted back to zero. Source audio files are not modified.
