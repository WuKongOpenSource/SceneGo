# Composition audio participation

## Impact assessment

The composition worker normalizes each chosen video before concatenation. In
`video_original` mode a video with an audio stream owns its sound; storyboard
reference speech and its metadata are not inputs for that clip. Decide this
before resolving or probing reference files, so an unused reference cannot
block composition. For silent videos, the existing reference-audio fallback
remains unchanged. Explicit `reference_dubbing`, global music and sound effects,
subtitle burning, cut offsets, and output registration retain their contracts.

This change has no schema, task submission, credits, or notification mutations.
It does not remap merged storyboard children, silently relax file authorization,
repair production data, or restart a composition. The worker implementation uses
per-shot references rather than an editor audio source-id map; any future
cross-shot reference feature must be designed against that actual contract.

Both composition pages render the existing server error as escaped visible text
through a shared notice. No HTML error content is executed and no new diagnostic
API or hidden server metadata is exposed. Empty errors receive a useful fallback.

## Regression gates

- Original audio never resolves unused legacy or segmented reference speech.
- Malformed unused speech duration cannot block a video with its own sound.
- Silent-video fallback and explicit reference dubbing still use references.
- Visible composition failure messages support missing and untrusted text.
- Composition service/DAO/router tests, frontend tests, builds and contracts pass.
