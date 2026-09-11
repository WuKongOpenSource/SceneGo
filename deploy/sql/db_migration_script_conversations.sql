-- Persistent script conversations and immutable storyboard-script versions.

CREATE TABLE IF NOT EXISTS episode_script_messages (
    id SERIAL PRIMARY KEY,
    message_id VARCHAR(100) UNIQUE NOT NULL,
    episode_id VARCHAR(50) NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    script_id VARCHAR(50) NOT NULL REFERENCES episode_scripts(script_id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'completed'
        CHECK (status IN ('pending', 'streaming', 'completed', 'failed', 'cancelled')),
    model_alias VARCHAR(100),
    provider VARCHAR(100),
    model_name VARCHAR(255),
    reply_to_message_id VARCHAR(100),
    request_id VARCHAR(100),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_script_messages_script_time
    ON episode_script_messages(script_id, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_script_messages_request
    ON episode_script_messages(script_id, request_id)
    WHERE request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS episode_script_versions (
    id SERIAL PRIMARY KEY,
    version_id VARCHAR(100) UNIQUE NOT NULL,
    episode_id VARCHAR(50) NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    script_id VARCHAR(50) NOT NULL REFERENCES episode_scripts(script_id) ON DELETE CASCADE,
    message_id VARCHAR(100) REFERENCES episode_script_messages(message_id) ON DELETE SET NULL,
    version_no INTEGER NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    storyboard_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    source VARCHAR(20) NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'manual', 'legacy')),
    status VARCHAR(20) NOT NULL DEFAULT 'ready' CHECK (status IN ('draft', 'ready', 'failed')),
    model_alias VARCHAR(100),
    provider VARCHAR(100),
    model_name VARCHAR(255),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (script_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_script_versions_script_no
    ON episode_script_versions(script_id, version_no DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_script_versions_message
    ON episode_script_versions(message_id)
    WHERE message_id IS NOT NULL;

ALTER TABLE episode_scripts ADD COLUMN IF NOT EXISTS current_version_id VARCHAR(100);
ALTER TABLE episode_scripts ADD COLUMN IF NOT EXISTS default_model VARCHAR(100) DEFAULT 'deepseek-chat';
ALTER TABLE episode_scripts ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'episode_scripts_current_version_fk'
    ) THEN
        ALTER TABLE episode_scripts
            ADD CONSTRAINT episode_scripts_current_version_fk
            FOREIGN KEY (current_version_id)
            REFERENCES episode_script_versions(version_id)
            ON DELETE SET NULL;
    END IF;
END $$;

ALTER TABLE storyboard_items ADD COLUMN IF NOT EXISTS source_version_id VARCHAR(100);
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'storyboard_items_source_version_fk'
    ) THEN
        ALTER TABLE storyboard_items
            ADD CONSTRAINT storyboard_items_source_version_fk
            FOREIGN KEY (source_version_id)
            REFERENCES episode_script_versions(version_id)
            ON DELETE SET NULL;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_storyboard_items_source_version
    ON storyboard_items(source_version_id);

-- Backfill existing files into a first conversation turn without changing their content.
INSERT INTO episode_script_messages (
    message_id, episode_id, script_id, role, content, status, metadata, created_at, updated_at
)
SELECT
    'msg_legacy_user_' || es.script_id,
    es.episode_id,
    es.script_id,
    'user',
    es.original_content,
    'completed',
    jsonb_build_object('legacy', true),
    es.created_at,
    es.updated_at
FROM episode_scripts es
WHERE COALESCE(BTRIM(es.original_content), '') <> ''
ON CONFLICT (message_id) DO NOTHING;

INSERT INTO episode_script_messages (
    message_id, episode_id, script_id, role, content, status,
    model_alias, provider, model_name, metadata, created_at, updated_at
)
SELECT
    'msg_legacy_assistant_' || es.script_id,
    es.episode_id,
    es.script_id,
    'assistant',
    COALESCE(NULLIF(es.adapted_script, ''), es.original_content),
    'completed',
    '历史版本',
    'legacy',
    'legacy',
    jsonb_build_object('legacy', true),
    es.created_at,
    es.updated_at
FROM episode_scripts es
WHERE COALESCE(BTRIM(COALESCE(NULLIF(es.adapted_script, ''), es.original_content)), '') <> ''
ON CONFLICT (message_id) DO NOTHING;

INSERT INTO episode_script_versions (
    version_id, episode_id, script_id, message_id, version_no, content,
    storyboard_items, source, status, model_alias, provider, model_name,
    metadata, created_at, updated_at
)
SELECT
    'ver_legacy_' || es.script_id,
    es.episode_id,
    es.script_id,
    'msg_legacy_assistant_' || es.script_id,
    1,
    COALESCE(NULLIF(es.adapted_script, ''), es.original_content),
    COALESCE((
        SELECT jsonb_agg(to_jsonb(si) ORDER BY si.sort_order, si.id)
        FROM storyboard_items si
        WHERE si.script_id = es.script_id
    ), '[]'::jsonb),
    'legacy',
    'ready',
    '历史版本',
    'legacy',
    'legacy',
    jsonb_build_object('legacy', true),
    es.created_at,
    es.updated_at
FROM episode_scripts es
WHERE COALESCE(BTRIM(COALESCE(NULLIF(es.adapted_script, ''), es.original_content)), '') <> ''
ON CONFLICT (version_id) DO NOTHING;

UPDATE episode_scripts es
SET current_version_id = 'ver_legacy_' || es.script_id,
    last_message_at = COALESCE(es.last_message_at, es.updated_at)
WHERE es.current_version_id IS NULL
  AND EXISTS (
      SELECT 1 FROM episode_script_versions v
      WHERE v.version_id = 'ver_legacy_' || es.script_id
  );
UPDATE storyboard_items si
SET source_version_id = 'ver_legacy_' || si.script_id
WHERE si.source_version_id IS NULL
  AND si.script_id IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM episode_script_versions v
      WHERE v.version_id = 'ver_legacy_' || si.script_id
  );
