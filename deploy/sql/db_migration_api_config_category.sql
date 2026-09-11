





BEGIN;


ALTER TABLE api_configurations
    ADD COLUMN IF NOT EXISTS category VARCHAR(20) DEFAULT ''
    CHECK (category IN ('', 'text', 'image', 'video', 'audio'));

CREATE INDEX IF NOT EXISTS idx_api_configurations_category
    ON api_configurations (category);





UPDATE api_configurations
SET category = 'video'
WHERE category = ''
  AND (
      LOWER(provider) IN ('seedance', 'sora2', 'veo', 'dashscope', 'kling', 'vidu', 'happyhorse')
      OR LOWER(provider) LIKE '%kling%'
      OR LOWER(provider) LIKE '%vidu%'
      OR LOWER(provider) LIKE '%happyhorse%'
      OR LOWER(provider) LIKE '%seedance%'
      OR LOWER(provider) LIKE '%wan2%'
      OR LOWER(model_name) LIKE 'doubao-seedance%'
      OR LOWER(model_name) LIKE 'wan2.6%'
      OR LOWER(model_name) LIKE 'kling%'
      OR LOWER(model_name) LIKE 'vidu%'
      OR LOWER(model_name) LIKE 'happyhorse%'
      OR LOWER(model_name) LIKE 'veo-%'
      OR LOWER(model_name) LIKE 'sora-%'
  );


UPDATE api_configurations
SET category = 'audio'
WHERE category = ''
  AND (
      LOWER(provider) LIKE '%minimax%'
      OR LOWER(provider) LIKE '%tts%'
      OR LOWER(provider) LIKE '%gemini-tts%'
      OR LOWER(model_name) LIKE 'speech-%'
      OR LOWER(model_name) LIKE 'tts-%'
  );


UPDATE api_configurations
SET category = 'image'
WHERE category = ''
  AND (
      LOWER(provider) LIKE '%gemini-image%'
      OR LOWER(provider) LIKE '%laozhang-gpt-image%'
      OR LOWER(provider) = 'doubao'
      OR LOWER(provider) LIKE '%qwen-image%'
      OR LOWER(model_name) LIKE 'gpt-image%'
      OR LOWER(model_name) LIKE 'gemini%-image%'
      OR LOWER(model_name) LIKE 'seedream%'
  );


UPDATE api_configurations
SET category = 'text'
WHERE category = ''
  AND (
      LOWER(provider) LIKE '%gemini-text%'
      OR LOWER(provider) LIKE '%deepseek%'
      OR LOWER(model_name) LIKE 'deepseek-%'
      OR LOWER(model_name) LIKE 'gemini-%-flash'
      OR LOWER(model_name) LIKE 'gemini-%-pro'
  );



COMMIT;


-- SELECT category, COUNT(*) FROM api_configurations GROUP BY category;
