-- Model-aware video generation credits.  The exact amount is calculated by
-- services/video_credit_pricing.py from the trusted task payload; this row
-- controls enablement and documents the allowed range in the admin console.

UPDATE credit_rules
SET
  feature_name = '视频生成（按模型与规格）',
  enabled = TRUE,
  base_cost = 10,
  billing_unit = 'task',
  factors = '[]'::jsonb,
  min_cost = 10,
  max_cost = 2000,
  rule_version = '2026-08-19-video-cost-v1',
  description = '服务端按模型、分辨率、时长与音频规格计费；外部API按20积分/元换算；本地模型最低10积分；HappyHorse 1.0 1080P 5秒为160积分；失败或取消不扣积分',
  updated_at = CURRENT_TIMESTAMP
WHERE feature_key = 'video_generation';

INSERT INTO credit_rules (
  rule_id, feature_key, feature_name, enabled, base_cost, billing_unit,
  factors, min_cost, max_cost, rule_version, description
)
SELECT
  'rule_video_generation_v1', 'video_generation', '视频生成（按模型与规格）',
  TRUE, 10, 'task', '[]'::jsonb, 10, 2000,
  '2026-08-19-video-cost-v1',
  '服务端按模型、分辨率、时长与音频规格计费；外部API按20积分/元换算；本地模型最低10积分；HappyHorse 1.0 1080P 5秒为160积分；失败或取消不扣积分'
WHERE NOT EXISTS (
  SELECT 1 FROM credit_rules WHERE feature_key = 'video_generation'
);
