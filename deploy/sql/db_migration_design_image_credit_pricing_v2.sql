
-- Existing migration files stay immutable; this migration supersedes their rule.

UPDATE credit_rules
SET
  base_cost = 0,
  factors = '[{"key":"image_count","type":"lookup_unit_add","default_cost_per_unit":8,"rules":[{"when":{"model":"image_tier_1","resolution":"1K"},"cost_per_unit":8},{"when":{"model":"image_tier_2","resolution":"1K"},"cost_per_unit":12},{"when":{"model":"image_tier_2","resolution":"2K"},"cost_per_unit":18},{"when":{"model":"image_tier_2","resolution":"4K"},"cost_per_unit":26},{"when":{"model":"image_tier_3","resolution":"1K"},"cost_per_unit":5},{"when":{"model":"image_tier_3","resolution":"2K"},"cost_per_unit":10},{"when":{"model":"image_tier_3","resolution":"4K"},"cost_per_unit":15},{"when":{"model":"image_tier_1"},"cost_per_unit":8},{"when":{"model":"image_tier_2"},"cost_per_unit":12},{"when":{"model":"image_tier_3"},"cost_per_unit":5}] }]'::jsonb,
  min_cost = 5,
  max_cost = 1500,
  rule_version = '2026-08-28-image-pricing-v2',
  description = '按成功图片计费：Gemini 2.5 Flash Image 8 点/张；Gemini 3.1 Flash Image Preview 1K/2K/4K 为 12/18/26 点；Doubao Seedream 5.0 Lite 为 5/10/15 点；失败不扣创作点数',
  updated_at = CURRENT_TIMESTAMP
WHERE feature_key = 'design_image_generation';
