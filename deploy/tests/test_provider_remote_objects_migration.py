from pathlib import Path

from scripts.apply_migrations import read_manifest


DEPLOY_DIR = Path(__file__).resolve().parents[1]
ROOT_MIGRATION = DEPLOY_DIR / "db_migration_provider_remote_objects.sql"
SQL_MIRROR = DEPLOY_DIR / "sql" / "db_migration_provider_remote_objects.sql"


def test_provider_remote_objects_migration_is_mirrored():
    assert ROOT_MIGRATION.read_bytes() == SQL_MIRROR.read_bytes()


def test_provider_remote_objects_migration_defines_owner_key():
    sql = SQL_MIRROR.read_text(encoding="utf-8")
    assert "CREATE TABLE IF NOT EXISTS provider_remote_objects" in sql
    assert "PRIMARY KEY (provider, object_type, object_id)" in sql
    assert "user_id TEXT NOT NULL" in sql


def test_provider_remote_objects_migration_is_in_canonical_deploy_manifest():
    migration = DEPLOY_DIR / "sql" / "db_migration_provider_remote_objects.sql"
    manifest = read_manifest(DEPLOY_DIR / "db_build" / "manifest.txt", root=DEPLOY_DIR)
    assert migration in manifest
