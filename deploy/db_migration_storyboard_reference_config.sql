-- Persist the exact reference configuration selected for each storyboard shot.
ALTER TABLE storyboard_items
    ADD COLUMN IF NOT EXISTS configured_references JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN storyboard_items.configured_references IS
    'Ordered image reference configuration confirmed for this storyboard shot.';
