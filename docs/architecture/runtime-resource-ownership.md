# Runtime resource ownership

Each application lifespan owns its database and Redis clients. Acquisition must
register cleanup immediately: a startup failure before readiness still unwinds
all resources acquired so far. Connection cleanup must continue if a preceding
close raises an exception.

## Shutdown order

The mixed entrypoint groups consumer cleanup separately from connection cleanup:

1. Cancel and join application background tasks.
2. Ask workers to stop, preserving the existing graceful-task wait.
3. Cancel and join worker processing tasks, including their owned heartbeats.
4. Stop and join each instantiated cluster manager's health loop.
5. Close subscription Redis, business Redis, and the database pool.
6. Drop process-local service references. Do not remove persisted queue data.

Worker heartbeats are also joined when the processing loop returns, raises, or is
cancelled. A graceful stop cancelled by its caller must not leave a heartbeat
using clients that are about to close. Cluster manager start is idempotent while
its health loop is running; stopping one manager does not change remote node
status or start/stop any external node service.

`BACKGROUND_TASK_SHUTDOWN_TIMEOUT_SECONDS` defaults to 5 seconds,
`WORKER_STOP_TIMEOUT_SECONDS` to 8 seconds,
`WORKER_TASK_CANCEL_TIMEOUT_SECONDS` to 5 seconds, and
`CLUSTER_MANAGER_SHUTDOWN_TIMEOUT_SECONDS` to 5 seconds. These bound cooperative
async cleanup; they are not a guarantee that arbitrary cancellation-resistant
code, external provider requests, native threads, or node jobs have terminated.

## Startup and signals

The ASGI server owns process shutdown signals. The mixed runtime temporarily
blocks worker signal-handler registration. This guard must remain installed
until partially started workers have been joined: a scheduled worker can first
run during startup rollback. Successful startup restores the server's original
handlers before serving requests.

Both mixed and agent-only modes keep their prior startup behavior. An explicit
zero-worker configuration remains supported. A database initialization failure
still prevents production startup; the existing development-only fallback is
unchanged. Queue migration and task/credit semantics are not cleanup operations.

## Canonical imports

Worker imports must not prepend the `core` directory to `sys.path`. Doing so lets
Python load a canonical module again under a legacy name and can create a second
database singleton outside application ownership. Internal imports use package
paths; root-level compatibility shims re-export the same objects. Fresh-process
import-order tests protect this identity, not only an already populated test
runner's module cache.

## Verification boundaries

The lifecycle suites inject startup, body, cancellation, and close failures and
check both application modes, zero workers, repeated lifespans, cleanup order,
signal ownership, heartbeat joins, and canonical imports. No test may probe an
actual node or consume real generation tasks.

Mocked tests must be supplemented with isolated real PostgreSQL, Redis and HTTP
verification, including fresh-process restarts and checks for leftover database
connections and tasks. For a mixed-mode fixture, configure all nodes as disabled;
this validates application lifecycle, not GPU execution. Public-entrypoint
verification remains necessary when changing the shared online worker. Browser,
provider generation, registration delivery and disaster recovery are separate
acceptance scopes.
