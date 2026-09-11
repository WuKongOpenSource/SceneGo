-- Canonical source identity for imported/generated script candidates.
ALTER TABLE episode_scripts
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS source_id VARCHAR(100);

-- Preserve one canonical row for historical video-reverse candidates without
-- deleting any user-created duplicate scripts.
WITH ranked_sources AS (
    SELECT
        script_id,
        NULLIF(metadata->>'source_type', '') AS source_type,
        NULLIF(
            COALESCE(metadata->>'source_id', metadata->>'source_reverse_task_id'),
            ''
        ) AS source_id,
        ROW_NUMBER() OVER (
            PARTITION BY
                episode_id,
                NULLIF(metadata->>'source_type', ''),
                NULLIF(COALESCE(metadata->>'source_id', metadata->>'source_reverse_task_id'), '')
            ORDER BY created_at, script_id
        ) AS source_rank
    FROM episode_scripts
    WHERE NULLIF(metadata->>'source_type', '') IS NOT NULL
      AND NULLIF(COALESCE(metadata->>'source_id', metadata->>'source_reverse_task_id'), '') IS NOT NULL
)
UPDATE episode_scripts AS scripts
SET source_type = ranked_sources.source_type,
    source_id = ranked_sources.source_id
FROM ranked_sources
WHERE scripts.script_id = ranked_sources.script_id
  AND ranked_sources.source_rank = 1
  AND (scripts.source_type IS NULL OR scripts.source_id IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_episode_scripts_source
    ON episode_scripts (episode_id, source_type, source_id)
    WHERE source_type IS NOT NULL
      AND source_id IS NOT NULL
      AND source_id <> '';
