ALTER TABLE storyboard_items
    ADD COLUMN IF NOT EXISTS audio_segments JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN storyboard_items.audio_segments IS
    'Ordered per-shot audio segments. Each entry is speech or silence and preserves sequential timing.';
