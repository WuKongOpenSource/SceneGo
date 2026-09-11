



CREATE TABLE IF NOT EXISTS final_product_shares (
    share_id VARCHAR(50) PRIMARY KEY,
    share_token VARCHAR(100) UNIQUE NOT NULL,
    library_item_id VARCHAR(50) NOT NULL REFERENCES media_library_items(library_item_id) ON DELETE CASCADE,
    owner_user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    project_id VARCHAR(50) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    episode_id VARCHAR(50) REFERENCES episodes(episode_id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    access_count INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_final_product_shares_active_item
    ON final_product_shares(library_item_id)
    WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_final_product_shares_owner
    ON final_product_shares(owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS final_product_feedback (
    feedback_id VARCHAR(50) PRIMARY KEY,
    share_id VARCHAR(50) NOT NULL REFERENCES final_product_shares(share_id) ON DELETE CASCADE,
    author_name VARCHAR(40) NOT NULL DEFAULT '访客',
    content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
    timestamp_seconds NUMERIC(12, 3) CHECK (timestamp_seconds IS NULL OR timestamp_seconds >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_final_product_feedback_share
    ON final_product_feedback(share_id, created_at DESC);
