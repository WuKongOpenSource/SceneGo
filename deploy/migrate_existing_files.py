





import asyncio
import json
import uuid
import logging
from db_manager import get_db_manager

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


async def migrate_storyboard_items():
    db = get_db_manager()
    items = await db.fetch(
        "SELECT item_id, generated_image_url, dialogue_audio_url, "
        "narration_audio_url, sfx_audio_url FROM storyboard_items"
    )
    migrated = 0
    for item in items:
        item_id = item['item_id']
        fields = [
            ('generated_image_url', 'generated_image', 'image'),
            ('dialogue_audio_url', 'dialogue_audio', 'audio'),
            ('narration_audio_url', 'narration_audio', 'audio'),
            ('sfx_audio_url', 'sfx', 'audio'),
        ]
        for col, role, ftype in fields:
            url = item.get(col)
            if not url or url.startswith('data:'):
                continue
            ok = await _link_url_to_entity(
                url, 'storyboard_item', item_id, role, ftype
            )
            if ok:
                migrated += 1
    logger.info(f"storyboard_items: migrated {migrated} URLs")


async def migrate_assets():
    db = get_db_manager()
    assets = await db.fetch(
        "SELECT asset_id, thumbnail_url, reference_images FROM assets"
    )
    migrated = 0
    for asset in assets:
        aid = asset['asset_id']
        thumb = asset.get('thumbnail_url')
        if thumb and not thumb.startswith('data:'):
            ok = await _link_url_to_entity(
                thumb, 'asset', aid, 'asset_thumbnail', 'image'
            )
            if ok:
                migrated += 1

        refs = asset.get('reference_images')
        if isinstance(refs, str):
            try:
                refs = json.loads(refs)
            except Exception:
                refs = []
        if isinstance(refs, list):
            for i, url in enumerate(refs):
                if not url or (isinstance(url, str) and url.startswith('data:')):
                    continue
                actual_url = url if isinstance(url, str) else url.get('url', '') if isinstance(url, dict) else ''
                if not actual_url:
                    continue
                ok = await _link_url_to_entity(
                    actual_url, 'asset', aid, 'reference_image', 'image',
                    is_selected=(i == 0),
                )
                if ok:
                    migrated += 1
    logger.info(f"assets: migrated {migrated} URLs")


async def migrate_video_segments():
    db = get_db_manager()
    segs = await db.fetch(
        "SELECT segment_id, video_url, thumbnail_url FROM video_segments"
    )
    migrated = 0
    for seg in segs:
        sid = seg['segment_id']
        for col, role, ftype in [
            ('video_url', 'video', 'video'),
            ('thumbnail_url', 'video_thumbnail', 'image'),
        ]:
            url = seg.get(col)
            if not url:
                continue
            ok = await _link_url_to_entity(url, 'video_segment', sid, role, ftype)
            if ok:
                migrated += 1
    logger.info(f"video_segments: migrated {migrated} URLs")


async def _link_url_to_entity(
    url: str, entity_type: str, entity_id: str,
    file_role: str, file_type: str, is_selected: bool = True,
) -> bool:
    db = get_db_manager()
    clean_url = url.split('?')[0]

    row = await db.fetchrow(
        """SELECT file_id FROM files
           WHERE split_part(file_url, '?', 1) = $1
             AND is_deleted = FALSE
           ORDER BY created_at DESC LIMIT 1""",
        clean_url,
    )
    if row:
        await db.execute(
            """UPDATE files
               SET entity_type = $2, entity_id = $3,
                   file_role = $4, is_selected = $5
               WHERE file_id = $1""",
            row['file_id'], entity_type, entity_id, file_role, is_selected,
        )
        return True

    parts = clean_url.strip('/').split('/')
    real_user_id = parts[2] if len(parts) > 3 else None

    if not real_user_id:
        owner = None
        if entity_type == 'storyboard_item':
            owner = await db.fetchval(
                """SELECT p.user_id FROM storyboard_items si
                   JOIN episodes e ON si.episode_id = e.episode_id
                   JOIN projects p ON e.project_id = p.project_id
                   WHERE si.item_id = $1""",
                entity_id,
            )
        elif entity_type == 'asset':
            owner = await db.fetchval(
                """SELECT p.user_id FROM assets a
                   JOIN episodes e ON a.episode_id = e.episode_id
                   JOIN projects p ON e.project_id = p.project_id
                   WHERE a.asset_id = $1""",
                entity_id,
            )
        elif entity_type == 'video_segment':
            owner = await db.fetchval(
                """SELECT p.user_id FROM video_segments vs
                   JOIN episodes e ON vs.episode_id = e.episode_id
                   JOIN projects p ON e.project_id = p.project_id
                   WHERE vs.segment_id = $1""",
                entity_id,
            )
        if not owner:
            logger.warning(f"无法确定文件所属用户, 跳过: {url} -> {entity_type}/{entity_id}")
            return False
        real_user_id = owner

    fid = f"file_{uuid.uuid4().hex[:12]}"
    await db.execute(
        """INSERT INTO files (file_id, user_id, file_type, file_name,
              file_path, file_url, entity_type, entity_id, file_role, is_selected)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)""",
        fid, real_user_id, file_type, clean_url.split('/')[-1], clean_url, url,
        entity_type, entity_id, file_role, is_selected,
    )
    return True


async def recover_orphan_files():





    db = get_db_manager()
    if not db:
        logger.error("DB not available")
        return 0

    orphans = await db.fetch("""
        SELECT file_id, file_url, metadata
        FROM files
        WHERE (entity_type IS NULL OR entity_type = '')
          AND is_deleted = FALSE
          AND metadata IS NOT NULL
    """)
    logger.info(f"找到 {len(orphans)} 个无 entity 关联的文件")

    recovered = 0
    for orphan in orphans:
        meta = orphan['metadata']
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                continue
        task_id = meta.get('task_id') if isinstance(meta, dict) else None
        if not task_id:
            continue


        sibling = await db.fetchrow("""
            SELECT entity_type, entity_id, file_role
            FROM files
            WHERE metadata::text LIKE $1
              AND entity_type IS NOT NULL AND entity_type != ''
              AND is_deleted = FALSE
            LIMIT 1
        """, f'%"task_id": "{task_id}"%')

        if sibling:
            await db.execute("""
                UPDATE files
                SET entity_type = $2, entity_id = $3, file_role = $4
                WHERE file_id = $1
            """, orphan['file_id'], sibling['entity_type'],
                sibling['entity_id'], sibling['file_role'])
            recovered += 1
            logger.info(f"✅ 恢复: {orphan['file_id']} -> {sibling['entity_type']}/{sibling['entity_id']}")


    still_orphans = await db.fetch("""
        SELECT f.file_id, f.file_url, f.metadata
        FROM files f
        WHERE (f.entity_type IS NULL OR f.entity_type = '')
          AND f.is_deleted = FALSE
          AND f.metadata IS NOT NULL
    """)
    for orphan in still_orphans:
        meta = orphan['metadata']
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                continue
        task_id = meta.get('task_id') if isinstance(meta, dict) else None
        if not task_id:
            continue


        match = await db.fetchrow("""
            SELECT si.item_id
            FROM storyboard_items si
            JOIN files f ON split_part(f.file_url, '?', 1) = split_part(si.generated_image_url, '?', 1)
            WHERE f.metadata::text LIKE $1
              AND f.is_deleted = FALSE
              AND si.generated_image_url IS NOT NULL
            LIMIT 1
        """, f'%"task_id": "{task_id}"%')

        if match:
            await db.execute("""
                UPDATE files
                SET entity_type = 'storyboard_item', entity_id = $2,
                    file_role = 'generated_image'
                WHERE file_id = $1
            """, orphan['file_id'], match['item_id'])
            recovered += 1
            logger.info(f"✅ URL匹配恢复: {orphan['file_id']} -> storyboard_item/{match['item_id']}")

    logger.info(f"=== 孤儿文件恢复完成: {recovered} 个 ===")
    return recovered


async def main():
    logger.info("=== 开始迁移现有文件到统一 entity files ===")
    await migrate_storyboard_items()
    await migrate_assets()
    await migrate_video_segments()
    r = await recover_orphan_files()
    logger.info(f"=== 迁移完成 (恢复孤儿: {r}) ===")


if __name__ == "__main__":
    asyncio.run(main())
