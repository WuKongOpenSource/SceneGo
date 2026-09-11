


CREATE TABLE IF NOT EXISTS assets (
    id SERIAL PRIMARY KEY,
    asset_id VARCHAR(50) UNIQUE NOT NULL,
    project_id VARCHAR(50) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    episode_id VARCHAR(50) REFERENCES episodes(episode_id) ON DELETE SET NULL,
    asset_type VARCHAR(20) NOT NULL CHECK (asset_type IN ('character', 'scene', 'prop')),
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    thumbnail_url TEXT,
    reference_images JSONB DEFAULT '[]'::jsonb,
    style_params JSONB DEFAULT '{}'::jsonb,
    tags JSONB DEFAULT '[]'::jsonb,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_assets_project_episode ON assets(project_id, episode_id);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);

CREATE OR REPLACE FUNCTION update_assets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assets_updated_at ON assets;
CREATE TRIGGER trg_assets_updated_at
    BEFORE UPDATE ON assets
    FOR EACH ROW
    EXECUTE FUNCTION update_assets_updated_at();
