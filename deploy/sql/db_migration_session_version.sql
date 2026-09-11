-- Revocable browser/API sessions.
-- Incrementing this value invalidates every token issued for the account.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS session_version BIGINT NOT NULL DEFAULT 1;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS ck_users_session_version_positive;

ALTER TABLE users
    ADD CONSTRAINT ck_users_session_version_positive CHECK (session_version >= 1);
