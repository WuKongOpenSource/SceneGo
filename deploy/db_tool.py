#!/usr/bin/env python3




import asyncio
import sys
import os
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent))

async def main():
    from db_manager import get_db_manager

    if len(sys.argv) < 2:
        print_help()
        return

    command = sys.argv[1]


    db = get_db_manager()
    await db.connect()

    try:
        if command == "users":
            await list_users(db)
        elif command == "user":
            if len(sys.argv) < 3:
                print("用法: python db_tool.py user <user_id>")
                return
            await show_user(db, sys.argv[2])
        elif command == "projects":
            if len(sys.argv) < 3:
                print("用法: python db_tool.py projects <user_id>")
                return
            await list_projects(db, sys.argv[2])
        elif command == "versions":
            if len(sys.argv) < 3:
                print("用法: python db_tool.py versions <project_id>")
                return
            await list_versions(db, sys.argv[3])
        elif command == "files":
            if len(sys.argv) < 3:
                print("用法: python db_tool.py files <user_id> [file_type]")
                return
            file_type = sys.argv[3] if len(sys.argv) > 3 else None
            await list_files(db, sys.argv[2], file_type)
        elif command == "tasks":
            if len(sys.argv) < 3:
                print("用法: python db_tool.py tasks <user_id> [status]")
                return
            status = sys.argv[3] if len(sys.argv) > 3 else None
            await list_tasks(db, sys.argv[2], status)
        elif command == "stats":
            await show_stats(db)
        elif command == "cleanup":
            days = int(sys.argv[2]) if len(sys.argv) > 2 else 30
            await cleanup_old_data(db, days)
        elif command == "reset":
            await reset_database(db)
        else:
            print(f"未知命令: {command}")
            print_help()

    finally:
        await db.disconnect()

def print_help():

    print("""
数据库管理工具

命令:
  users                     - 列出所有用户
  user <user_id>            - 显示用户详情
  projects <user_id>        - 列出用户的项目
  versions <project_id>     - 列出项目的版本
  files <user_id> [type]    - 列出用户的文件
  tasks <user_id> [status]  - 列出用户的任务
  stats                     - 显示系统统计
  cleanup [days]            - 清理旧数据(默认30天)
  reset                     - 重置数据库(危险!)

示例:
  python db_tool.py users
  python db_tool.py user user_abc123
  python db_tool.py projects user_abc123
  python db_tool.py files user_abc123 image
  python db_tool.py tasks user_abc123 completed
  python db_tool.py cleanup 60
""")

async def list_users(db):

    users = await db.fetch("""
        SELECT user_id, username, email,
               storage_quota_gb, used_storage_bytes,
               created_at, last_login_at
        FROM users
        WHERE is_active = TRUE
        ORDER BY created_at DESC
    """)

    print(f"\n总共 {len(users)} 个用户:\n")
    print(f"{'用户ID':<20} {'用户名':<20} {'邮箱':<30} {'存储使用':<20} {'注册时间':<20}")
    print("-" * 110)

    for user in users:
        used_gb = user['used_storage_bytes'] / (1024**3)
        storage = f"{used_gb:.2f}GB / {user['storage_quota_gb']}GB"
        print(f"{user['user_id']:<20} {user['username']:<20} {user['email'] or 'N/A':<30} {storage:<20} {str(user['created_at'])[:19]:<20}")

async def show_user(db, user_id):

    user = await db.fetchrow("SELECT * FROM users WHERE user_id = $1", user_id)

    if not user:
        print(f"用户不存在: {user_id}")
        return

    print(f"\n用户详情:")
    print(f"  用户ID: {user['user_id']}")
    print(f"  用户名: {user['username']}")
    print(f"  邮箱: {user['email'] or 'N/A'}")
    print(f"  注册时间: {user['created_at']}")
    print(f"  最后登录: {user['last_login_at'] or 'N/A'}")
    print(f"  存储配额: {user['storage_quota_gb']}GB")
    print(f"  已用存储: {user['used_storage_bytes'] / (1024**3):.2f}GB")


    stats = await db.fetchrow("""
        SELECT
            COUNT(DISTINCT p.project_id) as project_count,
            COUNT(DISTINCT v.version_id) as version_count,
            COUNT(DISTINCT f.file_id) as file_count,
            COUNT(DISTINCT t.task_id) as task_count
        FROM users u
        LEFT JOIN projects p ON u.user_id = p.user_id
        LEFT JOIN versions v ON u.user_id = v.user_id
        LEFT JOIN files f ON u.user_id = f.user_id AND f.is_deleted = FALSE
        LEFT JOIN tasks t ON u.user_id = t.user_id
        WHERE u.user_id = $1
    """, user_id)

    print(f"\n数据统计:")
    print(f"  项目数: {stats['project_count']}")
    print(f"  版本数: {stats['version_count']}")
    print(f"  文件数: {stats['file_count']}")
    print(f"  任务数: {stats['task_count']}")

async def list_projects(db, user_id):

    projects = await db.fetch("""
        SELECT * FROM projects
        WHERE user_id = $1
        ORDER BY last_accessed_at DESC NULLS LAST
    """, user_id)

    print(f"\n用户 {user_id} 的项目 ({len(projects)}个):\n")
    print(f"{'项目ID':<20} {'项目名称':<30} {'创建时间':<20} {'最后访问':<20}")
    print("-" * 90)

    for proj in projects:
        print(f"{proj['project_id']:<20} {proj['project_name']:<30} {str(proj['created_at'])[:19]:<20} {str(proj['last_accessed_at'] or 'N/A')[:19]:<20}")

async def list_versions(db, project_id):

    versions = await db.fetch("""
        SELECT v.*,
               COUNT(f.file_id) as file_count,
               COUNT(tc.content_id) as text_count
        FROM versions v
        LEFT JOIN files f ON v.version_id = f.version_id AND f.is_deleted = FALSE
        LEFT JOIN text_contents tc ON v.version_id = tc.version_id AND tc.is_deleted = FALSE
        WHERE v.project_id = $1
        GROUP BY v.id
        ORDER BY v.version_number DESC
    """, project_id)

    print(f"\n项目 {project_id} 的版本 ({len(versions)}个):\n")
    print(f"{'版本ID':<20} {'版本号':<10} {'版本名称':<30} {'文件数':<10} {'创建时间':<20} {'当前':<6}")
    print("-" * 110)

    for ver in versions:
        current = "✓" if ver['is_current'] else ""
        print(f"{ver['version_id']:<20} {ver['version_number']:<10} {ver['version_name'] or 'N/A':<30} {ver['file_count']:<10} {str(ver['created_at'])[:19]:<20} {current:<6}")

async def list_files(db, user_id, file_type=None):

    if file_type:
        files = await db.fetch("""
            SELECT * FROM files
            WHERE user_id = $1 AND file_type = $2 AND is_deleted = FALSE
            ORDER BY created_at DESC
            LIMIT 50
        """, user_id, file_type)
    else:
        files = await db.fetch("""
            SELECT * FROM files
            WHERE user_id = $1 AND is_deleted = FALSE
            ORDER BY created_at DESC
            LIMIT 50
        """, user_id)

    print(f"\n用户 {user_id} 的文件 ({len(files)}个):\n")
    print(f"{'文件ID':<20} {'类型':<10} {'文件名':<40} {'大小':<15} {'创建时间':<20}")
    print("-" * 115)

    for file in files:
        size_mb = file['file_size_bytes'] / (1024**2)
        print(f"{file['file_id']:<20} {file['file_type']:<10} {file['file_name']:<40} {size_mb:.2f}MB {str(file['created_at'])[:19]:<20}")

async def list_tasks(db, user_id, status=None):

    if status:
        tasks = await db.fetch("""
            SELECT * FROM tasks
            WHERE user_id = $1 AND status = $2
            ORDER BY created_at DESC
            LIMIT 50
        """, user_id, status)
    else:
        tasks = await db.fetch("""
            SELECT * FROM tasks
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 50
        """, user_id)

    print(f"\n用户 {user_id} 的任务 ({len(tasks)}个):\n")
    print(f"{'任务ID':<20} {'类型':<20} {'状态':<15} {'创建时间':<20} {'完成时间':<20}")
    print("-" * 105)

    for task in tasks:
        completed = str(task['completed_at'])[:19] if task['completed_at'] else 'N/A'
        print(f"{task['task_id']:<20} {task['task_type']:<20} {task['status']:<15} {str(task['created_at'])[:19]:<20} {completed:<20}")

async def show_stats(db):

    stats = await db.fetchrow("""
        SELECT
            COUNT(DISTINCT u.user_id) as total_users,
            COUNT(DISTINCT p.project_id) as total_projects,
            COUNT(DISTINCT v.version_id) as total_versions,
            COUNT(DISTINCT f.file_id) as total_files,
            COUNT(DISTINCT t.task_id) as total_tasks,
            SUM(f.file_size_bytes) as total_storage
        FROM users u
        LEFT JOIN projects p ON u.user_id = p.user_id
        LEFT JOIN versions v ON u.user_id = v.user_id
        LEFT JOIN files f ON u.user_id = f.user_id AND f.is_deleted = FALSE
        LEFT JOIN tasks t ON u.user_id = t.user_id
    """)

    total_storage_gb = (stats['total_storage'] or 0) / (1024**3)

    print("\n系统统计:")
    print(f"  总用户数: {stats['total_users']}")
    print(f"  总项目数: {stats['total_projects']}")
    print(f"  总版本数: {stats['total_versions']}")
    print(f"  总文件数: {stats['total_files']}")
    print(f"  总任务数: {stats['total_tasks']}")
    print(f"  总存储量: {total_storage_gb:.2f}GB")


    task_stats = await db.fetch("""
        SELECT status, COUNT(*) as count
        FROM tasks
        GROUP BY status
    """)

    print("\n任务状态分布:")
    for stat in task_stats:
        print(f"  {stat['status']}: {stat['count']}")

async def cleanup_old_data(db, days):

    days = max(1, int(days))
    print(f"\n清理 {days} 天前的数据...")


    result = await db.execute("""
        DELETE FROM tasks
        WHERE status IN ('completed', 'failed')
        AND completed_at < CURRENT_TIMESTAMP - make_interval(days => $1)
    """, days)
    print(f"  清理任务: {result}")


    result = await db.execute("""
        DELETE FROM activity_logs
        WHERE created_at < CURRENT_TIMESTAMP - make_interval(days => $1)
    """, days)
    print(f"  清理日志: {result}")

    print("清理完成!")

async def reset_database(db):

    confirm = input("⚠️  警告: 这将删除所有数据! 输入 'RESET' 确认: ")
    if confirm != "RESET":
        print("取消操作")
        return

    print("\n重置数据库...")


    await db.execute("DROP SCHEMA public CASCADE")
    await db.execute("CREATE SCHEMA public")
    # Quote the configured role as an identifier; database ownership is a
    # deployment concern and must not be coupled to a product-era username.
    configured_role = db.config.USER.replace('"', '""')
    await db.execute(f'GRANT ALL ON SCHEMA public TO "{configured_role}"')


    schema_file = Path(__file__).parent / "database_schema.sql"
    if schema_file.exists():
        with open(schema_file, 'r') as f:
            sql = f.read()
            await db.execute(sql)
        print("数据库已重置!")
    else:
        print("错误: 找不到 database_schema.sql")

if __name__ == "__main__":
    asyncio.run(main())
