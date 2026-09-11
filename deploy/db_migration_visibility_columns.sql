-- 2026-05-26 Organization Management MVP — Slice 1




ALTER TABLE media_library_items
    ADD COLUMN IF NOT EXISTS visibility VARCHAR(30) DEFAULT 'private';

CREATE INDEX IF NOT EXISTS idx_media_visibility ON media_library_items(visibility);





ALTER TABLE project_groups
    ADD COLUMN IF NOT EXISTS organization_id VARCHAR(50)
        REFERENCES organizations(org_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_groups_org ON project_groups(organization_id);
