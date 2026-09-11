#!/usr/bin/env python3




import asyncio
from db_manager import get_db_manager, init_db_manager

async def check():
    await init_db_manager()
    db = get_db_manager()
    
    print("\n用户权限状态：\n")
    users = await db.fetch("""
        SELECT 
            username,
            user_id,
            permissions,
            jsonb_array_length(permissions->'allowedModels') as model_count
        FROM users
        WHERE is_active = TRUE
        ORDER BY username
    """)
    
    for user in users:
        count = user['model_count'] if user['model_count'] is not None else 0
        status = "✅" if count > 0 else "❌"
        print(f"{status} {user['username']:15s} ({user['user_id']:20s}): {count} 个模型")
    
    print()

if __name__ == "__main__":
    asyncio.run(check())

