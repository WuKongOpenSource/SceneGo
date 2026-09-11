



ALTER TABLE users ADD COLUMN IF NOT EXISTS role            VARCHAR(30) DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status          VARCHAR(30) DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at     TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_by     VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_tier       VARCHAR(50) DEFAULT 'free';

CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);



CREATE TABLE IF NOT EXISTS project_groups (
    id SERIAL PRIMARY KEY,
    group_id VARCHAR(50) UNIQUE NOT NULL,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    team_id VARCHAR(50),
    group_name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    color VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_project_groups_user ON project_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_project_groups_team ON project_groups(team_id);



ALTER TABLE projects ADD COLUMN IF NOT EXISTS group_id   VARCHAR(50) REFERENCES project_groups(group_id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility VARCHAR(30) DEFAULT 'private';

CREATE INDEX IF NOT EXISTS idx_projects_group_id  ON projects(group_id);
CREATE INDEX IF NOT EXISTS idx_projects_visibility ON projects(visibility);



CREATE OR REPLACE FUNCTION update_project_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_groups_updated_at ON project_groups;
CREATE TRIGGER trg_project_groups_updated_at
    BEFORE UPDATE ON project_groups
    FOR EACH ROW EXECUTE FUNCTION update_project_groups_updated_at();
