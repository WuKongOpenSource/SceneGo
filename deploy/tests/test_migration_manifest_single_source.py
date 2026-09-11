from pathlib import Path

from scripts.apply_migrations import read_manifest


DEPLOY_DIR = Path(__file__).resolve().parents[1]
MANIFEST = DEPLOY_DIR / "db_build" / "manifest.txt"


def test_canonical_manifest_contains_every_sql_migration():
    manifest_paths = read_manifest(MANIFEST, root=DEPLOY_DIR)
    manifest_names = {path.name for path in manifest_paths}
    sql_names = {path.name for path in (DEPLOY_DIR / "sql").glob("db_migration_*.sql")}

    assert sql_names <= manifest_names
    assert all(path.parent == DEPLOY_DIR / "sql" for path in manifest_paths)


def test_episode_script_source_migration_is_mirrored_and_ordered():
    root_copy = DEPLOY_DIR / "db_migration_episode_script_sources.sql"
    sql_copy = DEPLOY_DIR / "sql" / "db_migration_episode_script_sources.sql"
    assert root_copy.read_bytes() == sql_copy.read_bytes()

    ordered_names = [path.name for path in read_manifest(MANIFEST, root=DEPLOY_DIR)]
    assert ordered_names.index("db_migration_multi_scripts.sql") < ordered_names.index(
        "db_migration_episode_script_sources.sql"
    )

    sql = sql_copy.read_text(encoding="utf-8")
    assert "ADD COLUMN IF NOT EXISTS source_type" in sql
    assert "ADD COLUMN IF NOT EXISTS source_id" in sql
    assert "CREATE UNIQUE INDEX IF NOT EXISTS uq_episode_scripts_source" in sql
    assert "WHERE source_type IS NOT NULL" in sql


def test_session_version_migration_is_after_account_auth_columns():
    ordered_names = [path.name for path in read_manifest(MANIFEST, root=DEPLOY_DIR)]
    assert ordered_names.index("db_migration_phone_email_auth.sql") < ordered_names.index(
        "db_migration_session_version.sql"
    )

    sql = (DEPLOY_DIR / "sql" / "db_migration_session_version.sql").read_text(encoding="utf-8")
    assert "session_version BIGINT NOT NULL DEFAULT 1" in sql
    assert "CHECK (session_version >= 1)" in sql
