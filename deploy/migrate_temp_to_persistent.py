







import os
import sys
import shutil
import asyncio
import argparse
import json
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)


async def migrate_files(dry_run: bool = False):

    src_root = Path(current_dir) / 'temp' / 'uploads'
    dst_root = Path(current_dir) / 'persistent_storage'

    if not src_root.exists():
        logger.info(f"源目录不存在，无需迁移: {src_root}")
        return 0

    copied = 0
    skipped = 0

    for src_file in src_root.rglob('*'):
        if not src_file.is_file():
            continue

        relative = src_file.relative_to(src_root)
        dst_file = dst_root / relative

        if dst_file.exists():
            skipped += 1
            continue

        if dry_run:
            logger.info(f"[DRY-RUN] 复制: {src_file} -> {dst_file}")
        else:
            dst_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(src_file), str(dst_file))
            logger.info(f"已复制: {relative}")
        copied += 1

    logger.info(f"文件迁移: 复制 {copied} 个, 跳过 {skipped} 个 (已存在)")
    return copied


async def update_database_urls(dry_run: bool = False):

    try:
        import asyncpg
        from database_config import DatabaseConfig
    except ImportError:
        logger.error("需要 asyncpg 和 database_config 模块")
        return

    conn = await asyncpg.connect(DatabaseConfig.get_connection_string())

    try:

        if dry_run:
            count = await conn.fetchval(
                "SELECT COUNT(*) FROM files WHERE file_url LIKE '/uploads/%'"
            )
            logger.info(f"[DRY-RUN] files.file_url: {count} 条记录需更新")
        else:
            result = await conn.execute(
                "UPDATE files SET file_url = REPLACE(file_url, '/uploads/', '/storage/') "
                "WHERE file_url LIKE '/uploads/%'"
            )
            logger.info(f"files.file_url: {result}")


        if dry_run:
            count = await conn.fetchval(
                "SELECT COUNT(*) FROM files WHERE file_path LIKE 'temp/uploads/%'"
            )
            logger.info(f"[DRY-RUN] files.file_path: {count} 条记录需更新")
        else:
            result = await conn.execute(
                "UPDATE files SET file_path = REPLACE(file_path, 'temp/uploads/', 'persistent_storage/') "
                "WHERE file_path LIKE 'temp/uploads/%'"
            )
            logger.info(f"files.file_path: {result}")


        if dry_run:
            count = await conn.fetchval(
                "SELECT COUNT(*) FROM tasks WHERE result_data::text LIKE '%/uploads/%'"
            )
            logger.info(f"[DRY-RUN] tasks.result_data: {count} 条记录需更新")
        else:
            result = await conn.execute("""
                UPDATE tasks
                SET result_data = REPLACE(result_data::text, '/uploads/', '/storage/')::jsonb
                WHERE result_data::text LIKE '%/uploads/%'
            """)
            logger.info(f"tasks.result_data: {result}")


        if dry_run:
            count = await conn.fetchval(
                "SELECT COUNT(*) FROM system_configs WHERE config_value::text LIKE '%/uploads/%'"
            )
            logger.info(f"[DRY-RUN] system_configs: {count} 条记录需更新")
        else:
            result = await conn.execute("""
                UPDATE system_configs
                SET config_value = REPLACE(config_value::text, '/uploads/', '/storage/')::jsonb
                WHERE config_value::text LIKE '%/uploads/%'
            """)
            logger.info(f"system_configs: {result}")

        logger.info("数据库URL更新完成")

    finally:
        await conn.close()


async def main():
    parser = argparse.ArgumentParser(description='迁移 temp/uploads 到 persistent_storage')
    parser.add_argument('--dry-run', action='store_true', help='预览变更，不实际执行')
    args = parser.parse_args()

    if args.dry_run:
        logger.info("=" * 50)
        logger.info("DRY-RUN 模式：仅预览变更，不实际执行")
        logger.info("=" * 50)
    else:
        logger.info("=" * 50)
        logger.info("开始迁移（建议先备份数据库和文件）")
        logger.info("=" * 50)


    logger.info("\n--- 步骤1: 迁移文件 ---")
    await migrate_files(args.dry_run)


    logger.info("\n--- 步骤2: 更新数据库URL ---")
    await update_database_urls(args.dry_run)

    if args.dry_run:
        logger.info("\n✅ DRY-RUN 完成。使用不带 --dry-run 的命令来实际执行迁移。")
    else:
        logger.info("\n✅ 迁移完成！")
        logger.info("旧文件仍保留在 temp/uploads/，确认无问题后可手动删除。")


if __name__ == '__main__':
    asyncio.run(main())
