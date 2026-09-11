-- Public image-generation tiers and production credit costs.
-- Charges are settled only after successful images are persisted by the client.

UPDATE credit_rules
SET
  base_cost = 0,
  factors = '[{"key":"image_count","type":"linear_add","cost_per_unit":40},{"key":"model","type":"enum","rules":[{"value":"image_tier_1","multiplier":1},{"value":"image_tier_2","multiplier":2.5},{"value":"image_tier_3","multiplier":1.5}],"default_multiplier":1}]'::jsonb,
  min_cost = 40,
  max_cost = 1500,
  rule_version = '2026-07-31-002',
  description = '按成功生成的图片张数计费：一阶 40 分/张、二阶 100 分/张、三阶 60 分/张；失败不扣积分',
  updated_at = CURRENT_TIMESTAMP
WHERE feature_key = 'design_image_generation';
