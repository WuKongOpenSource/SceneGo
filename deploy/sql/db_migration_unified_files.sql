-- db_migration_unified_files.sql


ALTER TABLE files ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50);
ALTER TABLE files ADD COLUMN IF NOT EXISTS entity_id VARCHAR(50);
ALTER TABLE files ADD COLUMN IF NOT EXISTS file_role VARCHAR(50);
ALTER TABLE files ADD COLUMN IF NOT EXISTS is_selected BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_files_entity
  ON files(entity_type, entity_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_files_entity_role
  ON files(entity_type, entity_id, file_role) WHERE is_deleted = FALSE;
