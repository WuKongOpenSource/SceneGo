-- Design workspace usage billing rules.
-- Kept separate so existing installations can add the rules without replaying
-- the original credits migration.

INSERT INTO credit_rules (
    rule_id, feature_key, feature_name, enabled, base_cost, billing_unit,
    factors, min_cost, max_cost, rule_version, description
)
VALUES
    (
      'rule_design_image_generation_v1',
      'design_image_generation',
      '设计页 AI 生图',
      TRUE,
      0,
      'image',
      '[{"key":"image_count","type":"linear_add","cost_per_unit":10},{"key":"model","type":"enum","rules":[],"default_multiplier":1}]'::jsonb,
      10,
      1000,
      '2026-07-23-001',
      '按实际成功生成的图片张数计费，默认每张 10 积分；可按模型设置倍率'
    ),
    (
      'rule_design_angle_adjustment_v1',
      'design_angle_adjustment',
      '设计页角度调整',
      TRUE,
      5,
      'task',
      '[]'::jsonb,
      5,
      500,
      '2026-07-23-001',
      '角度调整任务成功后按次计费，默认每次 5 积分'
    ),
    (
      'rule_design_upscale_hd_v1',
      'design_upscale_hd',
      '设计页高清放大',
      TRUE,
      5,
      'task',
      '[]'::jsonb,
      5,
      500,
      '2026-07-23-001',
      '高清放大任务成功后按次计费，默认每次 5 积分'
    )
ON CONFLICT (rule_id) DO UPDATE SET
    feature_name = EXCLUDED.feature_name,
    billing_unit = EXCLUDED.billing_unit,
    rule_version = EXCLUDED.rule_version,
    description = EXCLUDED.description,
    updated_at = CURRENT_TIMESTAMP;
