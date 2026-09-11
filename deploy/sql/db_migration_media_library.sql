




CREATE TABLE IF NOT EXISTS media_library_items (
    id SERIAL PRIMARY KEY,
    library_item_id VARCHAR(50) UNIQUE NOT NULL,
    file_id VARCHAR(50) NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    project_id VARCHAR(50) REFERENCES projects(project_id) ON DELETE SET NULL,
    episode_id VARCHAR(50),
    team_id VARCHAR(50),
    item_type VARCHAR(20) NOT NULL,                   -- image | video | audio | text | other
    source VARCHAR(50) NOT NULL,                      -- upload | generated_image_gpt | video_reverse_frame | ...
    title VARCHAR(255),
    description TEXT DEFAULT '',
    tags JSONB DEFAULT '[]'::jsonb,
    permission_scope VARCHAR(30) DEFAULT 'private',   -- private | project | team | public_link
    is_favorite BOOLEAN DEFAULT FALSE,
    use_count INTEGER DEFAULT 0,
    source_task_id VARCHAR(100),
    source_entity_type VARCHAR(50),
    source_entity_id VARCHAR(50),
    metadata JSONB DEFAULT '{}'::jsonb,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_media_library_user      ON media_library_items(user_id);
CREATE INDEX IF NOT EXISTS idx_media_library_project   ON media_library_items(project_id);
CREATE INDEX IF NOT EXISTS idx_media_library_file      ON media_library_items(file_id);
CREATE INDEX IF NOT EXISTS idx_media_library_source    ON media_library_items(source);
CREATE INDEX IF NOT EXISTS idx_media_library_type      ON media_library_items(item_type);
CREATE INDEX IF NOT EXISTS idx_media_library_created   ON media_library_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_library_scope     ON media_library_items(permission_scope);


CREATE OR REPLACE FUNCTION update_media_library_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_media_library_items_updated_at ON media_library_items;
CREATE TRIGGER trg_media_library_items_updated_at
    BEFORE UPDATE ON media_library_items
    FOR EACH ROW
    EXECUTE FUNCTION update_media_library_items_updated_at();



CREATE TABLE IF NOT EXISTS media_library_usages (
    id SERIAL PRIMARY KEY,
    usage_id VARCHAR(50) UNIQUE NOT NULL,
    library_item_id VARCHAR(50) NOT NULL REFERENCES media_library_items(library_item_id) ON DELETE CASCADE,
    file_id VARCHAR(50) NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    project_id VARCHAR(50) REFERENCES projects(project_id) ON DELETE SET NULL,
    task_id VARCHAR(100),
    usage_context VARCHAR(100) NOT NULL,              -- image_gen_reference | video_reverse_input | char_asset_bind | ...
    target_entity_type VARCHAR(50),
    target_entity_id VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_media_library_usages_item   ON media_library_usages(library_item_id);
CREATE INDEX IF NOT EXISTS idx_media_library_usages_task   ON media_library_usages(task_id);
CREATE INDEX IF NOT EXISTS idx_media_library_usages_user   ON media_library_usages(user_id);
CREATE INDEX IF NOT EXISTS idx_media_library_usages_context ON media_library_usages(usage_context);
