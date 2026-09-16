# Compatibility policy

Historical import paths and stored identifiers may be retained temporarily when
removing them would break deployed extensions, migrations, or existing data.

## Import shims

A compatibility module may only re-export a canonical implementation. Its module
docstring must identify the canonical path and state that new code must not use
the shim. Business logic, constants, and side effects must not be duplicated in a
shim.

## Stored identifiers

Legacy model keys and task kinds may be accepted when reading historical rows.
They must not appear in current capability manifests or selectable UI lists.
Compatibility mapping belongs in one catalog, with tests for both current and
historical values.

## Removal gate

A shim or stored-key mapping can be removed after repository-wide imports are
gone, supported migrations no longer emit the value, background queues contain
no matching tasks, and a release note documents the breaking change.
