# Subtitle defaults

The editor and composition service use a default subtitle font size of 50,
increased from 42 (approximately 19%). New cues without an explicit style use
the larger default at the bottom of the picture.

Saved cue styles remain authoritative: changing the default does not rewrite
existing font sizes, positions, colors, backgrounds or timings. A customized
title retains its own size. Resetting a cue to the default position and size
uses 50; opt-in batch editing remains separate from this default.

The preview and export continue to use the existing source-picture typography
contract, including proportional scaling in the composed output.

This source synchronization is based on revision
`633c43a811a91b6ff0bfed309f7e808431930b2e`. It changes application subtitle
defaults and regression tests only; it does not add a local model runtime,
reprocess saved media or perform a deployment.
