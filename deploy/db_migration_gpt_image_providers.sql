


















INSERT INTO api_configurations (
    config_id, name, provider, endpoint, api_key_encrypted,
    model_name, request_template, headers, proxy_mode, enabled
)
SELECT
    'apicfg_seed_gptimg_v',
    'laozhang GPT Image (天劫一阶 / 化神)',
    'laozhang-gpt-image',
    'https://api.laozhang.ai/v1',
    NULL,
    'gpt-image-2-vip',
    '{}'::jsonb,
    '{}'::jsonb,
    'direct',
    FALSE
WHERE NOT EXISTS (
    SELECT 1 FROM api_configurations
    WHERE provider = 'laozhang-gpt-image'
);

INSERT INTO api_configurations (
    config_id, name, provider, endpoint, api_key_encrypted,
    model_name, request_template, headers, proxy_mode, enabled
)
SELECT
    'apicfg_seed_gptimg_o',
    'laozhang Sora2 分组 (天劫二阶 GPT Image 官方)',
    'laozhang-sora2',
    'https://api.laozhang.ai/v1',
    NULL,
    'gpt-image-2',
    '{}'::jsonb,
    '{}'::jsonb,
    'direct',
    FALSE
WHERE NOT EXISTS (
    SELECT 1 FROM api_configurations
    WHERE provider = 'laozhang-sora2'
);
