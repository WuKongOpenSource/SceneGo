-- One API credential is one card. Each card owns operation/model bindings.

ALTER TABLE api_configurations
    ADD COLUMN IF NOT EXISTS model_bindings JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE api_configurations
SET model_bindings = jsonb_build_array(
    jsonb_build_object(
        'operation',
        CASE
            WHEN LOWER(provider) = 'seedance' AND LOWER(model_name) LIKE '%fast%' THEN 'fast'
            WHEN LOWER(provider) = 'seedance' THEN 'standard'
            WHEN LOWER(provider) = 'dashscope' AND LOWER(model_name) LIKE 'wan2.6%' THEN 'wan26'
            WHEN LOWER(provider) = 'dashscope' AND LOWER(model_name) LIKE '%kling-v3-omni-video-generation%' THEN 'kling-omni'
            WHEN LOWER(provider) = 'dashscope' AND LOWER(model_name) LIKE '%kling-v3-video-generation%' THEN 'kling-standard'
            WHEN LOWER(provider) = 'dashscope' AND LOWER(model_name) LIKE '%happyhorse%' THEN 'happyhorse'
            WHEN LOWER(provider) = 'dashscope' AND LOWER(model_name) LIKE '%viduq3-mix_reference2video%' THEN 'vidu-reference-q3-mix'
            WHEN LOWER(provider) = 'dashscope' AND LOWER(model_name) LIKE '%viduq3_reference2video%' THEN 'vidu-reference-q3'
            WHEN LOWER(provider) = 'dashscope' AND LOWER(model_name) LIKE '%viduq3-turbo_reference2video%' THEN 'vidu-reference-q3-turbo'
            WHEN LOWER(provider) = 'dashscope' AND LOWER(model_name) LIKE '%viduq2-pro_reference2video%' THEN 'vidu-reference-q2-pro'
            WHEN LOWER(provider) = 'dashscope' AND LOWER(model_name) LIKE '%viduq2_reference2video%' THEN 'vidu-reference-q2'
            WHEN LOWER(provider) = 'dashscope' AND LOWER(model_name) LIKE '%viduq3-pro_start-end2video%' THEN 'vidu-startend-q3-pro'
            WHEN LOWER(provider) = 'dashscope' AND LOWER(model_name) LIKE '%viduq3-turbo_start-end2video%' THEN 'vidu-startend-q3-turbo'
            WHEN LOWER(provider) = 'dashscope' AND LOWER(model_name) LIKE '%viduq2-pro_start-end2video%' THEN 'vidu-startend-q2-pro'
            WHEN LOWER(provider) = 'dashscope' AND LOWER(model_name) LIKE '%viduq2-turbo_start-end2video%' THEN 'vidu-startend-q2-turbo'
            ELSE 'default'
        END,
        'model_name', model_name
    )
)
WHERE COALESCE(model_name, '') <> ''
  AND (model_bindings IS NULL OR model_bindings = '[]'::jsonb);

ALTER TABLE api_configurations
    DROP CONSTRAINT IF EXISTS chk_api_configurations_model_bindings_array;

ALTER TABLE api_configurations
    ADD CONSTRAINT chk_api_configurations_model_bindings_array
    CHECK (jsonb_typeof(model_bindings) = 'array');
