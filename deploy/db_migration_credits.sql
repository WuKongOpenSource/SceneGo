




CREATE TABLE IF NOT EXISTS credit_accounts (
    id SERIAL PRIMARY KEY,
    account_id VARCHAR(50) UNIQUE NOT NULL,
    owner_type VARCHAR(20) NOT NULL,                 -- user | team
    owner_id VARCHAR(50) NOT NULL,
    available_credits INTEGER DEFAULT 0,
    frozen_credits INTEGER DEFAULT 0,
    total_used_credits INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_type, owner_id)
);

CREATE INDEX IF NOT EXISTS idx_credit_accounts_owner ON credit_accounts(owner_type, owner_id);



CREATE TABLE IF NOT EXISTS credit_rules (
    id SERIAL PRIMARY KEY,
    rule_id VARCHAR(50) UNIQUE NOT NULL,
    feature_key VARCHAR(100) NOT NULL,
    feature_name VARCHAR(255) NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    base_cost INTEGER NOT NULL DEFAULT 0,
    billing_unit VARCHAR(50) DEFAULT 'task',          -- task | image | second | character
    factors JSONB DEFAULT '[]'::jsonb,
    min_cost INTEGER DEFAULT 0,
    max_cost INTEGER,                                  -- NULL means no upper limit.
    rule_version VARCHAR(50) NOT NULL,
    description TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_rules_feature ON credit_rules(feature_key);
CREATE INDEX IF NOT EXISTS idx_credit_rules_enabled ON credit_rules(enabled);



CREATE TABLE IF NOT EXISTS credit_freezes (
    id SERIAL PRIMARY KEY,
    freeze_id VARCHAR(50) UNIQUE NOT NULL,
    account_id VARCHAR(50) NOT NULL REFERENCES credit_accounts(account_id) ON DELETE CASCADE,
    task_id VARCHAR(100),
    feature_key VARCHAR(100),
    amount INTEGER NOT NULL,
    rule_version VARCHAR(50),
    status VARCHAR(20) DEFAULT 'frozen',              -- frozen | settled | released
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    released_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_freezes_account ON credit_freezes(account_id);
CREATE INDEX IF NOT EXISTS idx_credit_freezes_task ON credit_freezes(task_id);
CREATE INDEX IF NOT EXISTS idx_credit_freezes_status ON credit_freezes(status);



CREATE TABLE IF NOT EXISTS credit_transactions (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(50) UNIQUE NOT NULL,
    account_id VARCHAR(50) NOT NULL REFERENCES credit_accounts(account_id) ON DELETE CASCADE,
    user_id VARCHAR(50) REFERENCES users(user_id) ON DELETE SET NULL,
    team_id VARCHAR(50),
    project_id VARCHAR(50),
    task_id VARCHAR(100),
    feature_key VARCHAR(100),
    change_type VARCHAR(30) NOT NULL,                 -- freeze | release | consume | admin_credit | admin_debit | recharge | gift | expire
    amount INTEGER NOT NULL,                          -- Direction is determined by change_type.
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    rule_version VARCHAR(50),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_account ON credit_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_task ON credit_transactions(task_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_feature ON credit_transactions(feature_key);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_change_type ON credit_transactions(change_type);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created ON credit_transactions(created_at DESC);



CREATE OR REPLACE FUNCTION update_credits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_credit_accounts_updated_at ON credit_accounts;
CREATE TRIGGER trg_credit_accounts_updated_at
    BEFORE UPDATE ON credit_accounts
    FOR EACH ROW EXECUTE FUNCTION update_credits_updated_at();

DROP TRIGGER IF EXISTS trg_credit_rules_updated_at ON credit_rules;
CREATE TRIGGER trg_credit_rules_updated_at
    BEFORE UPDATE ON credit_rules
    FOR EACH ROW EXECUTE FUNCTION update_credits_updated_at();





--   {"key":"duration_seconds","type":"range","rules":[{"min":5,"max":15,"multiplier":1},{"min":16,"max":30,"multiplier":1.5},{"min":31,"max":60,"multiplier":2}]}
INSERT INTO credit_rules (rule_id, feature_key, feature_name, enabled, base_cost, billing_unit, factors, min_cost, max_cost, rule_version, description)
VALUES
    ('rule_image_generation_v1',     'image_generation',     '图片生成',       TRUE, 10, 'image',  '[]'::jsonb, 10, 100, '2026-05-26-001', '基础 10 积分/张'),
    ('rule_video_reverse_v1',        'video_reverse_prompt', '视频反推提示词', TRUE, 20, 'task',
      '[{"key":"duration_seconds","type":"range","rules":[{"min":5,"max":15,"multiplier":1},{"min":16,"max":30,"multiplier":1.5},{"min":31,"max":60,"multiplier":2}]}]'::jsonb,
      20, 100, '2026-05-26-001', '基础 20 积分/任务；按时长 1x / 1.5x / 2x'),
    ('rule_video_generation_v1',     'video_generation',     '视频生成',       TRUE, 50, 'task',  '[]'::jsonb, 50, 500, '2026-05-26-001', '基础 50 积分/任务'),
    ('rule_audio_tts_v1',            'audio_generation_tts', '语音合成',       TRUE, 2,  'task',  '[]'::jsonb, 2,  50,  '2026-05-26-001', '基础 2 积分/任务'),
    ('rule_prompt_optimize_v1',      'prompt_optimize',      '提示词优化',     TRUE, 2,  'task',  '[]'::jsonb, 2,  20,  '2026-05-26-001', '基础 2 积分/任务'),
    ('rule_script_model_call_v1',    'script_model_call',     '剧本模型调用',   TRUE, 1,  'token',
      '[{"key":"input_tokens","type":"per_unit_add","unit_size":1000,"cost_per_unit":1},{"key":"output_tokens","type":"per_unit_add","unit_size":1000,"cost_per_unit":2},{"key":"model","type":"enum","rules":[],"default_multiplier":1}]'::jsonb,
      1, 500, '2026-07-22-001', '基础积分 + 输入/输出每千 Token 积分；可按模型设置倍率'),
    ('rule_storyboard_design_v1',    'storyboard_design_generation', '镜头设计生成', TRUE, 1, 'shot',
      '[{"key":"shot_count","type":"linear_add","cost_per_unit":1},{"key":"input_tokens","type":"per_unit_add","unit_size":1000,"cost_per_unit":1},{"key":"output_tokens","type":"per_unit_add","unit_size":1000,"cost_per_unit":2},{"key":"model","type":"enum","rules":[],"default_multiplier":1}]'::jsonb,
      1, 1000, '2026-07-22-001', '基础积分 + 每镜头积分 + 输入/输出每千 Token 积分；可按模型设置倍率')
ON CONFLICT (rule_id) DO NOTHING;
