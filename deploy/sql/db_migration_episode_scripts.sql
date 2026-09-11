


CREATE TABLE IF NOT EXISTS episode_scripts (
    id SERIAL PRIMARY KEY,
    script_id VARCHAR(50) UNIQUE NOT NULL,
    episode_id VARCHAR(50) NOT NULL UNIQUE REFERENCES episodes(episode_id) ON DELETE CASCADE,
    original_content TEXT DEFAULT '',
    adapted_script TEXT DEFAULT '',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_episode_scripts_episode ON episode_scripts(episode_id);

CREATE OR REPLACE FUNCTION update_episode_scripts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_episode_scripts_updated_at ON episode_scripts;
CREATE TRIGGER trg_episode_scripts_updated_at
    BEFORE UPDATE ON episode_scripts
    FOR EACH ROW
    EXECUTE FUNCTION update_episode_scripts_updated_at();
