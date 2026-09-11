-- Unified content workflow model.
-- This migration adds a compatibility layer on top of the existing files,
-- storyboard_items and video_segments tables.  Existing media URLs remain the
-- source of truth for legacy readers while new code can use one candidate /
-- selection model for images, video and audio.

ALTER TABLE storyboard_items
    ADD COLUMN IF NOT EXISTS lineage_id VARCHAR(100);

UPDATE storyboard_items
SET lineage_id = item_id
WHERE lineage_id IS NULL OR BTRIM(lineage_id) = '';

CREATE OR REPLACE FUNCTION ensure_storyboard_item_lineage_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.lineage_id IS NULL OR BTRIM(NEW.lineage_id) = '' THEN
        NEW.lineage_id = NEW.item_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_storyboard_item_lineage_id ON storyboard_items;
CREATE TRIGGER trg_storyboard_item_lineage_id
    BEFORE INSERT ON storyboard_items
    FOR EACH ROW
    EXECUTE FUNCTION ensure_storyboard_item_lineage_id();

ALTER TABLE storyboard_items
    ALTER COLUMN lineage_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_storyboard_items_lineage
    ON storyboard_items(episode_id, lineage_id);

ALTER TABLE video_segments
    ADD COLUMN IF NOT EXISTS storyboard_lineage_id VARCHAR(100);

UPDATE video_segments vs
SET storyboard_lineage_id = si.lineage_id
FROM storyboard_items si
WHERE vs.storyboard_item_id = si.item_id
  AND (vs.storyboard_lineage_id IS NULL OR BTRIM(vs.storyboard_lineage_id) = '');

CREATE OR REPLACE FUNCTION capture_video_segment_storyboard_lineage()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.storyboard_lineage_id IS NULL AND NEW.storyboard_item_id IS NOT NULL THEN
        SELECT lineage_id INTO NEW.storyboard_lineage_id
        FROM storyboard_items
        WHERE item_id = NEW.storyboard_item_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_video_segment_storyboard_lineage ON video_segments;
CREATE TRIGGER trg_video_segment_storyboard_lineage
    BEFORE INSERT OR UPDATE OF storyboard_item_id ON video_segments
    FOR EACH ROW
    EXECUTE FUNCTION capture_video_segment_storyboard_lineage();

CREATE INDEX IF NOT EXISTS idx_video_segments_storyboard_lineage
    ON video_segments(episode_id, storyboard_lineage_id);


CREATE TABLE IF NOT EXISTS content_takes (
    id BIGSERIAL PRIMARY KEY,
    take_id VARCHAR(100) UNIQUE NOT NULL,
    user_id VARCHAR(50) REFERENCES users(user_id) ON DELETE SET NULL,
    project_id VARCHAR(50) REFERENCES projects(project_id) ON DELETE CASCADE,
    episode_id VARCHAR(50) REFERENCES episodes(episode_id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    entity_lineage_id VARCHAR(100),
    slot VARCHAR(50) NOT NULL,
    file_id VARCHAR(100) REFERENCES files(file_id) ON DELETE SET NULL,
    source_type VARCHAR(50) NOT NULL DEFAULT 'generated',
    source_id VARCHAR(100),
    source_task_id VARCHAR(100),
    requested_entity_id VARCHAR(100),
    requested_lineage_id VARCHAR(100),
    provider VARCHAR(100),
    model_name VARCHAR(255),
    generation_params JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'recycled')),
    attachment_round SMALLINT NOT NULL DEFAULT 0
        CHECK (attachment_round BETWEEN 0 AND 3),
    is_late BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_content_takes_entity_slot
    ON content_takes(entity_type, entity_id, slot, created_at DESC)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_content_takes_lineage_slot
    ON content_takes(episode_id, entity_lineage_id, slot, created_at DESC)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_content_takes_task
    ON content_takes(source_task_id)
    WHERE source_task_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_takes_file_slot
    ON content_takes(entity_type, entity_id, slot, file_id)
    WHERE file_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_takes_source_slot
    ON content_takes(entity_type, entity_id, slot, source_type, source_id)
    WHERE source_id IS NOT NULL;


CREATE TABLE IF NOT EXISTS content_selections (
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    slot VARCHAR(50) NOT NULL,
    selected_take_id VARCHAR(100) NOT NULL
        REFERENCES content_takes(take_id) ON DELETE CASCADE,
    selected_by VARCHAR(50) REFERENCES users(user_id) ON DELETE SET NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    selected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (entity_type, entity_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_content_selections_take
    ON content_selections(selected_take_id);


CREATE TABLE IF NOT EXISTS content_stale_events (
    id BIGSERIAL PRIMARY KEY,
    stale_event_id VARCHAR(100) UNIQUE NOT NULL,
    project_id VARCHAR(50) REFERENCES projects(project_id) ON DELETE CASCADE,
    episode_id VARCHAR(50) REFERENCES episodes(episode_id) ON DELETE CASCADE,
    target_entity_type VARCHAR(50) NOT NULL,
    target_entity_id VARCHAR(100) NOT NULL,
    target_lineage_id VARCHAR(100),
    target_slot VARCHAR(50) NOT NULL,
    source_entity_type VARCHAR(50) NOT NULL,
    source_entity_id VARCHAR(100),
    reason_code VARCHAR(100) NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'ignored', 'regenerated')),
    idempotency_key VARCHAR(255),
    created_by VARCHAR(50) REFERENCES users(user_id) ON DELETE SET NULL,
    resolved_by VARCHAR(50) REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_content_stale_pending
    ON content_stale_events(episode_id, target_entity_type, target_entity_id, target_slot, created_at DESC)
    WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_stale_idempotency
    ON content_stale_events(idempotency_key)
    WHERE idempotency_key IS NOT NULL;


CREATE TABLE IF NOT EXISTS content_bindings (
    id BIGSERIAL PRIMARY KEY,
    binding_id VARCHAR(100) UNIQUE NOT NULL,
    project_id VARCHAR(50) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    episode_id VARCHAR(50) REFERENCES episodes(episode_id) ON DELETE CASCADE,
    storyboard_item_id VARCHAR(50) REFERENCES storyboard_items(item_id) ON DELETE CASCADE,
    tag_key VARCHAR(255) NOT NULL,
    scope VARCHAR(20) NOT NULL CHECK (scope IN ('project', 'shot')),
    asset_id VARCHAR(50) REFERENCES assets(asset_id) ON DELETE CASCADE,
    file_id VARCHAR(100) REFERENCES files(file_id) ON DELETE SET NULL,
    is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
    locked BOOLEAN NOT NULL DEFAULT FALSE,
    binding_version INTEGER NOT NULL DEFAULT 1,
    created_by VARCHAR(50) REFERENCES users(user_id) ON DELETE SET NULL,
    updated_by VARCHAR(50) REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (is_disabled OR asset_id IS NOT NULL),
    CHECK (
        (scope = 'project' AND storyboard_item_id IS NULL)
        OR (scope = 'shot' AND storyboard_item_id IS NOT NULL)
    )
);

ALTER TABLE content_bindings
    ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE content_bindings
    ALTER COLUMN asset_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_binding_project_default
    ON content_bindings(project_id, tag_key)
    WHERE scope = 'project';
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_binding_shot_override
    ON content_bindings(storyboard_item_id, tag_key)
    WHERE scope = 'shot';
CREATE INDEX IF NOT EXISTS idx_content_bindings_episode
    ON content_bindings(episode_id, storyboard_item_id, tag_key);


ALTER TABLE episode_script_versions
    ADD COLUMN IF NOT EXISTS base_version_id VARCHAR(100);
ALTER TABLE episode_script_versions
    ADD COLUMN IF NOT EXISTS patch JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE episode_script_versions
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP;
ALTER TABLE episode_script_versions
    ADD COLUMN IF NOT EXISTS confirmed_by VARCHAR(50);
ALTER TABLE episode_script_versions
    ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP;
ALTER TABLE episode_script_versions
    ADD COLUMN IF NOT EXISTS rejected_by VARCHAR(50);

DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'episode_script_versions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
    LIMIT 1;

    IF constraint_name IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE episode_script_versions DROP CONSTRAINT %I',
            constraint_name
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'episode_script_versions'::regclass
          AND conname = 'episode_script_versions_status_check'
    ) THEN
        ALTER TABLE episode_script_versions
            ADD CONSTRAINT episode_script_versions_status_check
            CHECK (status IN ('draft', 'ready', 'failed', 'rejected'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'episode_script_versions_base_version_fk'
    ) THEN
        ALTER TABLE episode_script_versions
            ADD CONSTRAINT episode_script_versions_base_version_fk
            FOREIGN KEY (base_version_id)
            REFERENCES episode_script_versions(version_id)
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_script_versions_base
    ON episode_script_versions(base_version_id);

-- Existing generated files become candidates without changing legacy selection.
INSERT INTO content_takes (
    take_id, user_id, project_id, episode_id,
    entity_type, entity_id, entity_lineage_id, slot,
    file_id, source_type, source_id, metadata, created_at, updated_at
)
SELECT
    'take_file_' || f.file_id,
    f.user_id,
    COALESCE(f.project_id, e.project_id),
    COALESCE(f.episode_id, si.episode_id),
    'storyboard_item',
    si.item_id,
    si.lineage_id,
    CASE f.file_role
        WHEN 'generated_image' THEN 'keyframe'
        WHEN 'dialogue_audio' THEN 'dialogue_audio'
        WHEN 'narration_audio' THEN 'narration_audio'
        WHEN 'sfx' THEN 'sfx_audio'
        WHEN 'mixed_audio' THEN 'mixed_audio'
        ELSE f.file_role
    END,
    f.file_id,
    COALESCE(NULLIF(f.source, ''), 'legacy_file'),
    f.file_id,
    jsonb_build_object('backfilled', true, 'legacyEntityType', f.entity_type),
    f.created_at,
    f.created_at
FROM files f
JOIN storyboard_items si
  ON f.entity_id = si.item_id
 AND f.entity_type IN ('storyboard', 'storyboard_item')
JOIN episodes e ON e.episode_id = si.episode_id
WHERE f.is_deleted = FALSE
  AND (
      f.file_role IN (
          'generated_image', 'dialogue_audio', 'narration_audio', 'sfx', 'mixed_audio'
      )
      OR f.file_role LIKE 'dialogue_audio:%'
      OR f.file_role LIKE 'narration_audio:%'
      OR f.file_role LIKE 'sfx:%'
  )
ON CONFLICT DO NOTHING;

INSERT INTO content_takes (
    take_id, user_id, project_id, episode_id,
    entity_type, entity_id, entity_lineage_id, slot,
    file_id, source_type, source_id, source_task_id,
    provider, model_name, generation_params, metadata, created_at, updated_at
)
SELECT
    'take_segment_' || vs.segment_id,
    f.user_id,
    e.project_id,
    vs.episode_id,
    'storyboard_item',
    si.item_id,
    si.lineage_id,
    'video',
    f.file_id,
    'video_segment',
    vs.segment_id,
    vs.task_id,
    NULL,
    vs.model,
    COALESCE(vs.input_params, '{}'::jsonb),
    jsonb_build_object('backfilled', true),
    COALESCE(f.created_at, vs.created_at),
    COALESCE(f.created_at, vs.created_at)
FROM video_segments vs
JOIN LATERAL (
    SELECT current_si.*
    FROM storyboard_items current_si
    WHERE current_si.episode_id = vs.episode_id
      AND (
          current_si.item_id = vs.storyboard_item_id
          OR (
              vs.storyboard_lineage_id IS NOT NULL
              AND current_si.lineage_id = vs.storyboard_lineage_id
          )
      )
    ORDER BY (current_si.item_id = vs.storyboard_item_id) DESC,
             current_si.updated_at DESC
    LIMIT 1
) si ON TRUE
JOIN episodes e ON e.episode_id = vs.episode_id
LEFT JOIN LATERAL (
    SELECT file_id, user_id, created_at
    FROM files
    WHERE entity_type = 'video_segment'
      AND entity_id = vs.segment_id
      AND file_type = 'video'
      AND is_deleted = FALSE
    ORDER BY is_selected DESC, created_at DESC
    LIMIT 1
) f ON TRUE
WHERE COALESCE(vs.video_url, '') <> '' OR f.file_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO content_selections (
    entity_type, entity_id, slot, selected_take_id, selected_by, selected_at
)
SELECT
    ct.entity_type,
    ct.entity_id,
    ct.slot,
    ct.take_id,
    ct.user_id,
    ct.created_at
FROM content_takes ct
JOIN files f ON f.file_id = ct.file_id
WHERE f.is_selected = TRUE
ON CONFLICT (entity_type, entity_id, slot) DO NOTHING;
