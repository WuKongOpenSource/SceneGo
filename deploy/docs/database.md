# Database Reference

- **Engine**: PostgreSQL
- **Schema**: `database_schema.sql`, `db_migration_*.sql`
- **DAO files**: `dao_asset.py`, `dao_audio_track.py`, `dao_canvas.py`, `dao_character_voice.py`, `dao_content.py`, `dao_episode.py`, `dao_file.py`, `dao_project.py`, `dao_storyboard.py`, `dao_user.py`, `dao_video.py`, `dao_agent.py`, `dao_api_config.py`

## Migration execution

- `db_build/manifest.txt` is the only ordered migration source of truth.
- `auto_deploy.sh` and the container entrypoint execute the canonical manifest through the migration ledger runner in `db_build/build_fresh_db.py`.
- The runner records checksums in `schema_migrations`, holds a PostgreSQL advisory lock, and applies each pending file in a transaction.
- New migrations must be mirrored under `deploy/` and `deploy/sql/`, then added once to the manifest. Do not add per-script migration lists to deployment scripts.
- Generated script candidates use `episode_scripts.source_type` and `source_id`; the partial unique index on `(episode_id, source_type, source_id)` keeps one canonical candidate per external source without deleting user-created drafts.

---

## 1. User & Auth

### users — `dao_user.py` · `database_schema.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| user_id | VARCHAR UNIQUE | 业务主键 |
| username | VARCHAR UNIQUE | |
| password_hash | VARCHAR | |
| email | VARCHAR | |
| avatar_url | TEXT | |
| created_at / updated_at / last_login_at | TIMESTAMP | |
| is_active | BOOLEAN | |
| storage_quota_gb | INT | 存储配额 |
| used_storage_bytes | BIGINT | |
| permissions | JSONB | |

### project_members — `db_migration_project_hub.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| project_id | VARCHAR FK→projects | |
| user_id | VARCHAR FK→users | |
| role | VARCHAR | owner/editor/viewer |
| responsibility | VARCHAR | |
| joined_at / updated_at | TIMESTAMP | |

---

## 2. Project Hierarchy

**关系**: `projects` → `versions` → `episodes`

### projects — `dao_project.py` · `database_schema.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| project_id | VARCHAR UNIQUE | 业务主键 |
| user_id | VARCHAR FK→users | |
| project_name | VARCHAR | |
| description | TEXT | |
| created_at / updated_at / last_accessed_at | TIMESTAMP | |
| is_archived | BOOLEAN | |
| settings | JSONB | |

### versions — `database_schema.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| version_id | VARCHAR UNIQUE | 业务主键 |
| project_id | VARCHAR FK→projects | |
| user_id | VARCHAR FK→users | |
| version_number | INT | |
| version_name | VARCHAR | |
| description | TEXT | |
| created_at | TIMESTAMP | |
| is_current | BOOLEAN | 当前活跃版本 |
| parent_version_id | VARCHAR | 版本树 |
| metadata | JSONB | |

### episodes — `dao_episode.py` · `db_migration_episodes.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| episode_id | VARCHAR UNIQUE | 业务主键 |
| project_id | VARCHAR FK→projects | |
| episode_number | INT | |
| episode_name | VARCHAR | |
| description | TEXT | |
| status | VARCHAR | draft/in_progress/completed |
| settings | JSONB | |
| sort_order | INT | |
| created_at / updated_at | TIMESTAMP | |

---

## 3. Content

### storyboard_items — `dao_storyboard.py` · `db_migration_storyboard_items.sql`

**API**: `GET /api/episodes/{episode_id}/storyboard-items`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| item_id | VARCHAR UNIQUE | 业务主键 |
| episode_id | VARCHAR FK→episodes | |
| sort_order | INT | |
| scene_heading / action_text / dialogue / camera_movement | TEXT | 分镜文本 |
| image_prompt / video_prompt | TEXT | AI 生成 prompt |
| generated_image_url | TEXT | **⚠️ LEGACY** — 新流程用 files 表 |
| bound_assets | JSONB | 绑定资产 ID |
| status | VARCHAR | |
| dialogue_audio_url / narration_audio_url / sfx_audio_url | TEXT | 音频 URL |
| audio_duration_ms / planned_duration_ms | INT | |
| mixed_audio_url | TEXT | Backend-mixed reference audio URL（`POST /api/storyboard/mix-audio` 写入） |
| mixed_audio_hash | VARCHAR(64) | sha1 of `(dialogue_url\|narration_url\|sfx_url\|gains)`；同 hash 直接复用 `mixed_audio_url` |
| script_segment_id | VARCHAR(50) | 三步生成：来源剧本分段 ID（→ `episode_script_segments.segment_id`） |
| source_video_shot_no | VARCHAR(50) | 三步生成：视频脚本中的镜头编号 |
| video_script_block | TEXT | 三步生成：该镜头对应的视频脚本原文片段 |
| shot_size | VARCHAR(50) | 三步生成：景别（远/全/中/近/特等） |
| camera_angle | VARCHAR(100) | 三步生成：机位/运镜角度 |
| created_at / updated_at | TIMESTAMP | |

> **Index**: `idx_storyboard_items_mixed_audio_hash` on `mixed_audio_hash WHERE mixed_audio_hash IS NOT NULL`（按 hash 反查缓存）。Migration: `db_migration_storyboard_audio_mix.sql`。
> **Index**: `idx_storyboard_items_script_segment` on `script_segment_id`（按剧本分段反查镜头）。三步生成扩列 Migration: `db_migration_storyboard_pipeline_fields.sql`（2026-05-29，§5.2）。

### assets — `dao_asset.py` · `db_migration_assets.sql`

**API**: `GET /api/projects/{project_id}/assets`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| asset_id | VARCHAR UNIQUE | 业务主键 |
| project_id | VARCHAR FK→projects | |
| episode_id | VARCHAR FK→episodes | |
| asset_type | VARCHAR | character/scene/prop |
| name | VARCHAR | |
| description | TEXT | |
| thumbnail_url | TEXT | **⚠️ 必须 `/storage/...`，禁止 data URL** |
| reference_images | JSONB | **⚠️ 必须 `/storage/...`，禁止 data URL** |
| style_params / tags | JSONB | |
| created_by | VARCHAR FK→users | |
| created_at / updated_at | TIMESTAMP | |

**API 内嵌字段**：`GET /api/projects/{pid}/assets` 返回的每个 asset 对象包含
`entity_files` 数组（非数据库列），通过 `EntityFileDAO.get_files_for_entities()`
从 `files` 表 JOIN 而来。结构：

| 字段 | 类型 | 说明 |
|------|------|------|
| file_id | VARCHAR | 文件唯一 ID |
| file_url | VARCHAR | HTTP 访问路径 `/storage/...` |
| file_type | VARCHAR | image / audio / video |
| file_role | VARCHAR | reference_image / asset_thumbnail / ... |
| is_selected | BOOLEAN | 是否选中 |
| created_at | TIMESTAMP | 创建时间 |

前端通过 `AssetItem.entityFiles` 消费此数据，`assetsToMaterialLibrary()` 优先
使用 entity files 构建素材库，`assets.reference_images` 列作为老数据降级。

### episode_scripts — `db_migration_episode_scripts.sql` + `db_migration_multi_scripts.sql`

每个分集可有多个文件（多素材/草稿），`episode_id` 非唯一。

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| script_id | VARCHAR UNIQUE | 文件唯一标识 |
| episode_id | VARCHAR FK→episodes | 所属分集（非唯一，支持多文件） |
| file_name | VARCHAR(255) | 文件名称，默认 '未命名文件' |
| original_content / adapted_script | TEXT | 原始/改编 |
| sort_order | INT | 排序序号 |
| metadata | JSONB | |
| created_at / updated_at | TIMESTAMP | |

### episode_script_segments — `dao_episode_script_segment.py` · `db_migration_episode_script_segments.sql`

三步生成中间产物（拆分→视频脚本→提取分镜）：原始剧本按分段拆分后的存储，每段可独立生成视频脚本，再提取为分镜。`episode_scripts` 1:N → `episode_script_segments`（2026-05-29，§5.1）。

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| segment_id | VARCHAR(50) UNIQUE | 业务主键 |
| episode_id | VARCHAR(50) FK→episodes | ON DELETE CASCADE |
| script_id | VARCHAR(50) FK→episode_scripts | ON DELETE CASCADE，所属剧本文件 |
| segment_order | INT | 分段顺序，DEFAULT 0 |
| source_text | TEXT | 原始剧本分段文本，DEFAULT '' |
| estimated_duration_sec | INT | 预估时长（秒），可空 |
| video_script | TEXT | 该分段生成的视频脚本，DEFAULT '' |
| status | VARCHAR(20) | pending/...，DEFAULT 'pending' |
| error_message | TEXT | DEFAULT '' |
| metadata | JSONB | DEFAULT '{}' |
| created_at / updated_at | TIMESTAMP | trigger `trg_episode_script_segments_updated_at` 自动维护 |

> **Index**: `idx_episode_script_segments_episode` on `episode_id`；`idx_episode_script_segments_script_order` on `(script_id, segment_order)`。

### text_contents — `database_schema.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| content_id | VARCHAR UNIQUE | |
| version_id | VARCHAR FK→versions | |
| user_id | VARCHAR FK→users | |
| content_type | VARCHAR | |
| title | VARCHAR | |
| content | TEXT | |
| language | VARCHAR | |
| word_count | INT | |
| metadata | JSONB | |
| is_deleted | BOOLEAN | 软删除 |
| created_at / updated_at | TIMESTAMP | |

### video_segments — `dao_video.py` · `db_migration_video_segments.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| segment_id | VARCHAR UNIQUE | |
| episode_id | VARCHAR FK→episodes | |
| storyboard_item_id | VARCHAR FK→storyboard_items | |
| sort_order | INT | |
| generation_mode / model | VARCHAR | 生成模式/AI 模型（含 `Seedance2` / `Seedance2Fast`） |
| input_params | JSONB | 旧家：`{prompt, model, image_url, ...}`；Seedance 2.0 增加：`{sub_model, media_inputs:[{kind,url,role,file_id?}], ratio, duration, resolution, seed, watermark, generate_audio, camera_fixed, draft_task_id?}` |
| video_url / thumbnail_url | TEXT | 由 worker `_save_external_video` 通过 `_sync_legacy_on_file_create(entity_type=video_segment, file_role=video/video_thumbnail)` 自动写入（修补历史漏洞，4 家旧 API + Seedance 同享） |
| duration_ms | INT | |
| task_id | VARCHAR FK→tasks | |
| status | VARCHAR | |
| created_at / updated_at | TIMESTAMP | |

### audio_tracks — `dao_audio_track.py` · `db_migration_audio_tracks.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| track_id | VARCHAR UNIQUE | |
| episode_id | VARCHAR FK→episodes | |
| track_type | VARCHAR | dialogue/narration/sfx/music |
| name | VARCHAR | |
| audio_url | TEXT | |
| duration_ms | INT | |
| start_item_id / end_item_id | VARCHAR | 分镜范围 |
| generation_params | JSONB | |
| created_at / updated_at | TIMESTAMP | |

### character_voices — `dao_character_voice.py` · `db_migration_character_voices.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| voice_id | UUID UNIQUE | `gen_random_uuid()`，DAO 用 `$N::uuid` cast |
| project_id | VARCHAR(50) FK→projects | `proj_xxxx`，**不是** UUID（早期迁移误写为 UUID 已修，见 faq 2026-05-04） |
| asset_id | VARCHAR(50) FK→assets | `asset_xxxx`，可空，asset 删除时置 NULL |
| character_name | VARCHAR(200) | |
| voice_provider | VARCHAR(50) | minimax/gemini |
| voice_model_id / voice_name | VARCHAR(200) | minimax 预置 voice_id 或克隆/设计返回的 voice_id |
| voice_params | JSONB | `{source: 'system'\|'design'\|'clone', ...}` |
| sample_audio_url | TEXT | `/storage/audio/...` |
| created_at / updated_at | TIMESTAMP | |

### timeline_tracks — `db_migration_timeline_tracks.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| track_id | VARCHAR UNIQUE | |
| episode_id | VARCHAR FK→episodes | |
| track_type | VARCHAR | video/audio/subtitle |
| track_name | VARCHAR | |
| sort_order | INT | |
| items | JSONB | 轨道内容列表 |
| created_at / updated_at | TIMESTAMP | |

---

## 4. File Management

### files（统一文件存储） — `dao_content.py`（推荐）/ `dao_file.py`（legacy）

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| file_id | VARCHAR UNIQUE | UUID 业务主键 |
| version_id | VARCHAR | 可 NULL |
| user_id | VARCHAR FK→users | |
| file_type | VARCHAR | image/audio/video/text |
| file_name | VARCHAR | |
| file_path | TEXT | 磁盘绝对路径 |
| file_url | TEXT | HTTP 路径 `/storage/...` |
| file_size_bytes | BIGINT | |
| mime_type | VARCHAR | |
| width / height | INT | 图片/视频尺寸 |
| duration_seconds | FLOAT | 音频/视频时长 |
| thumbnail_url | TEXT | |
| metadata | JSONB | {source, task_id, episode_id, ...} |
| is_deleted | BOOLEAN | **软删除** |
| deleted_at | TIMESTAMP | |
| entity_type | VARCHAR | storyboard_item/asset/video_segment（migration 添加） |
| entity_id | VARCHAR | 关联实体 ID（migration 添加） |
| file_role | VARCHAR | generated_image/reference_image/dialogue_audio/...（migration 添加） |
| is_selected | BOOLEAN | 是否选定（migration 添加） |
| created_at / updated_at | TIMESTAMP | |

**⚠️ 双 DAO 陷阱**:
- `dao_file.py` → `FileDAO.create()` — 不支持 entity 字段，避免使用
- `dao_content.py` → `FileDAO.create_file()` — 支持全部字段，**推荐**

### task_files — `database_schema.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| task_id | VARCHAR FK→tasks | |
| file_id | VARCHAR FK→files | |
| file_role | VARCHAR | input/output |
| created_at | TIMESTAMP | |

### file_shares — `database_schema.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| share_id | VARCHAR UNIQUE | |
| file_id | VARCHAR FK→files | |
| user_id | VARCHAR FK→users | |
| share_token | VARCHAR UNIQUE | |
| expires_at | TIMESTAMP | |
| password_hash | VARCHAR | |
| access_count / max_access_count | INT | |
| created_at | TIMESTAMP | |
| is_active | BOOLEAN | |

---

## 5. Task System

### tasks — `database_schema.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| task_id | VARCHAR UNIQUE | |
| user_id | VARCHAR FK→users | |
| project_id | VARCHAR FK→projects | |
| version_id | VARCHAR FK→versions | |
| task_type | VARCHAR | i2v/morph/upscale/qwen/kontext/... |
| status | VARCHAR | pending/processing/completed/failed |
| priority | INT | |
| task_data / result_data | JSONB | 输入/输出 |
| error_message | TEXT | |
| node_id | VARCHAR | worker 节点 |
| retry_count / max_retries | INT | |
| metadata | JSONB | |
| created_at / started_at / completed_at | TIMESTAMP | |

### task_history — `db_migration_admin.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| task_id | VARCHAR | |
| agent_id | VARCHAR FK→comfyui_agents | |
| workflow_id | VARCHAR | |
| task_type | VARCHAR | |
| params / result | JSONB | |
| status | VARCHAR | |
| error_message | TEXT | |
| queued_at / started_at / completed_at / updated_at | TIMESTAMP | |

### comfyui_agents — `dao_agent.py` · `db_migration_admin.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| agent_id | VARCHAR UNIQUE | |
| name / token | VARCHAR | 名称/认证 token |
| status | VARCHAR | online/offline |
| last_heartbeat | TIMESTAMP | |
| system_info / comfyui_instances / stats | JSONB | 硬件/实例/统计 |
| enabled | BOOLEAN | |
| created_at / updated_at | TIMESTAMP | |

### workflow_templates — `db_migration_admin.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| template_id | VARCHAR UNIQUE | |
| name / category | VARCHAR | |
| description | TEXT | |
| workflow_json / placeholders | JSONB | 工作流/占位符映射 |
| node_type | VARCHAR | |
| estimated_time | INT | 预估秒数 |
| enabled | BOOLEAN | |
| version | INT | |
| workflow_key | VARCHAR(100) | 热重载用：写盘文件名 stem（如 `wan2_i2v` → `workflows/wan2_i2v.json`），与 `WORKFLOW_CONFIGS` 字典键对齐；可空，UNIQUE INDEX `idx_workflow_templates_key`（部分索引）|
| created_at / updated_at | TIMESTAMP | |

---

## 6. System & Config

### api_configurations — `dao_api_config.py` · `db_migration_admin.sql` · `db_migration_api_config_category.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| config_id | VARCHAR UNIQUE | |
| name | VARCHAR | |
| provider | VARCHAR | gemini/doubao/minimax/sora2/veo/wan26/**seedance**/... |
| endpoint | TEXT | |
| api_key_encrypted | TEXT | 加密存储 |
| model_name | VARCHAR | |
| category | VARCHAR(20) | DEFAULT '' CHECK (category IN ('','text','image','video','audio')) — 模型分类：admin UI 按此字段分组显示。2026-05-24 新增。 |
| request_template / headers | JSONB | |
| proxy_mode | VARCHAR | direct/system/custom |
| custom_proxy | TEXT | |
| enabled | BOOLEAN | |
| created_at / updated_at | TIMESTAMP | |

### system_configs — `database_schema.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| config_key | VARCHAR UNIQUE | |
| config_value | JSONB | |
| description | TEXT | |
| updated_at | TIMESTAMP | |

### system_settings — `db_migration_admin.sql`

| Column | Type | Notes |
|--------|------|-------|
| key | VARCHAR PK | |
| value | TEXT | |
| description | TEXT | |
| updated_at | TIMESTAMP | |

### activity_logs — `database_schema.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| user_id | VARCHAR FK→users | |
| action / resource_type / resource_id | VARCHAR | |
| ip_address | VARCHAR | |
| user_agent | TEXT | |
| metadata | JSONB | |
| created_at | TIMESTAMP | |

### notifications — `db_migration_notifications.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| notification_id | VARCHAR UNIQUE | |
| user_id | VARCHAR FK→users | |
| task_id | VARCHAR FK→tasks | |
| type / category | VARCHAR | |
| title | VARCHAR | |
| message | TEXT | |
| status | VARCHAR | unread/read |
| target_view / target_project_id / target_page / target_item_id | VARCHAR | 导航目标 |
| metadata | JSONB | |
| created_at / read_at | TIMESTAMP | |

---

## 7. Canvas

### canvas_boards — `dao_canvas.py` · `db_migration_project_hub.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| board_id | VARCHAR UNIQUE | |
| project_id | VARCHAR FK→projects | |
| user_id | VARCHAR FK→users | |
| name | VARCHAR | |
| description | TEXT | |
| viewport | JSONB | {x, y, zoom} |
| is_deleted | BOOLEAN | 软删除 |
| created_at / updated_at | TIMESTAMP | |

### canvas_nodes — `db_migration_project_hub.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| node_id | VARCHAR UNIQUE | |
| board_id | VARCHAR FK→canvas_boards | |
| node_type | VARCHAR | |
| x / y / width / height | FLOAT | 位置尺寸 |
| data | JSONB | 节点内容 |
| z_index | INT | |
| is_locked | BOOLEAN | |
| created_at / updated_at | TIMESTAMP | |

### canvas_connections — `db_migration_project_hub.sql`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| connection_id | VARCHAR UNIQUE | |
| board_id | VARCHAR FK→canvas_boards | |
| source_node_id / target_node_id | VARCHAR FK→canvas_nodes | |
| source_port / target_port | VARCHAR | |
| label | VARCHAR | |
| created_at | TIMESTAMP | |

---

## 8. Entity Relationships

```
users ──1:N──> projects ──1:N──> versions
                │                    └──1:N──> files
                ├──1:N──> episodes
                │            ├──1:N──> storyboard_items
                │            ├──1:N──> video_segments
                │            ├──1:N──> audio_tracks
                │            ├──1:N──> timeline_tracks
                │            └──1:1──> episode_scripts ──1:N──> episode_script_segments
                ├──1:N──> assets ──1:N──> character_voices
                ├──1:N──> canvas_boards ──1:N──> canvas_nodes
                │                        └──1:N──> canvas_connections
                └──N:M──> project_members ──> users

tasks ──1:N──> task_files ──> files
files ──1:N──> file_shares
      └── entity_type/entity_id ──> storyboard_items | assets | video_segments
```

---

## 9. 跨页面数据传输链路

### 页面数据流转全景

```
剧本(Script) → 设计(Design) → 素材(Material) → 配音(Audio) → 分镜(Storyboard) → 视频(Video) → 美化(Enhance)
```

### 各转换节点详情

| # | 转换 | 流转数据 | 写入位置 | 读取位置 | 同步机制 |
|---|------|---------|---------|---------|---------|
| 1 | 剧本→设计 | `episode_scripts.adapted_script` → AI 提取 `assets` | `episode_scripts` 表 | `assets` 表 via EpisodeContext | `extractToAssets` API 直接创建 |
| 2 | 设计→素材 | `assets.reference_images` (参考图) | `files` 表 (entity binding) | `asset.referenceImages` via `assetsToMaterialLibrary()` | **`_sync_legacy_on_file_create`** 自动追加 |
| 3 | 素材→配音 | `storyboard_items.bound_assets` (角色绑定标签) | `storyboard_items` 表 | 同字段 via EpisodeContext | 同字段读写 |
| 4 | 配音→分镜 | `storyboard_items.dialogue_audio_url` + `audio_duration_ms` | 双写: `files` 表 + legacy 字段 | 音频: 旧字段; 图片: `files` 表优先 | `_sync_legacy_on_file_create` + `_sync_legacy_url` |
| 5 | 分镜→视频 | `storyboard_items.generated_image_url` + `image_prompt` | 双写: `files` 表 + legacy 字段 | 旧字段 `generatedImageUrl` | `_sync_legacy_url` (select 时同步) |
| 6 | 视频→美化 | `video_segments.video_url` + 音频 | `files` 表 + workspace session | `video_segments` 表 via EpisodeContext | `_sync_legacy_on_file_create` (需传 entity params) |

### Legacy 字段自动同步机制

**`_sync_legacy_on_file_create()`** — `file_service.py`

当通过 `save_generated_file_to_db()` 或 ComfyUI worker 创建文件时，自动同步到旧业务表字段：

| entity_type | file_role | 同步到 | 同步方式 |
|-------------|-----------|--------|---------|
| `asset` | `reference_image` | `assets.reference_images` (JSONB 数组) | **追加** URL 到数组 |
| `storyboard_item` | `generated_image` | `storyboard_items.generated_image_url` | **覆盖** |
| `storyboard_item` | `dialogue_audio` | `storyboard_items.dialogue_audio_url` | **覆盖** |
| `storyboard_item` | `narration_audio` | `storyboard_items.narration_audio_url` | **覆盖** |
| `storyboard_item` | `sfx` | `storyboard_items.sfx_audio_url` | **覆盖** |
| `video_segment` | `video` | `video_segments.video_url` | **覆盖** |
| `video_segment` | `video_thumbnail` | `video_segments.thumbnail_url` | **覆盖** |

**`_sync_legacy_url()`** — `api_routes.py`

当用户"选择"文件时 (`PUT /api/entity-files/{fileId}/select`)，同步选中的 URL 到旧字段。覆盖范围与上表相同。

**调用入口**：

| 入口 | 文件 | 触发条件 |
|------|------|---------|
| `save_generated_file_to_db()` | `file_service.py` | Gemini/Doubao/TTS/音效/音乐 等同步 API 生成 |
| ComfyUI worker `_persist_file` | `worker.py` | ComfyUI 异步任务完成后 |
| `select_entity_file` API | `api_routes.py` | 用户在前端选择文件 |

### EpisodeContext 共享数据切片

所有页面通过 `useEpisode()` 共享以下数据（按需加载）：

| 切片 | DB 表 | 加载函数 | 使用页面 |
|------|--------|---------|---------|
| `script` | `episode_scripts` | `getEpisodeScript()` | ScriptPage, DesignPage, StoryboardGenPage |
| `assets` | `assets` | `getAssets()` | DesignPage, MaterialsPage, StoryboardGenPage, AudioStagePage |
| `storyboardItems` | `storyboard_items` | `getStoryboardItems()` | MaterialsPage, AudioStagePage, StoryboardGenPage, VideoGenPage |
| `audioTracks` | `audio_tracks` | `getAudioTracks()` | AudioStagePage |
| `videoSegments` | `video_segments` | `getVideoSegments()` | VideoGenPage |
| `characterVoices` | `character_voices` | `getCharacterVoices()` | AudioStagePage |

---

## 10. Critical Rules

| Rule | Detail |
|------|--------|
| files 软删除 | `is_deleted=TRUE` + `deleted_at`，查询加 `WHERE is_deleted = FALSE` |
| generated_image_url | **LEGACY** — 新代码用 files 表 (entity_type='storyboard_item')，通过 `_sync_legacy_on_file_create` 保持同步 |
| assets.reference_images | **LEGACY** — 新代码用 files 表 (entity_type='asset', file_role='reference_image')，通过 `_sync_legacy_on_file_create` 自动追加 |
| assets/thumbnail URL | **必须** `/storage/...`，**禁止** base64 data URL |
| 推荐 DAO | `dao_content.py FileDAO.create_file()` (支持 entity 字段) |
| 遗留 DAO | `dao_file.py FileDAO.create()` (无 entity 字段，避免使用) |
| file_url 格式 | `/storage/{user_id}/...` 相对路径 |
| entity_type 枚举 | `storyboard_item` / `asset` / `video_segment` |
| file_role 枚举 | `generated_image` / `reference_image` / `dialogue_audio` / `narration_audio` / `sfx` / `video` / `video_thumbnail` / `asset_thumbnail` / `material_image` |
| 跨页面数据联通 | **任何向 files 表写入的操作都必须传递 entity_type + entity_id + file_role**，否则 `_sync_legacy_on_file_create` 无法同步旧字段，下游页面看不到数据 |

---

## 11. 2026-05-26 新增模块（Slice 1–5）

> 修改这些表前，同时核对对应 DAO、服务、路由和前端数据适配器，避免只更新单一层的字段契约。

### 11.1 媒体素材库（Slice 1）— `media_library_items`, `media_library_usages`

`media_library_items` — 通用素材库索引表（**真实文件仍在 `files` 表**，本表只挂标签/权限/收藏/计数）：

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | 自增整数 |
| `library_item_id` | VARCHAR(50) UNIQUE | 对外业务 ID（UUID） |
| `file_id` | VARCHAR(50) FK → `files.file_id` | 关联底层文件，删文件级联删本行 |
| `user_id` | VARCHAR(50) FK → `users.user_id` | 上传/生成者 |
| `project_id` | VARCHAR(50) NULL FK → `projects.project_id` | 项目归属（NULL=未挂项目） |
| `episode_id` | VARCHAR(50) NULL | 仅在自动入库的生成产物上写入 |
| `team_id` | VARCHAR(50) NULL | 团队共享（预留） |
| `item_type` | VARCHAR(20) | `image` / `video` / `audio` / `text` / `other` |
| `source` | VARCHAR(50) | 例：`upload` / `generated_image_gpt` / `generated_video_comfyui` / `generated_video_dashscope` / `generated_audio_minimax` / `audio_mix` / `video_reverse_frame` |
| `title`, `description`, `tags(JSONB)` | | UI 字段 |
| `permission_scope` | VARCHAR(30) | `private` / `project` / `team` / `public_link` |
| `is_favorite`, `use_count` | BOOLEAN, INT | 收藏 + 引用计数缓存 |
| `source_task_id`, `source_entity_type`, `source_entity_id` | | 反向溯源到任务 / 素材 |
| `metadata(JSONB)` | | 扩展元数据（如视频时长、宽高） |
| `is_deleted`, `deleted_at` | | 软删；Slice 5 admin 删除时另写 `admin_audit_logs` |
| `created_at`, `updated_at` | TIMESTAMP | trigger `trg_media_library_items_updated_at` 自动维护 |

`media_library_usages` — 同一素材在多处引用的记录（用作"删除前 GC 检查"）：

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `usage_id` | VARCHAR(50) UNIQUE | 对外业务 ID |
| `library_item_id` | VARCHAR(50) FK → `media_library_items.library_item_id` | |
| `file_id`, `user_id`, `project_id`, `task_id` | | 引用上下文 |
| `usage_context` | VARCHAR(100) | `image_gen_reference` / `video_reverse_input` / `char_asset_bind` / … |
| `target_entity_type`, `target_entity_id` | | |

> **业务 ID 约定**：所有 admin / FE / API 层对外使用 `library_item_id`，**不要**使用自增 `id`。`file_id` **没有 UNIQUE 约束**——迁移脚本 `scripts/migrate_files_to_media_library.py` 通过显式 `_already_in_library()` 自检保持幂等。

**DAO**：`dao_media_library.py`（含 `list_for_user` / `list_admin` / `soft_delete` / `mark_favorite` / `update_scope`…）。

**Service**：`media_library_service.py` 提供 `create_from_file()` —— worker / api_routes / audio_mix 在落库后 best-effort 调用以自动入库。

#### 11.1.1 素材库文件夹（2026-05-30）— `media_library_folders` + `media_library_items.folder_id`

用户可在素材库下建可嵌套的文件夹（人物 / 场景 / 道具 等自定义分类）。迁移脚本：`db_migration_media_library_folders.sql`。

`media_library_folders`：

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | 自增整数 |
| `folder_id` | VARCHAR(50) UNIQUE | 对外业务 ID（`mlf_` 前缀） |
| `project_id` | VARCHAR(50) FK → `projects.project_id` | 项目级；删项目级联删文件夹 |
| `parent_folder_id` | VARCHAR(50) NULL 自引用 FK | 父文件夹；`ON DELETE CASCADE`（删父级联删子） |
| `name` | VARCHAR(255) | 文件夹名 |
| `folder_order` | INTEGER | 同级排序 |
| `created_at`, `updated_at` | TIMESTAMP | trigger `trg_media_library_folders_updated_at` 自动维护 |

新增列 `media_library_items.folder_id VARCHAR(50) NULL FK → media_library_folders.folder_id`，**`ON DELETE SET NULL`** —— 删文件夹时夹内素材不删，只变为「未归类」。

**DAO**：`dao_media_library_folder.py`（`list_by_project` / `create` / `update` / `delete` / `would_create_cycle` 防环）。`folder_id` 已贯通 `MediaLibraryDAO.create/update/list_for_user` 与 `media_library_service.create_from_file/list_items`。

### 11.2 积分系统（Slice 2）— `credit_accounts`, `credit_freezes`, `credit_transactions`, `credit_rules`

| Table | 关键字段 | 作用 |
|-------|---------|------|
| `credit_accounts` | `id`、`owner_type`(`user`/`project`)、`owner_id`、`balance`、`frozen`、`total_earned`、`total_spent`、`is_enabled` | 总账户表，支持 `SELECT … FOR UPDATE` 原子操作 |
| `credit_freezes` | `id`、`account_id` FK、`amount`、`reason`、`feature_key`、`task_id`、`status`(`active`/`released`/`confirmed`)、`expires_at` | 冻结记录（estimate→freeze→confirm/release 三段式） |
| `credit_transactions` | `id`、`account_id` FK、`change_type`(`earn`/`spend`/`freeze`/`release`/`confirm`/`adjust`)、`amount`、`balance_after`、`feature_key`、`task_id`、`operated_by` | 流水。Slice 5 新增 `operated_by` 字段记录 admin 调账操作员 |
| `credit_rules` | `feature_key` PK、`unit`、`unit_cost`、`description`、`is_enabled` | 计费规则（一个功能一行） |

**DAO**：`dao_credit.py`（`CreditAccountDAO` / `CreditFreezeDAO` / `CreditTransactionDAO` / `CreditRuleDAO`）。
**Service**：`credit_service.py`（`estimate` / `freeze` / `confirm_spend` / `release_freeze` / `admin_adjust`）。

> **跨表事务约定**：所有积分操作 **必须** 在同一连接 + `SELECT … FOR UPDATE` 内完成，禁止跨连接调用。`admin_adjust` 之前需要先 `CreditAccountDAO.get_or_create(user_id, owner_type='user')` 取出 `account_id`，然后才能写流水。

### 11.3 视频反推（Slice 3）— `video_reverse_tasks`, `video_reverse_segments`

| Table | 关键字段 | 作用 |
|-------|---------|------|
| `video_reverse_tasks` | `id`、`user_id`、`project_id`、`status`(`pending`/`splitting`/`extracting_frames`/`analyzing`/`building_prompts`/`completed`/`failed`/`cancelled`)、`source_video_url`、`error`、`cost_credits`、`freeze_id` | 主任务 |
| `video_reverse_segments` | `task_id` FK、`index`、`start_ms`/`end_ms`、`frame_urls`(JSON)、`visual_analysis`(JSON)、`prompt_text` | 切分后的每个镜头段 |

**DAO**：`dao_video_reverse.py`。
**Service**：`video_reverse_service.py`（estimate → create → 多 worker 流水线 → cancel/retry）。

### 11.4 管理后台增强（Slice 4 / 5）— `project_groups`, `admin_audit_logs` + 既有表扩展

| Table / Column | 作用 |
|---------------|------|
| `project_groups` (新表) | 项目分组：`id`、`name`、`parent_id`(自引用)、`owner_id`、`color`、`description` |
| `projects.group_id` (新增列) | 项目归属分组 (`project_groups.id`) |
| `admin_audit_logs` (新表) | 操作审计：`id`、`admin_id`、`action`、`target_type`、`target_id`、`payload_before`/`payload_after`、`ip`、`user_agent`、`created_at` |
| `credit_accounts.is_enabled` (新增列) | 允许 admin 临时禁用账户 |
| `credit_transactions.operated_by` (新增列) | 流水追溯 admin 操作员 |
| `media_library_items.deleted_reason` (新增列) | admin 软删素材时附加原因 |

**DAO**：`dao_admin_audit.py` + 既有 `dao_credit.py` / `dao_media_library.py` / `dao_project.py` 的 admin 扩展方法。
**Service**：`admin_audit_service.py`（`record(action, target, before, after, request)`，从 JWT 解出 `admin_id`，自动注入 IP / UA）。所有 admin mutation 已在 `admin_routes.py` 中包裹 `admin_audit_service.record(...)`。

### 11.5 组织管理 MVP（2026-05-26）— `organizations`, `organization_members`, `resource_shares`

| Table / Column | 关键字段 | 作用 |
|---------------|---------|------|
| `organizations` (新表) | `org_id` UNIQUE、`name`、`owner_user_id` FK→users、`status`(`active`/`archived`)、`description`、`color`、`created_by`、`created_at`/`updated_at` | 组织主表。一级实体，与 user 多对多 |
| `organization_members` (新表) | `org_id` FK、`user_id` FK、`role`(`owner`/`admin`/`member`)、`joined_at`、`added_by`，复合主键 `(org_id, user_id)` | 成员关系。一个用户在一个组织里只能有一个 role |
| `resource_shares` (新表) | `share_id` UNIQUE、`resource_type`(`project`/`media`/`group`)、`resource_id`、`share_target_type`(`org`/`project`)、`share_target_id`、`granted_by_user_id`、`granted_at`，UNIQUE `(resource_type,resource_id,share_target_type,share_target_id)` | 资源共享映射。多态映射 — 同表服务三种资源 ↔ 两种目标 |
| `media_library_items.visibility` (新增列) | VARCHAR(30) DEFAULT 'private' | 素材可见性 badge（不参与权限判断，权限走 `resource_shares`）|
| `project_groups.organization_id` (新增列) | VARCHAR(50) FK→organizations，ON DELETE SET NULL | 分组归属的组织（个人分组为 NULL）|

> **visibility 字段语义**：`'private'` = 仅 owner；`'org-default'` = 创建时**自动**往 `resource_shares` 插一行 (target=用户当前活动组织)，之后只用作 UI badge。所有真实权限判断走 `resource_shares` JOIN，**不读 visibility 列**。
>
> **`project_groups.team_id`**（旧 Slice 4 预留列，从未使用）保留 backward-compat；新功能走 `organization_id`。

**DAO**：`dao_organization.py`（`OrganizationDAO` / `OrganizationMemberDAO`） + `dao_resource_share.py`（`ResourceShareDAO`）。

### 11.6 SQL 文件入口

| 文件 | 位置 | 涵盖 |
|------|------|------|
| `db_migration_media_library.sql` | root + `deploy/` | 11.1 |
| `db_migration_credits.sql` | root + `deploy/` | 11.2 |
| `db_migration_video_reverse.sql` | root + `deploy/` | 11.3 |
| `db_migration_project_groups.sql` | root + `deploy/` | 11.4 (groups) |
| `db_migration_admin_extra.sql` | root + `deploy/` | 11.4 (audit + 既表扩展列) |
| `db_migration_organizations.sql` | root + `deploy/` + `deploy/sql/` | 11.5 (3 新表 + trigger) |
| `db_migration_visibility_columns.sql` | root + `deploy/` + `deploy/sql/` | 11.5 (media_library_items.visibility + project_groups.organization_id) |

所有迁移均为 idempotent（`IF NOT EXISTS` / `ALTER … ADD COLUMN IF NOT EXISTS`）。一次性迁移脚本 `scripts/migrate_files_to_media_library.py` 把存量 `files` 反向回填到 `media_library_items`，支持 `--apply` / `--user-id` / `--limit` / dry-run。
