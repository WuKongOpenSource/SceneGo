# Repository boundary

创剧 is developed as an independent product. This repository owns its
branding, navigation, persistence schema, model catalog, billing rules, worker
protocol, test fixtures, release metadata, and deployment examples.

External code may be used only when its license and provenance are compatible
with the chosen project license. A port must be reviewed as a new implementation:

1. document the intended behavior rather than its source;
2. implement against the local architecture and naming conventions;
3. add tests for persistence, background tasks, billing, and failure behavior;
4. remove external product names, paths, endpoints, credentials, and release
   assumptions;
5. record third-party attribution when the license requires it.

Sibling repositories and private production worktrees are not part of a 创剧
task. Repository tools must not scan or mutate them.
