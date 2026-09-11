

BEGIN;


DELETE FROM media_library_items WHERE user_id='Yuan' AND source='recovered';


INSERT INTO episodes (episode_id, project_id, episode_number, episode_name, status)
  VALUES ('ep_recover_wukong_2','proj_recover_wukong',2,'恢复-第二集','draft')
  ON CONFLICT (episode_id) DO NOTHING;
UPDATE episodes SET episode_name='恢复-第一集' WHERE episode_id='ep_recover_wukong';


INSERT INTO media_library_items (library_item_id, file_id, user_id, item_type, source, title, created_at)
SELECT 'mli_'||substr(md5(f.file_id),1,12), f.file_id, 'Yuan', f.file_type,
       COALESCE(f.metadata->>'source','generated'), COALESCE(f.file_name,f.file_type), f.created_at
FROM files f
WHERE f.user_id='Yuan' AND f.file_type IN ('video','image','audio') AND f.is_deleted IS NOT TRUE
  AND NOT EXISTS (SELECT 1 FROM media_library_items m WHERE m.file_id=f.file_id AND m.user_id='Yuan')
ON CONFLICT (library_item_id) DO NOTHING;


WITH ranked AS (
  SELECT library_item_id, NTILE(2) OVER (PARTITION BY item_type ORDER BY created_at) AS grp
  FROM media_library_items
  WHERE user_id='Yuan' AND item_type IN ('video','image','audio')
)
UPDATE media_library_items m
SET project_id='proj_recover_wukong',
    episode_id = CASE r.grp WHEN 1 THEN 'ep_recover_wukong' ELSE 'ep_recover_wukong_2' END
FROM ranked r WHERE m.library_item_id = r.library_item_id;


DELETE FROM video_segments WHERE episode_id IN ('ep_recover_wukong','ep_recover_wukong_2');
WITH vids AS (
  SELECT file_id, file_url,
         NTILE(2) OVER (ORDER BY created_at) AS grp,
         row_number() OVER (ORDER BY created_at) AS rn
  FROM files WHERE user_id='Yuan' AND file_type='video' AND is_deleted IS NOT TRUE
)
INSERT INTO video_segments (segment_id, episode_id, sort_order, video_url)
SELECT 'seg_'||substr(md5(file_id),1,12),
       CASE grp WHEN 1 THEN 'ep_recover_wukong' ELSE 'ep_recover_wukong_2' END,
       rn::int, file_url
FROM vids
ON CONFLICT (segment_id) DO NOTHING;

COMMIT;


SELECT '视频段/集' AS what, episode_id, count(*) FROM video_segments
  WHERE episode_id IN ('ep_recover_wukong','ep_recover_wukong_2') GROUP BY episode_id ORDER BY episode_id;
SELECT '素材/集/类型' AS what, episode_id, item_type, count(*) FROM media_library_items
  WHERE user_id='Yuan' AND project_id='proj_recover_wukong' GROUP BY episode_id, item_type ORDER BY episode_id, item_type;
