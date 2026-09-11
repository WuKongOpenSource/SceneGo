# Administrative grouping

Project groups and projects are separate entities. Creator and administrator views
use the same `project_groups` records and `projects.group_id` relationship. A group
rename keeps its identity; deletion retains projects and removes group sharing.
Only a project owner may assign a project to one of their owned groups.

Node registry classification uses `comfyui_agents.registry_kind`: `managed` for
operator-controlled equipment (including configurable rented cloud GPUs), and
`external` for provider-operated execution with usage access only. A null legacy
value is shown provisionally in the local section with an unconfirmed label.
Classification is administrative metadata only. It neither changes node identity,
authentication, enablement, heartbeat, tasks, nor grants workflow compatibility.
Its update endpoint is restricted to super administrators and records an audit.
Do not treat this registry label as a scheduling or runtime authorization policy.
