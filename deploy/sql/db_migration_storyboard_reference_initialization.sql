ALTER TABLE storyboard_items
    ADD COLUMN IF NOT EXISTS reference_config_initialized BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE storyboard_items
SET reference_config_initialized = TRUE
WHERE reference_config_initialized = FALSE
  AND jsonb_typeof(configured_references) = 'array'
  AND jsonb_array_length(configured_references) > 0;

COMMENT ON COLUMN storyboard_items.reference_config_initialized IS
    'Whether the independent generation reference list has received its one-time default import.';
