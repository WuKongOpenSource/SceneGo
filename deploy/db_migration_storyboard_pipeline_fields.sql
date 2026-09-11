
-- For: docs/superpowers/specs/2026-05-29-scriptpage-three-stage-generation-design.md §5.2
-- Idempotent: ADD COLUMN IF NOT EXISTS

DO $$
BEGIN
    RAISE NOTICE '[migration] storyboard_pipeline_fields start at %', clock_timestamp();
END
$$;

ALTER TABLE storyboard_items
    ADD COLUMN IF NOT EXISTS script_segment_id    VARCHAR(50),
    ADD COLUMN IF NOT EXISTS source_video_shot_no VARCHAR(50),
    ADD COLUMN IF NOT EXISTS video_script_block   TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS shot_size            VARCHAR(50) DEFAULT '',
    ADD COLUMN IF NOT EXISTS camera_angle         VARCHAR(100) DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_storyboard_items_script_segment
    ON storyboard_items(script_segment_id);

DO $$
DECLARE
    col_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
    WHERE table_name = 'storyboard_items'
      AND column_name IN ('script_segment_id','source_video_shot_no','video_script_block','shot_size','camera_angle');
    IF col_count <> 5 THEN
        RAISE EXCEPTION '[migration] expected 5 new storyboard columns, found %', col_count;
    END IF;
    RAISE NOTICE '[migration] storyboard_pipeline_fields done at %', clock_timestamp();
END
$$;
