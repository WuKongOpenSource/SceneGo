-- Document the 720P post-upscale surcharge without rewriting the immutable v1 migration.

UPDATE credit_rules
SET
  rule_version = '2026-08-19-video-cost-v2',
  description = '服务端按模型、分辨率、时长与音频规格计费；外部API按20积分/元换算；本地模型10积分，MiniMax H3勾选720P放大加5积分；HappyHorse 1.0 1080P 5秒为160积分；失败或取消不扣积分',
  updated_at = CURRENT_TIMESTAMP
WHERE feature_key = 'video_generation';
