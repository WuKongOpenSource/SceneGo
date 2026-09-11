




ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb;


UPDATE users
SET permissions = '{
    "allowedModels": [
        "gemini-2.5-flash",
        "gemini-2.5-flash-image",
        "wan2-i2v",
        "wan2-morph",
        "sora2-i2v",
        "veo-i2v",
        "minimax-i2v"
    ],
    "priority": "normal",
    "canExport": true
}'::jsonb
WHERE permissions IS NULL OR permissions = '{}'::jsonb;


CREATE INDEX IF NOT EXISTS idx_users_permissions ON users USING GIN (permissions);


SELECT
    user_id,
    username,
    permissions
FROM users
LIMIT 5;
