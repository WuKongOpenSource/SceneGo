-- Recover legacy placeholder workflow rows from their verified executable peers.
-- Never overwrite a non-empty K-god customization or a full around-angle graph.
WITH workflow_pairs(target_key, source_key, maximum_legacy_nodes) AS (
    VALUES
        ('i2i_around', 'i2i_fj', 2),
        ('qwenN_1', 'qwen_1', 0),
        ('qwenN_2', 'qwen_2', 0),
        ('qwenN_3', 'qwen_3', 0),
        ('qwenN_4', 'qwen_4', 0),
        ('qwenN_5', 'qwen_5', 0),
        ('qwenN_6', 'qwen_6', 0)
),
executable_sources AS (
    SELECT
        pairs.target_key,
        pairs.maximum_legacy_nodes,
        source.workflow_json,
        source.placeholders,
        source.enabled
    FROM workflow_pairs AS pairs
    JOIN workflow_templates AS source
      ON source.workflow_key = pairs.source_key
    WHERE jsonb_typeof(source.workflow_json) = 'object'
      AND (
          SELECT COUNT(*)
          FROM jsonb_object_keys(source.workflow_json)
      ) > 2
)
UPDATE workflow_templates AS target
SET workflow_json = source.workflow_json,
    placeholders = source.placeholders,
    enabled = source.enabled,
    version = target.version + 1,
    updated_at = CURRENT_TIMESTAMP
FROM executable_sources AS source
WHERE target.workflow_key = source.target_key
  AND (
      target.workflow_json IS NULL
      OR jsonb_typeof(target.workflow_json) <> 'object'
      OR CASE
          WHEN jsonb_typeof(target.workflow_json) = 'object' THEN (
              SELECT COUNT(*)
              FROM jsonb_object_keys(target.workflow_json)
          )
          ELSE 0
      END <= source.maximum_legacy_nodes
  );
