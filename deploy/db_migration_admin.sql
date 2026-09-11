

--       task_history, system_settings

CREATE TABLE IF NOT EXISTS comfyui_agents (
    id SERIAL PRIMARY KEY,
    agent_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    token VARCHAR(512) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'offline',
    last_heartbeat TIMESTAMP,
    system_info JSONB DEFAULT '{}'::jsonb,
    comfyui_instances JSONB DEFAULT '[]'::jsonb,
    stats JSONB DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow_templates (
    id SERIAL PRIMARY KEY,
    template_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) UNIQUE NOT NULL,
    category VARCHAR(100) DEFAULT '',
    description TEXT DEFAULT '',
    workflow_json JSONB DEFAULT '{}'::jsonb,
    placeholders JSONB DEFAULT '[]'::jsonb,
    node_type VARCHAR(100) DEFAULT '',
    estimated_time INTEGER,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    version INTEGER NOT NULL DEFAULT 1,
    workflow_key VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_configurations (
    id SERIAL PRIMARY KEY,
    config_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    provider VARCHAR(100) NOT NULL,
    endpoint TEXT NOT NULL DEFAULT '',
    api_key_encrypted TEXT,
    model_name VARCHAR(255) DEFAULT '',
    model_bindings JSONB NOT NULL DEFAULT '[]'::jsonb,
    request_template JSONB DEFAULT '{}'::jsonb,
    headers JSONB DEFAULT '{}'::jsonb,
    proxy_mode VARCHAR(20) NOT NULL DEFAULT 'direct'
        CHECK (proxy_mode IN ('direct', 'agent', 'custom')),
    custom_proxy TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_history (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(100) UNIQUE NOT NULL,
    agent_id VARCHAR(50),
    workflow_id VARCHAR(50),
    task_type VARCHAR(20) NOT NULL
        CHECK (task_type IN ('comfyui', 'api_call')),
    params JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
    result JSONB,
    error_message TEXT,
    queued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_comfyui_agents_status ON comfyui_agents (status);
CREATE INDEX IF NOT EXISTS idx_comfyui_agents_enabled ON comfyui_agents (enabled);
CREATE INDEX IF NOT EXISTS idx_comfyui_agents_last_heartbeat ON comfyui_agents (last_heartbeat);

CREATE INDEX IF NOT EXISTS idx_workflow_templates_category ON workflow_templates (category);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_enabled ON workflow_templates (enabled);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_node_type ON workflow_templates (node_type);

CREATE INDEX IF NOT EXISTS idx_api_configurations_provider ON api_configurations (provider);
CREATE INDEX IF NOT EXISTS idx_api_configurations_enabled ON api_configurations (enabled);

CREATE INDEX IF NOT EXISTS idx_task_history_agent_id ON task_history (agent_id);
CREATE INDEX IF NOT EXISTS idx_task_history_workflow_id ON task_history (workflow_id);
CREATE INDEX IF NOT EXISTS idx_task_history_status ON task_history (status);
CREATE INDEX IF NOT EXISTS idx_task_history_task_type ON task_history (task_type);
CREATE INDEX IF NOT EXISTS idx_task_history_queued_at ON task_history (queued_at);

-- Shared updated_at trigger for admin tables
CREATE OR REPLACE FUNCTION update_admin_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comfyui_agents_updated_at ON comfyui_agents;
CREATE TRIGGER trg_comfyui_agents_updated_at
    BEFORE UPDATE ON comfyui_agents
    FOR EACH ROW
    EXECUTE FUNCTION update_admin_updated_at();

DROP TRIGGER IF EXISTS trg_workflow_templates_updated_at ON workflow_templates;
CREATE TRIGGER trg_workflow_templates_updated_at
    BEFORE UPDATE ON workflow_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_admin_updated_at();

DROP TRIGGER IF EXISTS trg_api_configurations_updated_at ON api_configurations;
CREATE TRIGGER trg_api_configurations_updated_at
    BEFORE UPDATE ON api_configurations
    FOR EACH ROW
    EXECUTE FUNCTION update_admin_updated_at();

DROP TRIGGER IF EXISTS trg_task_history_updated_at ON task_history;
CREATE TRIGGER trg_task_history_updated_at
    BEFORE UPDATE ON task_history
    FOR EACH ROW
    EXECUTE FUNCTION update_admin_updated_at();

DROP TRIGGER IF EXISTS trg_system_settings_updated_at ON system_settings;
CREATE TRIGGER trg_system_settings_updated_at
    BEFORE UPDATE ON system_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_admin_updated_at();

-- Initial proxy settings
INSERT INTO system_settings (key, value, description, updated_at)
VALUES
    ('proxy_http', '', 'HTTP代理地址', CURRENT_TIMESTAMP),
    ('proxy_https', '', 'HTTPS代理地址', CURRENT_TIMESTAMP),
    ('proxy_socks5', '', 'SOCKS5代理地址', CURRENT_TIMESTAMP),
    ('proxy_no_proxy', '127.0.0.1,localhost', '不走代理的地址', CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;

-- Workflow hot-reload: add workflow_key column
ALTER TABLE workflow_templates
  ADD COLUMN IF NOT EXISTS workflow_key VARCHAR(100);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_templates_key
  ON workflow_templates(workflow_key) WHERE workflow_key IS NOT NULL;
