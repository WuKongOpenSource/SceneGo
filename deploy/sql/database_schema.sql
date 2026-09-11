


CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) UNIQUE NOT NULL,
    username VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    avatar_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    storage_quota_gb INTEGER DEFAULT 50,
    used_storage_bytes BIGINT DEFAULT 0,
    permissions JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);


CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    project_id VARCHAR(50) UNIQUE NOT NULL,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    project_name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_accessed_at TIMESTAMP,
    is_archived BOOLEAN DEFAULT FALSE,
    settings JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_project_id ON projects(project_id);


CREATE TABLE IF NOT EXISTS versions (
    id SERIAL PRIMARY KEY,
    version_id VARCHAR(50) UNIQUE NOT NULL,
    project_id VARCHAR(50) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    version_name VARCHAR(255),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_current BOOLEAN DEFAULT FALSE,
    parent_version_id VARCHAR(50),
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_versions_project_id ON versions(project_id);
CREATE INDEX IF NOT EXISTS idx_versions_user_id ON versions(user_id);
CREATE INDEX IF NOT EXISTS idx_versions_version_id ON versions(version_id);


CREATE TABLE IF NOT EXISTS files (
    id SERIAL PRIMARY KEY,
    file_id VARCHAR(50) UNIQUE NOT NULL,
    version_id VARCHAR(50) REFERENCES versions(version_id) ON DELETE CASCADE,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    file_type VARCHAR(20) NOT NULL,   -- 'image', 'video', 'text', 'audio', 'json'
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_size_bytes BIGINT,
    mime_type VARCHAR(100),
    width INTEGER,
    height INTEGER,
    duration_seconds FLOAT,
    thumbnail_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_files_file_id ON files(file_id);
CREATE INDEX IF NOT EXISTS idx_files_version_id ON files(version_id);
CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_file_type ON files(file_type);
CREATE INDEX IF NOT EXISTS idx_files_is_deleted ON files(is_deleted);


CREATE TABLE IF NOT EXISTS text_contents (
    id SERIAL PRIMARY KEY,
    content_id VARCHAR(50) UNIQUE NOT NULL,
    version_id VARCHAR(50) REFERENCES versions(version_id) ON DELETE CASCADE,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    content_type VARCHAR(50) NOT NULL, -- 'script', 'prompt', 'description', 'dialogue'
    title VARCHAR(255),
    content TEXT NOT NULL,
    language VARCHAR(10) DEFAULT 'zh-CN',
    word_count INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb,
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_text_contents_content_id ON text_contents(content_id);
CREATE INDEX IF NOT EXISTS idx_text_contents_version_id ON text_contents(version_id);
CREATE INDEX IF NOT EXISTS idx_text_contents_user_id ON text_contents(user_id);


CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(50) UNIQUE NOT NULL,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    project_id VARCHAR(50) REFERENCES projects(project_id) ON DELETE SET NULL,
    version_id VARCHAR(50) REFERENCES versions(version_id) ON DELETE SET NULL,
    task_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,      -- 'pending', 'processing', 'completed', 'failed'
    priority INTEGER DEFAULT 0,
    task_data JSONB NOT NULL,
    result_data JSONB,
    error_message TEXT,
    node_id VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tasks_task_id ON tasks(task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);


CREATE TABLE IF NOT EXISTS task_files (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(50) NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    file_id VARCHAR(50) NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
    file_role VARCHAR(50),  -- 'input', 'output', 'intermediate'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(task_id, file_id)
);

CREATE INDEX IF NOT EXISTS idx_task_files_task_id ON task_files(task_id);
CREATE INDEX IF NOT EXISTS idx_task_files_file_id ON task_files(file_id);


CREATE TABLE IF NOT EXISTS activity_logs (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL,     -- 'login', 'create_project', 'upload_file', 'create_version'
    resource_type VARCHAR(50),        -- 'project', 'file', 'task', 'version'
    resource_id VARCHAR(50),
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);


CREATE TABLE IF NOT EXISTS system_configs (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS file_shares (
    id SERIAL PRIMARY KEY,
    share_id VARCHAR(50) UNIQUE NOT NULL,
    file_id VARCHAR(50) NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    share_token VARCHAR(100) UNIQUE NOT NULL,
    expires_at TIMESTAMP,
    password_hash VARCHAR(255),
    access_count INTEGER DEFAULT 0,
    max_access_count INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_file_shares_share_token ON file_shares(share_token);
CREATE INDEX IF NOT EXISTS idx_file_shares_file_id ON file_shares(file_id);




INSERT INTO system_configs (config_key, config_value, description) VALUES
    ('file_retention_days', '90', '文件保留天数'),
    ('max_file_size_mb', '500', '最大文件大小(MB)'),
    ('max_upload_concurrent', '5', '最大并发上传数'),
    ('enable_file_compression', 'true', '启用文件压缩'),
    ('thumbnail_sizes', '["256x256", "512x512"]', '缩略图尺寸')
ON CONFLICT (config_key) DO NOTHING;



CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_files_updated_at BEFORE UPDATE ON files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_text_contents_updated_at BEFORE UPDATE ON text_contents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();



CREATE OR REPLACE FUNCTION update_user_storage()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE users
        SET used_storage_bytes = used_storage_bytes + COALESCE(NEW.file_size_bytes, 0)
        WHERE user_id = NEW.user_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE users
        SET used_storage_bytes = used_storage_bytes - COALESCE(OLD.file_size_bytes, 0)
        WHERE user_id = OLD.user_id;
    ELSIF TG_OP = 'UPDATE' AND NEW.is_deleted = TRUE AND OLD.is_deleted = FALSE THEN
        UPDATE users
        SET used_storage_bytes = used_storage_bytes - COALESCE(OLD.file_size_bytes, 0)
        WHERE user_id = OLD.user_id;
    END IF;
    RETURN NULL;
END;
$$ language 'plpgsql';

CREATE TRIGGER trigger_update_user_storage
AFTER INSERT OR UPDATE OR DELETE ON files
FOR EACH ROW EXECUTE FUNCTION update_user_storage();



CREATE OR REPLACE VIEW user_storage_stats AS
SELECT
    u.user_id,
    u.username,
    u.storage_quota_gb,
    u.used_storage_bytes,
    ROUND(u.used_storage_bytes::numeric / 1024 / 1024 / 1024, 2) as used_storage_gb,
    ROUND((u.used_storage_bytes::numeric / (u.storage_quota_gb * 1024 * 1024 * 1024)) * 100, 2) as usage_percentage,
    COUNT(DISTINCT f.file_id) as total_files,
    COUNT(DISTINCT CASE WHEN f.file_type = 'image' THEN f.file_id END) as image_count,
    COUNT(DISTINCT CASE WHEN f.file_type = 'video' THEN f.file_id END) as video_count
FROM users u
LEFT JOIN files f ON u.user_id = f.user_id AND f.is_deleted = FALSE
GROUP BY u.user_id, u.username, u.storage_quota_gb, u.used_storage_bytes;



GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO CURRENT_USER;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO CURRENT_USER;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO CURRENT_USER;
