


CREATE TABLE IF NOT EXISTS video_segments (
    id SERIAL PRIMARY KEY,
    segment_id VARCHAR(50) UNIQUE NOT NULL,
    episode_id VARCHAR(50) NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    storyboard_item_id VARCHAR(50) REFERENCES storyboard_items(item_id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    generation_mode VARCHAR(30) DEFAULT 'i2v',
    model VARCHAR(50) DEFAULT '',
    input_params JSONB DEFAULT '{}'::jsonb,
    video_url TEXT,
    thumbnail_url TEXT,
    duration_ms INTEGER,
    task_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_video_segments_episode ON video_segments(episode_id);
CREATE INDEX IF NOT EXISTS idx_video_segments_storyboard ON video_segments(storyboard_item_id);

CREATE OR REPLACE FUNCTION update_video_segments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_video_segments_updated_at ON video_segments;
CREATE TRIGGER trg_video_segments_updated_at
    BEFORE UPDATE ON video_segments
    FOR EACH ROW
    EXECUTE FUNCTION update_video_segments_updated_at();
