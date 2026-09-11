#!/usr/bin/env python3




import asyncio
import logging
import json
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

async def diagnose_and_fix():

    try:

        await init_db_manager()
        db = get_db_manager()
        logger.info("✅ 数据库连接成功")


        await db.execute("""
            ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb
        """)
        logger.info("✅ permissions字段已就绪")


        logger.info("\n📊 当前用户权限状态：")
        users = await db.fetch("""
            SELECT
                user_id,
                username,
                permissions,
                pg_typeof(permissions) as perm_type
            FROM users
            ORDER BY created_at DESC
        """)

        need_fix = []
        for user in users:
            user_id = user['user_id']
            username = user['username']
            perms = user['permissions']
            perm_type = user['perm_type']

            logger.info(f"\n用户: {username} ({user_id})")
            logger.info(f"  原始类型: {perm_type}")
            logger.info(f"  Python类型: {type(perms).__name__}")
            logger.info(f"  原始值: {perms}")


            is_valid = False
            if isinstance(perms, dict):
                if perms.get('allowedModels') and len(perms.get('allowedModels', [])) > 0:
                    is_valid = True
                    logger.info(f"  ✅ 权限有效: {len(perms['allowedModels'])} 个模型")
                else:
                    logger.info(f"  ⚠️ 权限字典为空或缺少allowedModels")
            elif isinstance(perms, str):
                try:
                    parsed = json.loads(perms)
                    if parsed.get('allowedModels'):
                        is_valid = True
                        logger.info(f"  ✅ 权限有效（字符串格式）: {len(parsed['allowedModels'])} 个模型")
                    else:
                        logger.info(f"  ⚠️ JSON字符串解析后为空")
                except:
                    logger.info(f"  ❌ JSON解析失败")
            else:
                logger.info(f"  ❌ 权限类型异常: {type(perms)}")

            if not is_valid:
                need_fix.append((user_id, username))


        if need_fix:
            logger.info(f"\n🔧 需要修复 {len(need_fix)} 个用户的权限：")
            for user_id, username in need_fix:
                logger.info(f"  修复用户: {username} ({user_id})")


                await db.execute("""
                    UPDATE users
                    SET permissions = $1::jsonb
                    WHERE user_id = $2
                """, json.dumps(DEFAULT_PERMISSIONS), user_id)


                row = await db.fetchrow("""
                    SELECT permissions FROM users WHERE user_id = $1
                """, user_id)

                if row:
                    updated_perms = row['permissions']
                    logger.info(f"    更新后类型: {type(updated_perms).__name__}")
                    if isinstance(updated_perms, dict) and updated_perms.get('allowedModels'):
                        logger.info(f"    ✅ 修复成功: {len(updated_perms['allowedModels'])} 个模型")
                    else:
                        logger.error(f"    ❌ 修复失败: {updated_perms}")
        else:
            logger.info("\n✅ 所有用户权限配置正常")


        logger.info("\n📋 最终权限状态：")
        final_users = await db.fetch("""
            SELECT
                user_id,
                username,
                permissions,
                jsonb_typeof(permissions) as json_type,
                jsonb_array_length(permissions->'allowedModels') as model_count
            FROM users
            WHERE is_active = TRUE
            ORDER BY created_at DESC
        """)

        for user in final_users:
            model_count = user['model_count'] if user['model_count'] is not None else 0
            status = "✅" if model_count > 0 else "❌"
            logger.info(f"  {status} {user['username']}: {model_count} 个可用模型")

        logger.info("\n✅ 诊断和修复完成！")

    except Exception as e:
        logger.error(f"❌ 诊断和修复失败: {e}", exc_info=True)
        return 1

    return 0

if __name__ == "__main__":
    exit_code = asyncio.run(diagnose_and_fix())
    exit(exit_code)
