


CREATE TABLE IF NOT EXISTS timeline_tracks (
    id SERIAL PRIMARY KEY,
    track_id VARCHAR(50) UNIQUE NOT NULL,
    episode_id VARCHAR(50) NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    track_type VARCHAR(20) NOT NULL CHECK (track_type IN ('video', 'audio', 'subtitle')),
    track_name VARCHAR(255) DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    items JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_timeline_tracks_episode ON timeline_tracks(episode_id);

CREATE OR REPLACE FUNCTION update_timeline_tracks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_timeline_tracks_updated_at ON timeline_tracks;
CREATE TRIGGER trg_timeline_tracks_updated_at
    BEFORE UPDATE ON timeline_tracks
    FOR EACH ROW
    EXECUTE FUNCTION update_timeline_tracks_updated_at();
