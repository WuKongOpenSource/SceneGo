#!/usr/bin/env python3





import asyncio
import logging
from db_manager import get_db_manager, init_db_manager
from dao_user import UserDAO

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DEFAULT_PERMISSIONS = {
    "allowedModels": [
        "gemini-2.5-flash",
        "gemini-2.5-flash-image",
        "wan2-i2v",
        "wan2-morph",
        "sora2-i2v",
        "veo-i2v",
        "minimax-i2v"
    ],
    "priority": "normal",
    "canExport": True
}

async def main():

    logger.info("开始用户权限初始化...")

    try:

        await init_db_manager()
        db = get_db_manager()


        logger.info("检查permissions字段...")
        await db.execute("""
            ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb
        """)
        logger.info("✅ permissions字段已就绪")


        users = await db.fetch("""
            SELECT user_id, username, permissions
            FROM users
            WHERE is_active = TRUE
        """)
        logger.info(f"找到 {len(users)} 个活跃用户")


        updated_count = 0
        for user in users:
            user_id = user['user_id']
            username = user['username']
            permissions = user['permissions']


            if not permissions or permissions == {} or not permissions.get('allowedModels'):
                logger.info(f"为用户 {username} ({user_id}) 设置默认权限...")
                success = await UserDAO.update_user_permissions(user_id, DEFAULT_PERMISSIONS)
                if success:
                    updated_count += 1
                    logger.info(f"✅ 用户 {username} 权限已更新")
                else:
                    logger.warning(f"⚠️ 用户 {username} 权限更新失败")
            else:
                logger.info(f"用户 {username} ({user_id}) 已有权限配置，跳过")

        logger.info(f"✅ 权限初始化完成：已更新 {updated_count} 个用户")


        logger.info("\n验证结果：")
        users_after = await db.fetch("""
            SELECT user_id, username, permissions
            FROM users
            WHERE is_active = TRUE
            LIMIT 10
        """)
        for user in users_after:
            perms = user['permissions']
            if isinstance(perms, dict):
                models = perms.get('allowedModels', [])
                logger.info(f"  {user['username']}: {len(models)} 个可用模型")
            else:
                logger.warning(f"  {user['username']}: 权限格式异常 ({type(perms)})")

    except Exception as e:
        logger.error(f"❌ 权限初始化失败: {e}", exc_info=True)
        return 1

    return 0

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    exit(exit_code)
