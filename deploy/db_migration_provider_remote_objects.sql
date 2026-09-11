-- Track per-user ownership for resources created in shared provider accounts.
CREATE TABLE IF NOT EXISTS provider_remote_objects (
    provider TEXT NOT NULL,
    object_type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider, object_type, object_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_remote_objects_owner
    ON provider_remote_objects (provider, user_id, object_type);
