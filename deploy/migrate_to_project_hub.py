









import asyncio
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


async def migrate():
    from db_manager import init_db_manager, get_db_manager

    db_manager = await init_db_manager()
    db = get_db_manager()

    logger.info("=== 开始迁移 ===")


    migration_sql = os.path.join(os.path.dirname(__file__), 'db_migration_project_hub.sql')
    if os.path.exists(migration_sql):
        logger.info("执行 SQL 迁移脚本...")
        with open(migration_sql, 'r', encoding='utf-8') as f:
            sql = f.read()

        for stmt in sql.split(';'):
            stmt = stmt.strip()
            if stmt and not stmt.startswith('--'):
                try:
                    await db.execute(stmt)
                except Exception as e:

                    if 'already exists' in str(e) or 'duplicate' in str(e).lower():
                        logger.debug(f"跳过已存在: {e}")
                    else:
                        logger.warning(f"SQL 执行警告: {e}")
        logger.info("SQL 迁移完成")
    else:
        logger.warning(f"迁移脚本不存在: {migration_sql}")


    member_count = await db.fetchval("SELECT COUNT(*) FROM project_members")
    project_count = await db.fetchval("SELECT COUNT(*) FROM projects")
    logger.info(f"项目总数: {project_count}")
    logger.info(f"成员记录总数: {member_count}")


    orphans = await db.fetch("""
        SELECT p.project_id, p.user_id, p.project_name
        FROM projects p
        LEFT JOIN project_members pm ON p.project_id = pm.project_id AND p.user_id = pm.user_id
        WHERE pm.id IS NULL
    """)
    if orphans:
        logger.info(f"发现 {len(orphans)} 个项目缺少 owner 成员记录，正在补充...")
        for row in orphans:
            await db.execute("""
                INSERT INTO project_members (project_id, user_id, role, responsibility)
                VALUES ($1, $2, 'owner', 'all')
                ON CONFLICT (project_id, user_id) DO NOTHING
            """, row['project_id'], row['user_id'])
            logger.info(f"  + {row['project_name']} ({row['project_id']}) → owner: {row['user_id']}")
    else:
        logger.info("所有项目都已有 owner 成员记录")

    logger.info("=== 迁移完成 ===")
    await db_manager.close()


if __name__ == '__main__':
    asyncio.run(migrate())
