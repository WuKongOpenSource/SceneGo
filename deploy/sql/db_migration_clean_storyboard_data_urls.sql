


















BEGIN;


DO $$
DECLARE
    v_data_count INT;
    v_blob_count INT;
BEGIN
    SELECT COUNT(*) INTO v_data_count
    FROM storyboard_items
    WHERE generated_image_url LIKE 'data:%';

    SELECT COUNT(*) INTO v_blob_count
    FROM storyboard_items
    WHERE generated_image_url LIKE 'blob:%';

    RAISE NOTICE '[clean_storyboard_data_urls] data: URL 行数 = %, blob: URL 行数 = %',
                 v_data_count, v_blob_count;
END $$;


UPDATE storyboard_items
SET generated_image_url = NULL,
    updated_at = NOW()
WHERE generated_image_url LIKE 'data:%';


UPDATE storyboard_items
SET generated_image_url = NULL,
    updated_at = NOW()
WHERE generated_image_url LIKE 'blob:%';


DO $$
DECLARE
    v_remaining INT;
BEGIN
    SELECT COUNT(*) INTO v_remaining
    FROM storyboard_items
    WHERE generated_image_url LIKE 'data:%'
       OR generated_image_url LIKE 'blob:%';

    IF v_remaining > 0 THEN
        RAISE EXCEPTION '[clean_storyboard_data_urls] 清理后仍有 % 行残留，事务回滚', v_remaining;
    END IF;

    RAISE NOTICE '[clean_storyboard_data_urls] ✅ 清理完成，残留 = 0';
END $$;

COMMIT;
