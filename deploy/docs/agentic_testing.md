# Automated testing strategy

## Decision

创剧 uses four explicit phases while keeping deterministic checks authoritative:

1. **Discover**: inspect runtimes, dependencies, repository state, and available
   test surfaces.
2. **Plan**: build an explicit list of frontend, backend, contract, build, source,
   and optional live-smoke checks.
3. **Execute**: run each check with its own timeout and preserve stdout/stderr.
4. **Report**: write raw JSONL evidence and a readable Markdown summary using
   `PASS`, `PARTIAL`, `FAIL`, and `NOT_ATTEMPTED`.

Run the suite from `deploy`:

```powershell
.\.venv\Scripts\python.exe scripts\run_agentic_test_suite.py `
  --base-url https://tv.ostory.ai
```

Reports are written to `deploy/logs/` and are intentionally ignored by Git.

## Why deterministic checks remain authoritative

An LLM tester can discover unexpected workflow or security defects, but its
plan, execution choices, and verdicts vary between runs. It also cannot prove
pixel alignment, database transaction correctness, or exact request contracts
without purpose-built adapters and assertions. It may consume paid model calls
or mutate production data if approvals are too broad.

创剧 therefore uses three layers:

1. **Release gate**: Vitest, Pytest, route contracts, architecture contracts,
   production build, whitespace checks, and non-mutating public smoke tests.
2. **Browser rendering suite**: the CDP-based public smoke check covers desktop
   and mobile viewports, JavaScript exceptions, build failures, horizontal
   overflow, protected-route login redirects, login UI markers, and screenshots
   without adding a browser-test dependency. It is intentionally read-only and
   does not sign in. A future authenticated adapter must use a dedicated test account/project,
   deterministic fixtures, and cleanup.
3. **Exploratory agent run**: an optional LLM layer that proposes and performs
   bounded scenarios against the browser/API adapter. Its output is evidence,
   not the final release verdict.

## Status semantics

- `PASS`: the check ran and all required assertions passed.
- `PARTIAL`: the command passed, but required coverage was unavailable. The
  current example is PostgreSQL integration coverage when no local test database
  is running.
- `FAIL`: the check ran and a required assertion failed or timed out.
- `NOT_ATTEMPTED`: a required executable, dependency, credential, or test surface
  was unavailable before execution.

Set `OSTORY_REQUIRE_TEST_DB=true` in CI to turn an unavailable PostgreSQL test
database into a hard failure. Authenticated live workflow checks should use a
dedicated test account and must not reuse an administrator's production data.
