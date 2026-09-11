


CREATE TABLE IF NOT EXISTS episodes (
    id SERIAL PRIMARY KEY,
    episode_id VARCHAR(50) UNIQUE NOT NULL,
    project_id VARCHAR(50) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    episode_number INTEGER NOT NULL,
    episode_name VARCHAR(255) NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'draft',  -- draft, in_progress, completed, published
    settings JSONB DEFAULT '{}'::jsonb,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, episode_number)
);

CREATE INDEX IF NOT EXISTS idx_episodes_project ON episodes(project_id);
CREATE INDEX IF NOT EXISTS idx_episodes_project_sort ON episodes(project_id, sort_order);


CREATE OR REPLACE FUNCTION update_episodes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_episodes_updated_at ON episodes;
CREATE TRIGGER trg_episodes_updated_at
    BEFORE UPDATE ON episodes
    FOR EACH ROW
    EXECUTE FUNCTION update_episodes_updated_at();
