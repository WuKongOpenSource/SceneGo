-- Registry classification is presentation metadata, not an execution policy.
ALTER TABLE comfyui_agents
ADD COLUMN IF NOT EXISTS registry_kind text
CHECK (registry_kind IN ('managed', 'external'));
