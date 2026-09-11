# 创剧 Engineering Rules

## Mandatory impact assessment

Before changing code, identify the affected workflow, shared state, persistence fields, API contracts, and downstream consumers. Evaluate whether the change can alter other pages, historical data, background tasks, credits, notifications, or deployment behavior. Reuse established project patterns and keep unrelated worktree changes intact.

## Mandatory test loop

A change is not complete after implementation alone. Run a verification loop until it is green:

1. Add or update focused regression tests for the changed behavior.
2. Run the focused tests and fix failures.
3. Run the relevant broader test suite to detect regressions in adjacent features.
4. Run the production build and repository contract checks when the changed surface can affect them.
5. Review the final diff and `git diff --check`.

Do not report a task as complete, commit it, push it, or deploy it while a relevant regression remains unexplained. If an unrelated pre-existing failure prevents a green run, document the exact failure and its ownership instead of hiding it.

## Repository boundary

This repository is the authoritative source for 创剧. Sibling repositories,
private deployment worktrees, and code from other products are outside its scope.
Do not inspect, merge, mirror, or modify them while working here.

When an external implementation inspires a capability, redesign it against this
repository's own persistence, API, task, credit, notification, provider, worker,
and deployment contracts. Copying a branch, database, private configuration, or
release script is prohibited. See `docs/repository-boundary.md`.

## Open-source hygiene

- Public code must not contain private repository names, internal domains,
  personal usernames, machine paths, credentials, or migration-source labels.
- The private distributed-storage project name and acronym are forbidden in
  every tracked path, file, test fixture, document, and reachable history blob.
- Provider and deployment configuration belongs in environment variables and
  documented examples. Never commit a usable secret.
- Historical import paths may remain only in the compatibility layer. Each shim
  must name its canonical module and explain the removal gate.
- Comments explain invariants, ownership, failure behavior, and extension points.
  Do not use comments as dated change logs or retain source-project history.
- Run `python deploy/scripts/check_open_source_hygiene.py` before release.

## SceneGo public mirror synchronization

- Treat `https://github.com/WuKongOpenSource/SceneGo` as the public-source mirror
  of this product. After a code fix is accepted in the authoritative repository,
  review whether the same behavior belongs in the public edition and synchronize
  every applicable source, test, migration, and user-facing document change.
- Keep an explicit mapping between the authoritative source revision and the
  SceneGo commit. Do not call a fix synchronized until the public build, focused
  tests, public import/route/boundary checks, manifest verification, and a fresh
  clone check have passed.
- Preserve the public-edition boundary during every synchronization: exclude
  credentials, production configuration, internal deployment automation,
  packaged artifacts, runtime data, and Ovideo-developed local ComfyUI agents,
  nodes, workflows, relays, and GPU operations.
- SceneGo uses standard `AGPL-3.0-only` community licensing plus the separate
  SceneGo Commercial License (MCL). Strongly request GitHub Fork development and
  upstream pull requests, but never describe that workflow as an additional
  AGPL authorization condition.
  Keep the official licensing and contact links pointed to
  `https://www.ostory.ai` and `https://www.rongyansuanli.com`.
