
-- For: docs/superpowers/specs/2026-05-29-scriptpage-three-stage-generation-design.md §5.1
-- Idempotent: IF NOT EXISTS

DO $$
BEGIN
    RAISE NOTICE '[migration] episode_script_segments start at %', clock_timestamp();
END
$$;

CREATE TABLE IF NOT EXISTS episode_script_segments (
    id SERIAL PRIMARY KEY,
    segment_id VARCHAR(50) UNIQUE NOT NULL,
    episode_id VARCHAR(50) NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
    script_id VARCHAR(50) REFERENCES episode_scripts(script_id) ON DELETE CASCADE,
    segment_order INTEGER NOT NULL DEFAULT 0,
    source_text TEXT NOT NULL DEFAULT '',
    estimated_duration_sec INTEGER,
    video_script TEXT DEFAULT '',
    status VARCHAR(20) DEFAULT 'pending',
    error_message TEXT DEFAULT '',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_episode_script_segments_episode
    ON episode_script_segments(episode_id);
CREATE INDEX IF NOT EXISTS idx_episode_script_segments_script_order
    ON episode_script_segments(script_id, segment_order);

CREATE OR REPLACE FUNCTION update_episode_script_segments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_episode_script_segments_updated_at ON episode_script_segments;
CREATE TRIGGER trg_episode_script_segments_updated_at
    BEFORE UPDATE ON episode_script_segments
    FOR EACH ROW
    EXECUTE FUNCTION update_episode_script_segments_updated_at();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'episode_script_segments') THEN
        RAISE EXCEPTION '[migration] episode_script_segments table missing';
    END IF;
    RAISE NOTICE '[migration] episode_script_segments done at %', clock_timestamp();
END
$$;
