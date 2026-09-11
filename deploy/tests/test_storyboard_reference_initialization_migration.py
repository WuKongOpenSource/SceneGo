from pathlib import Path

from scripts.apply_migrations import read_manifest


DEPLOY_DIR = Path(__file__).resolve().parents[1]
ROOT_MIGRATION = DEPLOY_DIR / "db_migration_storyboard_reference_initialization.sql"
SQL_MIRROR = DEPLOY_DIR / "sql" / "db_migration_storyboard_reference_initialization.sql"


def test_storyboard_reference_initialization_migration_is_mirrored():
    assert ROOT_MIGRATION.read_bytes() == SQL_MIRROR.read_bytes()


def test_storyboard_reference_initialization_migration_adds_state_and_migrates_non_empty_lists():
    sql = SQL_MIRROR.read_text(encoding="utf-8")
    assert "reference_config_initialized BOOLEAN NOT NULL DEFAULT FALSE" in sql
    assert "jsonb_array_length(configured_references) > 0" in sql


def test_storyboard_reference_initialization_migration_is_in_deploy_manifest():
    manifest = read_manifest(DEPLOY_DIR / "db_build" / "manifest.txt", root=DEPLOY_DIR)
    assert SQL_MIRROR in manifest
