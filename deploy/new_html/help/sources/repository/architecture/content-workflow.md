# Content workflow invariants

This document is the contract for image, video, and audio outputs.

## Candidate takes and selection

A generation result creates a take in a named slot such as `keyframe`, `video`,
or `dialogue_audio:<segment-id>`. Creating a take does not select it. Selection is
an explicit, idempotent action scoped to an entity, lineage, and slot.

This separation prevents a late task from replacing the take currently chosen by
the user.

## Stable lineage

Storyboard revisions may replace database row identifiers while a provider task
is running. Submission metadata therefore records the requested entity and its
stable lineage identifier. Result attachment resolves the current entity for that
lineage and records whether the attachment was late.

## Bindings

Asset bindings are stored as project defaults with optional shot overrides. The
effective binding is resolved immediately before task submission. Generated task
payloads may record the resolved binding version for audit, but mutable URLs must
not become the source of truth.

## Stale propagation

Changes to scripts, characters, scenes, props, or selected upstream takes create
stale events only for affected downstream slots. A stale event is advisory state:
it never deletes an output and never starts a billable generation automatically.

## Structured script patches

AI-assisted script editing produces a structured patch with additions, removals,
and replacements. The patch is previewed and confirmed before a new active script
version is written. Rejected patches remain non-authoritative.
