-- Script conversation and storyboard detail usage billing rules.
-- This separate migration also covers installations where credits already exist.

INSERT INTO credit_rules (
    rule_id, feature_key, feature_name, enabled, base_cost, billing_unit,
    factors, min_cost, max_cost, rule_version, description
)
VALUES
    (
      'rule_script_model_call_v1', 'script_model_call', '剧本模型调用', TRUE, 1, 'token',
      '[{"key":"input_tokens","type":"per_unit_add","unit_size":1000,"cost_per_unit":1},{"key":"output_tokens","type":"per_unit_add","unit_size":1000,"cost_per_unit":2},{"key":"model","type":"enum","rules":[],"default_multiplier":1}]'::jsonb,
      1, 500, '2026-07-22-001',
      '基础积分 + 输入/输出每千 Token 积分；可按模型设置倍率'
    ),
    (
      'rule_storyboard_design_v1', 'storyboard_design_generation', '镜头设计生成', TRUE, 1, 'shot',
      '[{"key":"shot_count","type":"linear_add","cost_per_unit":1},{"key":"input_tokens","type":"per_unit_add","unit_size":1000,"cost_per_unit":1},{"key":"output_tokens","type":"per_unit_add","unit_size":1000,"cost_per_unit":2},{"key":"model","type":"enum","rules":[],"default_multiplier":1}]'::jsonb,
      1, 1000, '2026-07-22-001',
      '基础积分 + 每镜头积分 + 输入/输出每千 Token 积分；可按模型设置倍率'
    )
ON CONFLICT (rule_id) DO UPDATE SET
    feature_name = EXCLUDED.feature_name,
    billing_unit = EXCLUDED.billing_unit,
    rule_version = EXCLUDED.rule_version,
    description = EXCLUDED.description,
    updated_at = CURRENT_TIMESTAMP;
