-- Keep the operator-facing GPU Agent label separate from the stable routing name.
ALTER TABLE comfyui_agents
    ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);

UPDATE comfyui_agents
SET display_name = name
WHERE display_name IS NULL OR BTRIM(display_name) = '';
