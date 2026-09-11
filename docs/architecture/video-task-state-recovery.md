# Video task state recovery

The workspace snapshot is not authoritative for generation status. A saved
card can still contain progress 5 after the provider task has completed and its
output file has been saved. Reloading must reconcile that snapshot with the
authenticated task API, without submitting another paid generation.

## Ownership and recovery rules

- Match the server task by workspace group, video segment, or the exact task ID
  saved on an existing card. Keep episode checks before every match.
- Recover completed output candidates without dropping previous candidates.
  Failed and cancelled attempts must stop displaying an active spinner; an
  unsuccessful retry must not remove an earlier video.
- A poll belongs to one card and one backend task incarnation. Allow only one
  status request in flight for that incarnation. Ignore responses and errors
  arriving after it is stopped or replaced.
- Bound each status GET to 30 seconds and abort that GET when stopping the poll.
  Transient query failures are retried against the same task ID. Neither query
  timeout nor an aborted GET cancels or recreates the provider task.
- Support pending/queued and running/processing server states. Terminal history
  results stop matching polls and release any batch wait for that attempt.
- The delayed workspace-restore timer must not restart a settled attempt.
  Prompt and callback changes must not create a history-request render loop.

## Impact boundary

This change affects video cards, shared task observation, workspace restoration,
candidate display, and batch completion waits in both frontend editions. The
task-query helper only adds an optional AbortSignal; existing callers retain the
same HTTP contract. Authentication, episode filtering, provider payloads,
original media bytes, database schemas, credit settlement and generation
submission are unchanged. No production data migration is performed.

## Regression coverage

The tests cover slow and hung requests, stale completion/failure/404 responses,
repeated generation on the same card, page detach/reattach, all active task
states, terminal snapshot recovery, cross-episode rejection, and real component
restoration from a saved 5-percent card. The component test retains both the old
and recovered video and asserts that it sends no generation POST. These tests
simulate provider responses; they are not evidence of a new paid generation.
