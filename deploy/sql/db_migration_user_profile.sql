-- Current-user profile fields for self-service account settings.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_users_phone_number
    ON users(phone_number)
    WHERE phone_number IS NOT NULL;
