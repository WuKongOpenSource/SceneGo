# Architecture overview

创剧 separates transport, application rules, persistence, provider clients,
and user interface state so that each layer can evolve without exposing provider
or deployment details to end users.

## Backend layers

- `routers/` validates HTTP requests and translates application errors.
- `services/` owns workflow, billing, attachment, and orchestration rules.
- `dao/` owns SQL and persistence-specific data mapping.
- `external_api/` adapts third-party provider protocols.
- `core/` owns shared infrastructure such as authentication, queues, and workers.
- root-level compatibility modules only support historical import paths.

Routers must not implement billing or provider selection. Provider clients must
not mutate project state. Workers report results through services so that lineage,
selection, notification, and successful-generation billing rules stay consistent.

## Frontend layers

- pages and components render workflows and collect explicit user intent;
- services define API contracts and normalize runtime capabilities;
- shared workflow helpers own candidate, selection, binding, and stale state;
- provider identifiers remain diagnostic metadata and are not public labels.

## Extension points

Add a provider by extending the runtime registry and capability manifest, then
mapping it to a stable public model key. Add a media workflow by defining its
candidate slot, lineage target, selection behavior, stale dependencies, and
billing event before adding UI controls.

See [content-workflow.md](content-workflow.md) for the cross-media state model and
[compatibility.md](compatibility.md) for removal rules around historical imports.
