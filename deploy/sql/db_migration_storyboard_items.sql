


CREATE TABLE IF NOT EXISTS storyboard_items (
    id SERIAL PRIMARY KEY,
    item_id VARCHAR(50) UNIQUE NOT NULL,
    episode_id VARCHAR(50) NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    scene_heading TEXT DEFAULT '',
    action_text TEXT DEFAULT '',
    dialogue TEXT DEFAULT '',
    camera_movement TEXT DEFAULT '',
    image_prompt TEXT DEFAULT '',
    video_prompt TEXT DEFAULT '',
    generated_image_url TEXT,
    bound_assets JSONB DEFAULT '[]'::jsonb,
    status VARCHAR(20) DEFAULT 'draft',
    -- Audio fields (populated by AudioStage)
    dialogue_audio_url TEXT,
    narration_audio_url TEXT,
    sfx_audio_url TEXT,
    audio_duration_ms INTEGER,
    planned_duration_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_storyboard_items_episode ON storyboard_items(episode_id);
CREATE INDEX IF NOT EXISTS idx_storyboard_items_episode_sort ON storyboard_items(episode_id, sort_order);

CREATE OR REPLACE FUNCTION update_storyboard_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_storyboard_items_updated_at ON storyboard_items;
CREATE TRIGGER trg_storyboard_items_updated_at
    BEFORE UPDATE ON storyboard_items
    FOR EACH ROW
    EXECUTE FUNCTION update_storyboard_items_updated_at();
