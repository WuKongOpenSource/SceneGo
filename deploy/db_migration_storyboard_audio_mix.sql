-- 2026-05-17: storyboard_items add mixed audio cache columns
-- For: spec docs/superpowers/specs/2026-05-17-storyboard-video-import-completeness-design.md §3.2
-- Idempotent: uses IF NOT EXISTS

DO $$
BEGIN
    RAISE NOTICE '[migration] storyboard_audio_mix start at %', clock_timestamp();
END
$$;

ALTER TABLE storyboard_items
    ADD COLUMN IF NOT EXISTS mixed_audio_url  TEXT,
    ADD COLUMN IF NOT EXISTS mixed_audio_hash VARCHAR(64);

COMMENT ON COLUMN storyboard_items.mixed_audio_url  IS 'Backend-mixed reference audio URL; cached via mixed_audio_hash';
COMMENT ON COLUMN storyboard_items.mixed_audio_hash IS 'sha1 of (dialogue_url|narration_url|sfx_url|gains); same hash → reuse mixed_audio_url';

CREATE INDEX IF NOT EXISTS idx_storyboard_items_mixed_audio_hash
    ON storyboard_items (mixed_audio_hash)
    WHERE mixed_audio_hash IS NOT NULL;

DO $$
DECLARE
    col_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
    WHERE table_name = 'storyboard_items'
      AND column_name IN ('mixed_audio_url', 'mixed_audio_hash');
    IF col_count <> 2 THEN
        RAISE EXCEPTION '[migration] expected 2 new columns, found %', col_count;
    END IF;
    RAISE NOTICE '[migration] storyboard_audio_mix done at %', clock_timestamp();
END
$$;
