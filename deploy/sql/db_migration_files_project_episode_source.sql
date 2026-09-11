-- Add ownership columns to files for clean storage migration.
-- Safe to run multiple times. Columns stay nullable until dirty data is cleaned.

ALTER TABLE files ADD COLUMN IF NOT EXISTS project_id VARCHAR(50);
ALTER TABLE files ADD COLUMN IF NOT EXISTS episode_id VARCHAR(50);
ALTER TABLE files ADD COLUMN IF NOT EXISTS source VARCHAR(80);

CREATE INDEX IF NOT EXISTS idx_files_project_id
    ON files(project_id)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_files_episode_id
    ON files(episode_id)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_files_project_episode
    ON files(project_id, episode_id)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_files_source
    ON files(source)
    WHERE is_deleted = FALSE;

-- Prefer explicit metadata already written by recent code.
UPDATE files
SET
    project_id = COALESCE(project_id, NULLIF(metadata->>'project_id', '')),
    episode_id = COALESCE(episode_id, NULLIF(metadata->>'episode_id', '')),
    source = COALESCE(source, NULLIF(metadata->>'source', ''), NULLIF(metadata->>'provider', ''))
WHERE metadata IS NOT NULL;

-- Version-scoped files can recover project ownership from versions.
UPDATE files f
SET project_id = COALESCE(f.project_id, v.project_id)
FROM versions v
WHERE f.version_id = v.version_id
  AND f.project_id IS NULL;

-- Media library is the richest existing index for assets.
DO $do$
BEGIN
    IF to_regclass('public.media_library_items') IS NOT NULL THEN
        EXECUTE $sql$
            UPDATE files f
            SET
                project_id = COALESCE(f.project_id, m.project_id),
                episode_id = COALESCE(f.episode_id, m.episode_id),
                source = COALESCE(f.source, m.source)
            FROM media_library_items m
            WHERE f.file_id = m.file_id
              AND COALESCE(m.is_deleted, FALSE) = FALSE
        $sql$;
    END IF;
END
$do$;

-- Entity-linked storyboard files.
DO $do$
BEGIN
    IF to_regclass('public.storyboard_items') IS NOT NULL
       AND to_regclass('public.episodes') IS NOT NULL THEN
        EXECUTE $sql$
            UPDATE files f
            SET
                project_id = COALESCE(f.project_id, e.project_id),
                episode_id = COALESCE(f.episode_id, si.episode_id),
                source = COALESCE(f.source, f.file_role, 'storyboard_file')
            FROM storyboard_items si
            LEFT JOIN episodes e ON e.episode_id = si.episode_id
            WHERE f.entity_type = 'storyboard_item'
              AND f.entity_id = si.item_id
        $sql$;
    END IF;
END
$do$;

-- Entity-linked asset files.
DO $do$
BEGIN
    IF to_regclass('public.assets') IS NOT NULL THEN
        EXECUTE $sql$
            UPDATE files f
            SET
                project_id = COALESCE(f.project_id, a.project_id),
                episode_id = COALESCE(f.episode_id, a.episode_id),
                source = COALESCE(f.source, f.file_role, 'asset_file')
            FROM assets a
            WHERE f.entity_type = 'asset'
              AND f.entity_id = a.asset_id
        $sql$;
    END IF;
END
$do$;

-- Entity-linked video segment files.
DO $do$
BEGIN
    IF to_regclass('public.video_segments') IS NOT NULL
       AND to_regclass('public.episodes') IS NOT NULL THEN
        EXECUTE $sql$
            UPDATE files f
            SET
                project_id = COALESCE(f.project_id, e.project_id),
                episode_id = COALESCE(f.episode_id, vs.episode_id),
                source = COALESCE(f.source, f.file_role, 'video_segment_file')
            FROM video_segments vs
            LEFT JOIN episodes e ON e.episode_id = vs.episode_id
            WHERE f.entity_type = 'video_segment'
              AND f.entity_id = vs.segment_id
        $sql$;
    END IF;
END
$do$;

-- Episode-level files.
DO $do$
BEGIN
    IF to_regclass('public.episodes') IS NOT NULL THEN
        EXECUTE $sql$
            UPDATE files f
            SET
                project_id = COALESCE(f.project_id, e.project_id),
                episode_id = COALESCE(f.episode_id, e.episode_id),
                source = COALESCE(f.source, f.file_role, 'episode_file')
            FROM episodes e
            WHERE f.entity_type = 'episode'
              AND f.entity_id = e.episode_id
        $sql$;
    END IF;
END
$do$;

-- Canvas files can at least recover project ownership.
DO $do$
BEGIN
    IF to_regclass('public.canvas_nodes') IS NOT NULL
       AND to_regclass('public.canvas_boards') IS NOT NULL THEN
        EXECUTE $sql$
            UPDATE files f
            SET
                project_id = COALESCE(f.project_id, cb.project_id),
                source = COALESCE(f.source, f.file_role, 'canvas_file')
            FROM canvas_nodes cn
            JOIN canvas_boards cb ON cb.board_id = cn.board_id
            WHERE f.entity_type = 'canvas_node'
              AND f.entity_id = cn.node_id
        $sql$;
    END IF;
END
$do$;

-- Keep source useful even when ownership is still unresolved.
UPDATE files
SET source = COALESCE(source, file_role, metadata->>'provider', 'unknown')
WHERE source IS NULL;
