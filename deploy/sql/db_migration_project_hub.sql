




ALTER TABLE projects ADD COLUMN IF NOT EXISTS cover_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;


CREATE TABLE IF NOT EXISTS project_members (
    id SERIAL PRIMARY KEY,
    project_id VARCHAR(50) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'member',  -- 'owner', 'admin', 'member', 'readonly'
    responsibility VARCHAR(20) NOT NULL DEFAULT 'all',  -- 'text', 'materials', 'generation', 'video', 'all'
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_role ON project_members(role);


ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_page VARCHAR(50);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_item_id VARCHAR(100);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);


CREATE TABLE IF NOT EXISTS canvas_boards (
    id SERIAL PRIMARY KEY,
    board_id VARCHAR(50) UNIQUE NOT NULL,
    project_id VARCHAR(50) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL DEFAULT '未命名画布',
    description TEXT,
    viewport JSONB DEFAULT '{"x": 0, "y": 0, "zoom": 1}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_canvas_boards_project_id ON canvas_boards(project_id);
CREATE INDEX IF NOT EXISTS idx_canvas_boards_user_id ON canvas_boards(user_id);


CREATE TABLE IF NOT EXISTS canvas_nodes (
    id SERIAL PRIMARY KEY,
    node_id VARCHAR(50) UNIQUE NOT NULL,
    board_id VARCHAR(50) NOT NULL REFERENCES canvas_boards(board_id) ON DELETE CASCADE,
    node_type VARCHAR(30) NOT NULL,  -- 'text', 'image', 'video', 'storyboard', 'prompt', 'group'
    x FLOAT NOT NULL DEFAULT 0,
    y FLOAT NOT NULL DEFAULT 0,
    width FLOAT NOT NULL DEFAULT 200,
    height FLOAT NOT NULL DEFAULT 150,
    data JSONB DEFAULT '{}'::jsonb,
    z_index INTEGER DEFAULT 0,
    is_locked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_canvas_nodes_board_id ON canvas_nodes(board_id);
CREATE INDEX IF NOT EXISTS idx_canvas_nodes_node_type ON canvas_nodes(node_type);


CREATE TABLE IF NOT EXISTS canvas_connections (
    id SERIAL PRIMARY KEY,
    connection_id VARCHAR(50) UNIQUE NOT NULL,
    board_id VARCHAR(50) NOT NULL REFERENCES canvas_boards(board_id) ON DELETE CASCADE,
    source_node_id VARCHAR(50) NOT NULL REFERENCES canvas_nodes(node_id) ON DELETE CASCADE,
    target_node_id VARCHAR(50) NOT NULL REFERENCES canvas_nodes(node_id) ON DELETE CASCADE,
    source_port VARCHAR(50),
    target_port VARCHAR(50),
    label VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_canvas_connections_board_id ON canvas_connections(board_id);


CREATE TRIGGER update_project_members_updated_at BEFORE UPDATE ON project_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_canvas_boards_updated_at BEFORE UPDATE ON canvas_boards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_canvas_nodes_updated_at BEFORE UPDATE ON canvas_nodes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


INSERT INTO project_members (project_id, user_id, role, responsibility)
SELECT project_id, user_id, 'owner', 'all'
FROM projects
WHERE NOT EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = projects.project_id AND pm.user_id = projects.user_id
);


GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO CURRENT_USER;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO CURRENT_USER;
