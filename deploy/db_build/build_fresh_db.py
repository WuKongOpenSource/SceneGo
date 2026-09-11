#!/usr/bin/env python3
















import asyncio
import sys
from pathlib import Path


try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:
    pass

DEPLOY_DIR = Path(__file__).resolve().parent.parent  # .../deploy
if str(DEPLOY_DIR) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIR))

from core.db_config_loader import get_db_config_value
from core.infrastructure_security import validate_database_security
from scripts.apply_migrations import apply_migrations, read_manifest as read_ordered_manifest

MANIFEST = Path(__file__).resolve().parent / "manifest.txt"


def read_manifest() -> list[str]:
    return [path.relative_to(DEPLOY_DIR).as_posix() for path in read_manifest_paths()]


def read_manifest_paths() -> list[Path]:
    return read_ordered_manifest(MANIFEST, root=DEPLOY_DIR)


def check(files: list[str]) -> int:
    missing = [f for f in files if not (DEPLOY_DIR / f).is_file()]
    print(f"manifest 共 {len(files)} 个文件")
    if missing:
        print("❌ 缺失文件：")
        for m in missing:
            print(f"   - {m}")
        return 1
    print("✅ 所有文件存在")
    return 0


def db_connection_config() -> dict:
    host = get_db_config_value("DB_HOST", "localhost")
    password = get_db_config_value("DB_PASSWORD", "")
    return {
        "host": host,
        "port": int(get_db_config_value("DB_PORT", "5432")),
        "database": get_db_config_value("DB_NAME", "ostory_db"),
        "user": get_db_config_value("DB_USER", "ostory_user"),
        "password": password,
        # Setup must not weaken the transport policy used by the application.
        "ssl": validate_database_security(
            host=host,
            password=password,
            ssl_mode=get_db_config_value("DB_SSLMODE", ""),
        ),
    }


async def run(files: list[str]) -> int:
    try:
        import asyncpg
    except ImportError:
        print("❌ 需要 asyncpg（应用依赖之一）。请在应用 venv 下运行。")
        return 2

    cfg = db_connection_config()
    print(f"连接 {cfg['user']}@{cfg['host']}:{cfg['port']}/{cfg['database']}")
    try:
        conn = await asyncpg.connect(**cfg)
    except Exception as e:
        print(f"❌ 连接失败：{e}")
        return 3

    try:
        try:
            results = await apply_migrations(
                conn,
                [DEPLOY_DIR / item for item in files],
                root=DEPLOY_DIR,
            )
            for i, (migration_id, state) in enumerate(results, 1):
                print(f"  [{i:>2}/{len(results)}] {state}: {migration_id}")
        except Exception as e:
            print(f"  ❌ migration failed: {type(e).__name__}: {e}")
            return 4
    finally:
        await conn.close()

    print("🎉 建库完成，全部脚本执行成功。")
    return 0


def main() -> int:
    files = read_manifest()
    if "--check" in sys.argv:
        return check(files)
    rc = check(files)
    if rc != 0:
        return rc
    return asyncio.run(run(files))


if __name__ == "__main__":
    raise SystemExit(main())
