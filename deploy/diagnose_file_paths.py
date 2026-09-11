#!/usr/bin/env python3




import asyncio
import os
from pathlib import Path
from dao_content import FileDAO
from db_manager import init_db_manager

async def diagnose():
    await init_db_manager()

    print(f"\n当前工作目录: {os.getcwd()}")
    print(f"脚本所在目录: {Path(__file__).parent.absolute()}\n")


    from db_manager import get_db_manager
    db = get_db_manager()

    files = await db.fetch("""
        SELECT file_id, user_id, file_name, file_path, file_url, created_at
        FROM files
        WHERE is_deleted = FALSE
        ORDER BY created_at DESC
        LIMIT 20
    """)

    print(f"最近20个文件记录：\n")

    for f in files:
        file_path = f['file_path']
        print(f"文件ID: {f['file_id']}")
        print(f"  用户: {f['user_id']}")
        print(f"  名称: {f['file_name']}")
        print(f"  DB路径: {file_path}")
        print(f"  URL: {f['file_url']}")


        possible_paths = []
        base_dir = os.getcwd()

        if os.path.isabs(file_path):
            possible_paths.append(file_path)
        else:
            possible_paths.append(os.path.join(base_dir, file_path))

        found = False
        for path in possible_paths:
            if os.path.exists(path):
                print(f"  ✅ 文件存在: {path}")
                print(f"     大小: {os.path.getsize(path)} bytes")
                found = True
                break

        if not found:
            print(f"  ❌ 文件不存在，尝试的路径:")
            for path in possible_paths:
                print(f"     - {path}")

        print()

if __name__ == "__main__":
    asyncio.run(diagnose())
