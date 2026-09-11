# Contributing to SceneGo

## Before coding

1. Describe the affected workflow and its persisted state.
2. Identify API, task, billing, notification, provider, and worker consumers.
3. Confirm whether historical rows or in-flight tasks need compatibility.
4. Add a focused regression test before changing a shared contract.

## Architecture rules

- Keep provider model identifiers behind capability and runtime configuration
  services. User-facing components consume stable public model keys and labels.
- Treat candidate creation and candidate selection as separate operations.
- Resolve current content bindings at submission time; do not cache mutable asset
  URLs inside long-lived UI state.
- Propagate staleness narrowly. Never delete downstream outputs or regenerate
  billable content without an explicit user action.
- Attach asynchronous results by lineage and never replace a newer user choice.
- Compatibility modules may import and re-export canonical implementations, but
  new code must import the canonical module directly.

## Comment standard

Useful comments explain why a rule exists, what data invariant is protected, or
how a future implementation may be extended. Avoid dates, ticket numbers,
migration-source names, and descriptions of code that are obvious from the code
itself. Public functions that coordinate persistence or billing should document:

- inputs and ownership;
- idempotency or retry behavior;
- success/failure side effects;
- compatibility assumptions.

## Verification

Run focused tests first, then the broader affected suites. Changes to frontend,
routes, persistence, or public contracts also require the production build,
route contract, open-source hygiene check, and `git diff --check`.

Never commit real credentials, local databases, generated media, production
backups, or internal deployment reports.

## Fork and upstream workflow

We strongly request that every community modification be developed in a GitHub
Fork of [WuKongOpenSource/SceneGo](https://github.com/WuKongOpenSource/SceneGo).
Keep the upstream repository configured as a remote, maintain a reviewable
commit history, and submit generally useful fixes and improvements to the
original repository as pull requests.

This workflow is a strong project collaboration request. It is not an
additional restriction on, or a condition of, the rights granted by the GNU
Affero General Public License v3.0. A pull request is reviewed independently and
submission does not guarantee acceptance or merge.

## Contribution licensing

By submitting a contribution, you agree that it is licensed to the public under
`AGPL-3.0-only`. Contributions intended for inclusion in code offered under the
separate SceneGo Commercial License (MCL) require a contributor agreement with
the project owner before they can be accepted. Maintainers will provide that
agreement through the official channels listed in `COMMERCIAL_LICENSE.md`.
