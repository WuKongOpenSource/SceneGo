-- Provider submission identity survives worker restarts independently of Redis.
-- No OAuth/device credentials or private runtime paths belong in these rows.
CREATE TABLE IF NOT EXISTS jimeng_jobs (
    task_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    state_id TEXT NOT NULL,
    request_sha256 CHAR(64) NOT NULL,
    task_data JSONB NOT NULL,
    stage TEXT NOT NULL DEFAULT 'waiting',
    submit_id TEXT UNIQUE,
    input_trace JSONB NOT NULL DEFAULT '[]'::jsonb,
    result_data JSONB,
    provider_credit_count NUMERIC,
    message TEXT NOT NULL DEFAULT '',
    next_poll_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT jimeng_job_stage CHECK (stage IN
        ('waiting','submitting','submitted','downloading','persisting','settling','refund_pending','completed','failed','review_required'))
);
CREATE INDEX IF NOT EXISTS idx_jimeng_jobs_due ON jimeng_jobs(next_poll_at)
    WHERE stage NOT IN ('completed','failed','review_required');
