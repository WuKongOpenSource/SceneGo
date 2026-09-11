



CREATE TABLE IF NOT EXISTS video_reverse_tasks (
    id SERIAL PRIMARY KEY,
    reverse_task_id VARCHAR(50) UNIQUE NOT NULL,
    task_id VARCHAR(100) UNIQUE,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    project_id VARCHAR(50) REFERENCES projects(project_id) ON DELETE SET NULL,
    episode_id VARCHAR(50),
    video_file_id VARCHAR(50) NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
    video_library_item_id VARCHAR(50),

    duration_seconds NUMERIC(10, 2),
    frame_strategy VARCHAR(20) DEFAULT 'uniform',
    language VARCHAR(10) DEFAULT 'zh',
    status VARCHAR(30) DEFAULT 'pending',                          -- pending | splitting | extracting_frames | analyzing | building_prompts | completed | failed | cancelled
    progress NUMERIC(5, 2) DEFAULT 0,

    overall_prompt_zh TEXT DEFAULT '',
    overall_prompt_en TEXT DEFAULT '',
    overall_negative_prompt TEXT DEFAULT '',
    structured_prompt JSONB DEFAULT '{}'::jsonb,
    frame_file_ids JSONB DEFAULT '[]'::jsonb,

    credit_cost INTEGER DEFAULT 0,
    error_message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_video_reverse_user      ON video_reverse_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_video_reverse_project   ON video_reverse_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_video_reverse_task      ON video_reverse_tasks(task_id);
CREATE INDEX IF NOT EXISTS idx_video_reverse_status    ON video_reverse_tasks(status);
CREATE INDEX IF NOT EXISTS idx_video_reverse_created   ON video_reverse_tasks(created_at DESC);



CREATE TABLE IF NOT EXISTS video_reverse_segments (
    id SERIAL PRIMARY KEY,
    segment_id VARCHAR(50) UNIQUE NOT NULL,
    reverse_task_id VARCHAR(50) NOT NULL REFERENCES video_reverse_tasks(reverse_task_id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    start_seconds NUMERIC(10, 3) NOT NULL,
    end_seconds NUMERIC(10, 3) NOT NULL,
    frame_file_ids JSONB DEFAULT '[]'::jsonb,
    description TEXT DEFAULT '',
    prompt_zh TEXT DEFAULT '',
    prompt_en TEXT DEFAULT '',
    camera_description TEXT DEFAULT '',
    motion_description TEXT DEFAULT '',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_video_reverse_segments_task  ON video_reverse_segments(reverse_task_id);
CREATE INDEX IF NOT EXISTS idx_video_reverse_segments_order ON video_reverse_segments(reverse_task_id, sort_order);



CREATE OR REPLACE FUNCTION update_video_reverse_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_video_reverse_tasks_updated_at ON video_reverse_tasks;
CREATE TRIGGER trg_video_reverse_tasks_updated_at
    BEFORE UPDATE ON video_reverse_tasks
    FOR EACH ROW EXECUTE FUNCTION update_video_reverse_tasks_updated_at();
