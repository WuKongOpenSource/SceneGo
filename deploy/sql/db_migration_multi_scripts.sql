



ALTER TABLE episode_scripts DROP CONSTRAINT IF EXISTS episode_scripts_episode_id_key;


ALTER TABLE episode_scripts ADD COLUMN IF NOT EXISTS file_name VARCHAR(255) DEFAULT '未命名文件';
ALTER TABLE episode_scripts ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;


UPDATE episode_scripts SET file_name = '分集剧本' WHERE file_name = '未命名文件' OR file_name IS NULL;


CREATE INDEX IF NOT EXISTS idx_episode_scripts_episode_sort ON episode_scripts(episode_id, sort_order);
