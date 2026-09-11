# Generation output and provider-error contracts

Seedance output defaults belong to Seedance, not to the shared request model's
Wan default. A missing output resolution is 720p in both the visible composer and
the submitted request. Historical upper-case values are canonicalized; invalid
or unsupported explicit values are rejected rather than silently downgraded.

The shared frontend helper is used by the normal and public-source task adapters,
including generic video submission. Request-model validation runs before queue
submission, access-linked writes and credit reservation. The provider adapter
validates once more using the resolved model, while retaining channel-specific
model routing, media roles, original-image handling and requested duration.

Provider billing failures can carry HTTP 403. The image adapter classifies
structured quota codes before authentication status and returns a bounded safe
message. It does not reveal credentials, upstream account identifiers or balances,
and does not change providers, credit ledgers, saved images or automatic retry
policy. Actual provider balance must be resolved by the operator.

## Verification boundary

Regression coverage includes missing/upper-case resolutions, early rejection,
public and normal task adapters, composer state preservation, actual enqueue
payloads, media persistence, original-image provenance, billing and notifications.
No live paid generation is required for these contract checks.

Three existing architecture checks fail on the unchanged main-branch baseline:
`check_api_config_runtime_loader.py` reports `Seedance standard model was not
projected to sub-model env`; `check_admin_api_config_crud.py` reports `preset facade
count changed: 25`; `check_service_dao_boundary.py` reports direct `execute()` calls
in `services/user_presence_service.py`. All three failures were reproduced with
original baseline Python modules loaded in place of this patch. They belong to
provider configuration, catalog contracts and presence persistence respectively;
this change does not alter those modules or fixtures. The other seven architecture
checks pass.

The full frontend suite passes 1,241 tests with three existing TODOs. TypeScript,
normal and public builds pass. The focused and adjacent backend suite passes 194
tests, including media persistence, routing, worker, credit and notification tests.

Frontend source-text assertions require LF fixtures on Windows. Normalizing only
their checkout line endings produced no Git content change and allowed the full
frontend suite to pass. Do not mistake a line-ending assertion for a UI regression.

## Integrated release verification

The release candidate preserves the newer deployed project's snapshot ownership,
saved-outcome, model-routing and captcha changes. On that integrated baseline the
full frontend suite passes 1,306 tests and all ten architecture contracts pass.
The backend selection passes 205 tests; 21 database integration tests are skipped
because no dedicated test database is configured. They are not run against live
data. Normal frontend build and TypeScript checks pass.
