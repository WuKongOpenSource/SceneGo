from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]
MIGRATION = DEPLOY_DIR / "sql" / "db_migration_workflow_template_recovery.sql"
MANIFEST = DEPLOY_DIR / "db_build" / "manifest.txt"


def test_workflow_template_recovery_is_manifested_after_admin_schema() -> None:
    manifest = MANIFEST.read_text(encoding="utf-8")
    admin_index = manifest.index("sql/db_migration_admin.sql")
    recovery_index = manifest.index("sql/db_migration_workflow_template_recovery.sql")
    api_config_index = manifest.index("sql/db_migration_api_config_category.sql")

    assert admin_index < recovery_index < api_config_index


def test_workflow_template_recovery_only_replaces_known_placeholder_rows() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "('i2i_around', 'i2i_fj', 2)" in sql
    for index in range(1, 7):
        assert f"('qwenN_{index}', 'qwen_{index}', 0)" in sql
    assert "FROM jsonb_object_keys(target.workflow_json)" in sql
    assert "END <= source.maximum_legacy_nodes" in sql
    assert "FROM jsonb_object_keys(source.workflow_json)" in sql
