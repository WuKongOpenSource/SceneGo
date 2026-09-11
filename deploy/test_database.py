#!/usr/bin/env python3



import asyncio
import sys

async def test_database():

    print("🔍 开始测试数据库...")
    print("-" * 60)

    try:

        print("\n1️⃣ 测试数据库连接...")
        from db_manager import init_db_manager
        db = await init_db_manager()
        print("✅ 数据库连接成功")


        print("\n2️⃣ 查看用户列表...")
        users = await db.fetch("SELECT user_id, username, email, created_at FROM users ORDER BY created_at DESC LIMIT 10")
        if users:
            print(f"找到 {len(users)} 个用户：")
            for user in users:
                print(f"   - {user['username']} (ID: {user['user_id'][:12]}..., Email: {user['email']})")
        else:
            print("⚠️ 用户表为空")


        print("\n3️⃣ 查看任务列表...")
        tasks = await db.fetch("SELECT task_id, user_id, task_type, status, created_at FROM tasks ORDER BY created_at DESC LIMIT 10")
        if tasks:
            print(f"找到 {len(tasks)} 个任务：")
            for task in tasks:
                username_result = await db.fetch_one(
                    "SELECT username FROM users WHERE user_id = $1",
                    task['user_id']
                )
                username = username_result['username'] if username_result else 'unknown'
                print(f"   - {task['task_type']} ({task['status']}) - 用户: {username} - {task['created_at']}")
        else:
            print("⚠️ 任务表为空")


        print("\n4️⃣ 查看项目列表...")
        projects = await db.fetch("SELECT project_id, user_id, project_name, created_at FROM projects ORDER BY created_at DESC LIMIT 10")
        if projects:
            print(f"找到 {len(projects)} 个项目：")
            for project in projects:
                username_result = await db.fetch_one(
                    "SELECT username FROM users WHERE user_id = $1",
                    project['user_id']
                )
                username = username_result['username'] if username_result else 'unknown'
                print(f"   - {project['project_name']} - 用户: {username}")
        else:
            print("⚠️ 项目表为空")


        print("\n5️⃣ 数据库统计...")
        stats = await db.fetch("""
            SELECT
                (SELECT COUNT(*) FROM users) as user_count,
                (SELECT COUNT(*) FROM projects) as project_count,
                (SELECT COUNT(*) FROM versions) as version_count,
                (SELECT COUNT(*) FROM files) as file_count,
                (SELECT COUNT(*) FROM tasks) as task_count
        """)
        if stats:
            stat = stats[0]
            print(f"   - 用户数: {stat['user_count']}")
            print(f"   - 项目数: {stat['project_count']}")
            print(f"   - 版本数: {stat['version_count']}")
            print(f"   - 文件数: {stat['file_count']}")
            print(f"   - 任务数: {stat['task_count']}")

        await db.disconnect()
        print("\n" + "=" * 60)
        print("✅ 数据库测试完成")
        print("=" * 60)

    except ImportError as e:
        print(f"❌ 数据库模块导入失败: {e}")
        print("提示: 请确保已安装数据库依赖: pip install -r requirements_database.txt")
        sys.exit(1)
    except Exception as e:
        print(f"❌ 数据库测试失败: {e}")
        print("\n可能的原因：")
        print("1. PostgreSQL 未安装或未启动")
        print("2. 数据库配置不正确（database_config.py）")
        print("3. 数据库表未创建（运行 database_schema.sql）")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(test_database())
