-- Fixed-price billing for the storyboard human multi-angle workflow.
-- The workflow emits fourteen identity-preserving views as one successful task.

INSERT INTO credit_rules (
    rule_id, feature_key, feature_name, enabled, base_cost, billing_unit,
    factors, min_cost, max_cost, rule_version, description
)
VALUES (
    'rule_design_multi_angle_generation_v1',
    'design_multi_angle_generation',
    '分镜多角度人物生成',
    TRUE,
    60,
    'task',
    '[]'::jsonb,
    60,
    500,
    '2026-08-15-001',
    '固定生成14个身份一致的人物视角，按成功任务计费60积分；失败不扣积分'
)
ON CONFLICT (rule_id) DO UPDATE SET
    feature_name = EXCLUDED.feature_name,
    billing_unit = EXCLUDED.billing_unit,
    rule_version = EXCLUDED.rule_version,
    description = EXCLUDED.description,
    updated_at = CURRENT_TIMESTAMP;
