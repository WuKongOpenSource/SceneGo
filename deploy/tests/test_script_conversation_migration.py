from pathlib import Path

from scripts.apply_migrations import read_manifest


DEPLOY_DIR = Path(__file__).resolve().parents[1]
MIGRATION = DEPLOY_DIR / "sql" / "db_migration_script_conversations.sql"


def test_script_conversation_migration_is_ordered_after_script_isolation():
    names = [path.name for path in read_manifest(DEPLOY_DIR / "db_build" / "manifest.txt", root=DEPLOY_DIR)]
    assert names.index("db_migration_script_id.sql") < names.index("db_migration_script_conversations.sql")


def test_script_conversation_migration_preserves_immutable_versions():
    sql = MIGRATION.read_text(encoding="utf-8")
    assert "CREATE TABLE IF NOT EXISTS episode_script_messages" in sql
    assert "CREATE TABLE IF NOT EXISTS episode_script_versions" in sql
    assert "UNIQUE (script_id, version_no)" in sql
    assert "current_version_id" in sql
    assert "source_version_id" in sql
    assert "msg_legacy_user_" in sql
    assert "ver_legacy_" in sql
    assert "DELETE FROM episode_scripts" not in sql
