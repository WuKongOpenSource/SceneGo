-- Standalone local-node image upscaling. Credits are reserved before enqueue,
-- consumed only after success, and capped at 50 points per image.

INSERT INTO credit_rules (
  rule_id, feature_key, feature_name, enabled, base_cost, billing_unit,
  factors, min_cost, max_cost, rule_version, description
)
VALUES (
  'rule_image_upscale_v1',
  'image_upscale',
  '图片高清放大',
  TRUE,
  10,
  'image',
  '[
    {
      "key": "target_long_edge",
      "type": "range",
      "rules": [
        {"min": 4096, "max": 4096, "multiplier": 0.8},
        {"min": 4097, "max": 8192, "multiplier": 1.5},
        {"min": 8193, "max": 16000, "multiplier": 2.5},
        {"min": 16001, "max": 32000, "multiplier": 3.8},
        {"min": 32001, "max": 50000, "multiplier": 5.0}
      ],
      "default_multiplier": 1.0
    },
    {
      "key": "text_clarity",
      "type": "enum",
      "rules": [{"value": true, "multiplier": 1.1}],
      "default_multiplier": 1.0
    }
  ]'::jsonb,
  8,
  50,
  '2026-09-02-image-upscale-v1',
  '本地节点 AI 放大后按最长边输出并写入 DPI；4K/8K/16K/32K/50K 分档，文字清晰模式采用保守边缘增强；单张最高 50 积分，失败或取消不扣积分'
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
