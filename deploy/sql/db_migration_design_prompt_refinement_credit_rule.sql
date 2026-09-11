-- Low-cost prompt refinement shared by the design and material workspaces.
-- The public writing tiers cost 1/2/3/4 credits and failed calls are not charged.

INSERT INTO credit_rules (
    rule_id, feature_key, feature_name, enabled, base_cost, billing_unit,
    factors, min_cost, max_cost, rule_version, description
)
VALUES (
    'rule_design_prompt_refinement_v1',
    'design_prompt_refinement',
    '设计与素材提示词润色',
    TRUE,
    1,
    'task',
    '[{"key":"model","type":"enum","rules":[{"value":"script_tier_1","multiplier":1},{"value":"script_tier_2","multiplier":2},{"value":"script_tier_3","multiplier":3},{"value":"script_tier_4","multiplier":4}],"default_multiplier":1}]'::jsonb,
    1,
    4,
    '2026-07-31-003',
    '提示词润色成功后按公开写作模型档位扣除 1/2/3/4 积分；失败不扣积分'
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
