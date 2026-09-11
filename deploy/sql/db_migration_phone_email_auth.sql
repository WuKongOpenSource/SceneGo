-- Phone-first authentication, legacy-account migration, and verified email delivery.
-- Stable users.user_id values remain unchanged so projects, credits, and assets keep ownership.

ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_login_enabled BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notification_preferences JSONB NOT NULL DEFAULT
    '{"task_success":true,"task_failure":true,"credit_alert":true,"sharing":true}'::jsonb;

-- Accounts that existed before this migration may use username/password only long enough
-- to bind and verify a real phone number. Newly-created accounts default to phone-only login.
UPDATE users
SET legacy_login_enabled = TRUE
WHERE legacy_login_enabled IS NULL;

ALTER TABLE users ALTER COLUMN legacy_login_enabled SET DEFAULT FALSE;
ALTER TABLE users ALTER COLUMN legacy_login_enabled SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone_number
    ON users(phone_number)
    WHERE phone_number IS NOT NULL AND phone_verified = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_verified_email
    ON users(lower(email))
    WHERE email IS NOT NULL AND email_verified = TRUE;

CREATE TABLE IF NOT EXISTS email_outbox (
    id BIGSERIAL PRIMARY KEY,
    message_id VARCHAR(64) UNIQUE NOT NULL,
    dedupe_key VARCHAR(160) UNIQUE,
    user_id VARCHAR(50) REFERENCES users(user_id) ON DELETE CASCADE,
    recipient VARCHAR(255) NOT NULL,
    message_type VARCHAR(40) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body_text TEXT NOT NULL,
    body_html TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    claimed_at TIMESTAMP,
    sent_at TIMESTAMP,
    last_error TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_email_outbox_status
        CHECK (status IN ('pending', 'sending', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_delivery
    ON email_outbox(status, available_at, created_at);

CREATE INDEX IF NOT EXISTS idx_email_outbox_user
    ON email_outbox(user_id, created_at DESC);
