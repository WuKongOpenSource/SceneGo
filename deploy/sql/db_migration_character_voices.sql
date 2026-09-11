-- db_migration_character_voices.sql







CREATE TABLE IF NOT EXISTS character_voices (
    id SERIAL PRIMARY KEY,
    voice_id UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
    project_id VARCHAR(50) NOT NULL,
    asset_id VARCHAR(50),
    character_name VARCHAR(200) NOT NULL,
    voice_provider VARCHAR(50),
    voice_model_id VARCHAR(200),
    voice_name VARCHAR(200),
    voice_params JSONB DEFAULT '{}',
    sample_audio_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT fk_cv_project FOREIGN KEY (project_id)
        REFERENCES projects(project_id) ON DELETE CASCADE,
    CONSTRAINT fk_cv_asset FOREIGN KEY (asset_id)
        REFERENCES assets(asset_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_character_voices_project ON character_voices(project_id);
CREATE INDEX IF NOT EXISTS idx_character_voices_asset ON character_voices(asset_id);



DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'character_voices'
          AND column_name = 'project_id'
          AND data_type = 'uuid'
    ) THEN
        ALTER TABLE character_voices DROP CONSTRAINT IF EXISTS fk_cv_project;
        ALTER TABLE character_voices DROP CONSTRAINT IF EXISTS fk_cv_asset;
        ALTER TABLE character_voices
            ALTER COLUMN project_id TYPE VARCHAR(50) USING project_id::text,
            ALTER COLUMN asset_id   TYPE VARCHAR(50) USING asset_id::text;
        ALTER TABLE character_voices
            ADD CONSTRAINT fk_cv_project FOREIGN KEY (project_id)
                REFERENCES projects(project_id) ON DELETE CASCADE,
            ADD CONSTRAINT fk_cv_asset FOREIGN KEY (asset_id)
                REFERENCES assets(asset_id) ON DELETE SET NULL;
        RAISE NOTICE 'character_voices: project_id/asset_id 已从 UUID 修正为 VARCHAR(50)';
    END IF;
END $$;





ALTER TABLE character_voices OWNER TO CURRENT_USER;
ALTER SEQUENCE character_voices_id_seq OWNER TO CURRENT_USER;
GRANT ALL PRIVILEGES ON TABLE character_voices TO CURRENT_USER;
GRANT ALL PRIVILEGES ON SEQUENCE character_voices_id_seq TO CURRENT_USER;
