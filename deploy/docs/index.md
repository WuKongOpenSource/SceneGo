# Deployment documentation

The public documentation is intentionally organized by stable contracts rather
than internal incident history.

- [`../../README.md`](../../README.md): project overview and local verification.
- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md): architecture, comments, and test expectations.
- [`../../docs/architecture/overview.md`](../../docs/architecture/overview.md): application layering and extension points.
- [`../../docs/architecture/content-workflow.md`](../../docs/architecture/content-workflow.md): candidates, selection, stale propagation, binding, and lineage.
- [`../../docs/architecture/compatibility.md`](../../docs/architecture/compatibility.md): compatibility shim and stored-identifier removal gates.
- [`database.md`](database.md): canonical migration manifest and persistence rules.
- [`agentic_testing.md`](agentic_testing.md): non-production agent test workflow.
- [`video-credit-pricing.md`](video-credit-pricing.md): video billing contract.
- [`seedream-seedance-storyboards.md`](seedream-seedance-storyboards.md): original Seedream storyboard inputs, account checks, and Seedance moderation boundaries.
- [`diagrams/`](diagrams/): generated route and page dependency diagrams.

Public installations follow the source-only
[`manual installation guide`](../../docs/open-source/manual-installation.zh-CN.md).
Generated OpenAPI from the selected application entrypoint is the authoritative
HTTP reference; private runtime catalogs are not a public installation input.
