-- Credit rule for queued video enhancement operations.
-- Image generation, video generation, and TTS use the existing canonical rules.

INSERT INTO credit_rules (
  rule_id, feature_key, feature_name, enabled, base_cost, billing_unit,
  factors, min_cost, max_cost, rule_version, description
)
VALUES (
  'rule_video_enhancement_v1', 'video_enhancement', '视频美化', TRUE, 5, 'task',
  '[]'::jsonb, 5, 100, '2026-08-18-001',
  '视频放大、补帧、对口型和视频配音统一按成功任务扣除 5 积分；失败或取消不扣积分'
)
ON CONFLICT (rule_id) DO UPDATE SET
  feature_name = EXCLUDED.feature_name,
  enabled = EXCLUDED.enabled,
  base_cost = EXCLUDED.base_cost,
  billing_unit = EXCLUDED.billing_unit,
  factors = EXCLUDED.factors,
  min_cost = EXCLUDED.min_cost,
  max_cost = EXCLUDED.max_cost,
  rule_version = EXCLUDED.rule_version,
  description = EXCLUDED.description,
  updated_at = CURRENT_TIMESTAMP;
