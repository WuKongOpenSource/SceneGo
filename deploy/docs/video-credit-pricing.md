# Video credit pricing

Effective pricing version: `2026-09-02-video-cost-v4`.

## Rules

- Local processing-cluster video workflows cost 10 credits per successful task.
- The optional local MiniMax H3 720P post-upscale adds 5 credits, for 15 credits total.
- External APIs use 20 credits per CNY of provider cost. Seedance reference-video requests round upward to the next 5 credits; other providers use their existing product rounding rules.
- Resolution, duration, audio/reference-video options and provider sub-models are taken from the persisted server task payload.
- Seedance 2.0 reference-video requests include the total reference-video duration; an unknown duration is conservatively estimated as 15 seconds per clip.
- Seedance 2.0 Fast and Mini accept 480P/720P only. Unsupported 1080P requests are rejected before credits are reserved instead of being silently downgraded.
- Temporary provider discounts are not included in public credit prices; they remain a buffer for expiry, gift credits, storage, and operations.
- Browser-supplied `price` or `credits` fields are ignored.
- Credits are reserved before queue admission, settled once after success, and released after final failure or cancellation.

## Default examples

| Model/profile | Default specification | Credits |
| --- | --- | ---: |
| Local MiniMax H3 / Wan / processing-cluster workflow | one task | 10 |
| Local MiniMax H3 with 720P post-upscale | one task | 15 |
| MiniMax Hailuo 2.3 | 768P, 6s | 40 |
| Seedance 2 Mini | 720P, 5s | 50 |
| Kling v3 | 720P, 5s, no audio/reference video | 60 |
| Vidu q3 reference | 720P, 5s | 63 |
| Seedance 2 Fast | 720P, 5s, no reference video | 85 |
| Seedance 2 standard | 720P, 5s, no reference video | 105 |
| Seedance 2 standard | 1080P, 5s, no reference video | 260 |
| Wan 2.6 | 1080P, 5s | 100 |
| Veo 3.1 Fast gateway tier | one default request | 110 |
| Sora 2 gateway tier | one 15s request | 120 |
| HappyHorse 1.0 | 720P, 5s | 90 |
| HappyHorse 1.0 | 1080P, 5s | 160 |

Actual task cost can differ from the examples when the user changes duration,
resolution, audio/reference options, or provider sub-model.

## Provider price references

- Alibaba Cloud Model Studio model pricing (HappyHorse, Kling, Vidu, Wan):
  <https://help.aliyun.com/zh/model-studio/model-pricing>
- MiniMax pay-as-you-go pricing:
  <https://platform.minimaxi.com/docs/guides/pricing-paygo>
- Volcengine Ark model pricing (Seedance token formula and list prices):
  <https://docs.volcengine.com/docs/82379/1544106>

Provider prices are time-sensitive. When a provider changes its public rate,
update `services/video_credit_pricing.py`, its pricing version, this table, and
the regression tests in the same release.
