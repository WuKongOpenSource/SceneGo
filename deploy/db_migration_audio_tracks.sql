


CREATE TABLE IF NOT EXISTS audio_tracks (
    id SERIAL PRIMARY KEY,
    track_id VARCHAR(50) UNIQUE NOT NULL,
    episode_id VARCHAR(50) NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    track_type VARCHAR(30) NOT NULL CHECK (track_type IN ('bgm', 'sfx_global', 'narration_global')),
    name VARCHAR(255) DEFAULT '',
    audio_url TEXT,
    duration_ms INTEGER,
    start_item_id VARCHAR(50) REFERENCES storyboard_items(item_id) ON DELETE SET NULL,
    end_item_id VARCHAR(50) REFERENCES storyboard_items(item_id) ON DELETE SET NULL,
    generation_params JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audio_tracks_episode ON audio_tracks(episode_id);

CREATE OR REPLACE FUNCTION update_audio_tracks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audio_tracks_updated_at ON audio_tracks;
CREATE TRIGGER trg_audio_tracks_updated_at
    BEFORE UPDATE ON audio_tracks
    FOR EACH ROW
    EXECUTE FUNCTION update_audio_tracks_updated_at();



ALTER TABLE canvas_boards ADD COLUMN IF NOT EXISTS episode_id VARCHAR(50) REFERENCES episodes(episode_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_canvas_boards_episode ON canvas_boards(episode_id);
