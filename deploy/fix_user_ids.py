#!/usr/bin/env python3





import asyncio
import logging
from db_manager import get_db_manager, init_db_manager

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

async def fix_user_ids():

    try:
        await init_db_manager()
        db = get_db_manager()
        logger.info("✅ 数据库连接成功")


        users_to_fix = await db.fetch("""
            SELECT id, user_id, username
            FROM users
            WHERE user_id != username
        """)

        if not users_to_fix:
            logger.info("✅ 所有用户的user_id已与username一致，无需修复")
            return 0

        logger.info(f"🔍 发现 {len(users_to_fix)} 个需要修复的用户：")
        for user in users_to_fix:
            logger.info(f"  {user['username']}: {user['user_id']} -> {user['username']}")


        fixed_count = 0
        for user in users_to_fix:
            old_user_id = user['user_id']
            new_user_id = user['username']
            username = user['username']

            logger.info(f"\n🔧 修复用户: {username}")
            logger.info(f"  旧user_id: {old_user_id}")
            logger.info(f"  新user_id: {new_user_id}")

            try:

                async with db.pool.acquire() as conn:
                    async with conn.transaction():

                        result = await conn.execute("""
                            UPDATE projects
                            SET user_id = $1
                            WHERE user_id = $2
                        """, new_user_id, old_user_id)
                        projects_count = int(result.split()[-1]) if result else 0
                        logger.info(f"  ✅ 更新了 {projects_count} 个项目")


                        result = await conn.execute("""
                            UPDATE versions
                            SET user_id = $1
                            WHERE user_id = $2
                        """, new_user_id, old_user_id)
                        versions_count = int(result.split()[-1]) if result else 0
                        logger.info(f"  ✅ 更新了 {versions_count} 个版本")


                        result = await conn.execute("""
                            UPDATE files
                            SET user_id = $1
                            WHERE user_id = $2
                        """, new_user_id, old_user_id)
                        files_count = int(result.split()[-1]) if result else 0
                        logger.info(f"  ✅ 更新了 {files_count} 个文件")


                        result = await conn.execute("""
                            UPDATE text_contents
                            SET user_id = $1
                            WHERE user_id = $2
                        """, new_user_id, old_user_id)
                        text_count = int(result.split()[-1]) if result else 0
                        logger.info(f"  ✅ 更新了 {text_count} 个文本内容")


                        result = await conn.execute("""
                            UPDATE tasks
                            SET user_id = $1
                            WHERE user_id = $2
                        """, new_user_id, old_user_id)
                        tasks_count = int(result.split()[-1]) if result else 0
                        logger.info(f"  ✅ 更新了 {tasks_count} 个任务")


                        result = await conn.execute("""
                            UPDATE activity_logs
                            SET user_id = $1
                            WHERE user_id = $2
                        """, new_user_id, old_user_id)
                        logs_count = int(result.split()[-1]) if result else 0
                        logger.info(f"  ✅ 更新了 {logs_count} 条活动日志")


                        result = await conn.execute("""
                            UPDATE users
                            SET user_id = $1
                            WHERE user_id = $2
                        """, new_user_id, old_user_id)
                        logger.info(f"  ✅ 更新了users表的user_id")

                fixed_count += 1
                logger.info(f"  ✅ 用户 {username} 修复完成！")

            except Exception as e:
                logger.error(f"  ❌ 修复用户 {username} 失败: {e}", exc_info=True)

        logger.info(f"\n✅ 修复完成：成功修复 {fixed_count}/{len(users_to_fix)} 个用户")


        logger.info("\n📋 验证结果：")
        all_users = await db.fetch("""
            SELECT user_id, username
            FROM users
            ORDER BY username
        """)

        inconsistent = 0
        for user in all_users:
            if user['user_id'] == user['username']:
                logger.info(f"  ✅ {user['username']}: user_id一致")
            else:
                logger.error(f"  ❌ {user['username']}: user_id={user['user_id']} (不一致)")
                inconsistent += 1

        if inconsistent == 0:
            logger.info("\n🎉 所有用户的user_id已与username完全一致！")
            return 0
        else:
            logger.error(f"\n⚠️ 还有 {inconsistent} 个用户的user_id不一致")
            return 1

    except Exception as e:
        logger.error(f"❌ 修复失败: {e}", exc_info=True)
        return 1

if __name__ == "__main__":
    exit_code = asyncio.run(fix_user_ids())
    exit(exit_code)
