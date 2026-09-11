-- Keep the admin-visible video rule aligned with server-owned Seedance pricing.

UPDATE credit_rules
SET
  rule_version = '2026-09-02-video-cost-v4',
  description = '服务端按模型、分辨率、输出时长和参考视频总时长计费；外部API按20积分/元安全换算；Seedance 2.0 Fast/Mini仅支持480P和720P；未知参考视频时长按每段15秒预估；失败或取消不扣积分',
  updated_at = CURRENT_TIMESTAMP
WHERE feature_key = 'video_generation';
