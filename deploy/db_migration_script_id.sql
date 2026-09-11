




ALTER TABLE storyboard_items ADD COLUMN IF NOT EXISTS script_id VARCHAR(50);


ALTER TABLE assets ADD COLUMN IF NOT EXISTS script_id VARCHAR(50);


UPDATE storyboard_items si
SET script_id = (
    SELECT script_id FROM episode_scripts es
    WHERE es.episode_id = si.episode_id
    ORDER BY sort_order, created_at LIMIT 1
)
WHERE si.script_id IS NULL;

UPDATE assets a
SET script_id = (
    SELECT script_id FROM episode_scripts es
    WHERE es.episode_id = a.episode_id
    ORDER BY sort_order, created_at LIMIT 1
)
WHERE a.script_id IS NULL AND a.episode_id IS NOT NULL;


CREATE INDEX IF NOT EXISTS idx_storyboard_items_script ON storyboard_items(script_id);
CREATE INDEX IF NOT EXISTS idx_assets_script ON assets(script_id);
