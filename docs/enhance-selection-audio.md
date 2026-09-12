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

Music and global effects support independent fade-in/out seconds. Zero disables a
fade; their combined length cannot exceed the edited audio duration. Input remains
an editable draft until blur or Enter. Preview and the final mixer apply the same
linear gain envelope relative to the trimmed audio clip, multiplied by its volume.

The export probes each selected managed video before any database writes. Its actual
duration replaces missing or stale metadata. A legacy full-source cut grows to the
verified source length; an explicit trim stays intact. New snapshots record source
URL and duration to distinguish a replacement source from a manual cut. A missing or
unreadable selected source stops the whole export, leaving history and edits intact.

Merged cards retain ordered storyboard anchors, weighted by the shots' planned
durations within the selected video. Reference audio is rebuilt against these cuts,
including their source offsets and black gaps, rather than historical segment order.
These anchors are an editorial alignment, not speech recognition of generated video.
The final mixer resolves anchor audio only from storyboard rows in the same episode.

Use **Insert black** at the playhead to add a silent black clip at a video boundary.
Change its length (0.1–300 seconds), drag it between clips, or delete it. Linked speech
moves with its video; independent music, effects and subtitles retain their own
positions. Black clips survive saving and re-export and require no generated asset.

AI subtitles seek directly in authorized managed media (up to 2 GB) instead of
base64-loading the original video through the remote-input size limit. Only the
requested audio range is extracted as mono 16 kHz WAV, bounded to 60 seconds and
2 MB. Media protocol/format allowlists, timeouts, project access and concurrency
limits still apply. Black clips are silence and are skipped during recognition.
