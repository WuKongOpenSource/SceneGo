# Gemini Provider Configuration

Gemini text and Gemini image are configured through the backend API
provider management platform. The frontend must not store Gemini keys in Vite
environment variables or browser localStorage.

## Where To Configure

Sign in to the creator frontend with an administrator account, then use
`账号菜单` → `管理后台` → `API 厂商配置`. The entry URL is intentionally not
documented as a public route.

Use the provider cards to configure:

- `gemini-text` for text generation.
- `gemini-image` for image generation.

Each provider can be edited without a backend restart. Saving a config refreshes
the runtime environment, and the card actions distinguish:

- `测试 DB 配置`: checks the saved database row.
- `测试生效配置`: checks the effective runtime provider used by generation.

## Server-Side Key Names

These names are backend runtime keys only. They must not be prefixed with
`VITE_` or embedded in frontend builds.

- `GEMINI_TEXT_API_KEY`
- `GEMINI_IMAGE_API_KEY`

Endpoint and model overrides are also server-side runtime settings managed by
the same provider resolver. The admin page shows the resolved operation URL
templates so endpoint changes are visible before testing generation.

## Image Models

### Gemini 2.5 Flash Image

- Model: `gemini-2.5-flash-image`
- Fast image generation.
- Fixed 1K output; the `imageSize` option is ignored.

### Gemini 3 Pro Image Preview

- Model: `gemini-3-pro-image-preview`
- Higher quality generation.
- Supports 1K, 2K, and 4K output where supported by the configured provider.

## Supported Aspect Ratios

| Type | Ratios |
|------|--------|
| Landscape | `21:9`, `16:9`, `4:3`, `3:2` |
| Square | `1:1` |
| Portrait | `9:16`, `3:4`, `2:3` |
| Other | `5:4`, `4:5` |

## Supported Resolution Presets

### Gemini 2.5 Flash Image

- Fixed 1K output.

### Gemini 3 Pro Image Preview

| Ratio | 1K | 2K | 4K |
|-------|----|----|----|
| `1:1` | `1024x1024` | `2048x2048` | `4096x4096` |
| `16:9` | `1376x768` | `2752x1536` | `5504x3072` |
| `9:16` | `768x1376` | `1536x2752` | `3072x5504` |
| `4:3` | `1200x896` | `2400x1792` | `4800x3584` |
| `3:4` | `896x1200` | `1792x2400` | `3584x4800` |

## Frontend Call Path

Frontend services call backend proxies:

- Text: `/api/gemini/text`
- Image: `/api/gemini/image`

The backend provider resolver supplies the key, endpoint, model, proxy mode, and
failover behavior. This keeps provider replacement centralized in backend
registry/runtime config instead of scattered through frontend files.
