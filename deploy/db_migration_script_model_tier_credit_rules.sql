-- Public script-writing model tiers and default credit multipliers.
-- The frontend now sends script_tier_1..4 instead of real runtime model names.

WITH tier_factor AS (
  SELECT jsonb_build_object(
    'key', 'model',
    'type', 'enum',
    'rules', jsonb_build_array(
      jsonb_build_object('value', 'script_tier_1', 'multiplier', 1),
      jsonb_build_object('value', 'script_tier_2', 'multiplier', 2),
      jsonb_build_object('value', 'script_tier_3', 'multiplier', 3),
      jsonb_build_object('value', 'script_tier_4', 'multiplier', 4)
    ),
    'default_multiplier', 1
  ) AS factor
)
UPDATE credit_rules AS cr
SET
  factors = CASE
    WHEN EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(cr.factors, '[]'::jsonb)) AS existing_factor(value)
      WHERE existing_factor.value->>'key' = 'model'
    )
      THEN (
        SELECT jsonb_agg(
          CASE
            WHEN existing_factor.value->>'key' = 'model' THEN tier_factor.factor
            ELSE existing_factor.value
          END
          ORDER BY existing_factor.ordinality
        )
        FROM jsonb_array_elements(COALESCE(cr.factors, '[]'::jsonb))
          WITH ORDINALITY AS existing_factor(value, ordinality)
      )
    ELSE COALESCE(cr.factors, '[]'::jsonb) || jsonb_build_array(tier_factor.factor)
  END,
  rule_version = '2026-07-31-001',
  description = CASE cr.feature_key
    WHEN 'script_model_call' THEN '基础积分 + 输入/输出每千 Token 积分；按公开写作模型档位设置 1/2/3/4 倍率'
    WHEN 'storyboard_design_generation' THEN '基础积分 + 每镜头积分 + 输入/输出每千 Token 积分；按公开写作模型档位设置 1/2/3/4 倍率'
    ELSE cr.description
  END,
  updated_at = CURRENT_TIMESTAMP
FROM tier_factor
WHERE cr.feature_key IN ('script_model_call', 'storyboard_design_generation');
