# Workflow performance contracts

The audio, enhancement, and final-film stages use bounded rendering and scoped reads.
This changes neither generation quality nor source bytes, provider defaults, billing,
saved timeline formats, or access-control requirements.

## Budgets

- Enhancement requests current video and actor recordings through one authenticated
  `GET /api/episodes/{episode_id}/enhance-files`. Episode membership is checked before
  the query. Deleted files, other episodes and other entity types are excluded.
  The selected original video wins even if older than the history page; otherwise
  the newest original is used. Actor recordings retain the previous 50-per-segment cap.
  File paths, credentials and unrelated history metadata are not returned.
- Audio durations are indexed by shot once. The 1,000-shot / 2,000-clip regression
  fixture reduces clip-key inspections from 2,000,000 to 5,000, with identical durations.
  Timing numbers are machine-dependent; operation counts are the regression gate.
- Enhancement and audio timelines render the visible horizontal window plus overscan.
  Playback does not recreate the enhancement track layers. Pointer events are merged
  per animation frame, and the final pointer position is flushed before saving.
- Final-film history loads 24 entries per request, with explicit loading of older
  versions. Unchanged source URLs are memoized and offscreen videos do not preload.
- At most two uncached thumbnails are generated concurrently per application process.
  Identical requests share one job; image resizing runs outside the async event loop.
  A disconnected viewer does not cancel a job needed by another viewer. Every request
  still performs its own authorization; only derived thumbnails are cached.
- Workflow slices share pending reads. Mutations queue at most one trailing refresh
  while a previous read is running, preventing a pre-mutation response from winning.
  Failed loads are retryable and caches are scoped by episode, script and asset scope.
  Page navigation may prefetch code on pointer/focus intent, not user data. Save-data
  and slow-connection settings suppress this prefetch.

## Verification

Frontend regression suites include `workflowPerformance`, `sliceRequests`,
`useTimelineViewport`, `EpisodeContext.loading`, audio editing and final-film paging.
Backend `test_workflow_performance.py` covers batch authorization and query semantics,
thumbnail concurrency, disconnects, retry and event-loop isolation.

In a read-only nine-segment service comparison, metadata requests dropped from 18 to 1
and database queries from 108 to 4, while selected file identities remained identical.
Service-only median time over four runs was 20.75 ms versus 1.46 ms. This is not a
browser click-latency measurement and excludes network time. Browser acceptance should
check route switching, scrolling long timelines, play/pause/seek, drag/trim/undo/save,
audio overlays, subtitles, final-film paging, and cross-episode navigation under slow
network conditions. Never substitute a thumbnail for an original generation input.
