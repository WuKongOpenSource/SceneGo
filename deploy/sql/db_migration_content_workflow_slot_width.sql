-- Qualified audio slots include both the storyboard item id and an immutable
-- audio-segment id.  UUID-backed segment ids can exceed the original 50-char
-- limit, so keep the complete lineage key instead of truncating it.
ALTER TABLE content_takes
    ALTER COLUMN slot TYPE VARCHAR(255);

ALTER TABLE content_selections
    ALTER COLUMN slot TYPE VARCHAR(255);

ALTER TABLE content_stale_events
    ALTER COLUMN target_slot TYPE VARCHAR(255);
