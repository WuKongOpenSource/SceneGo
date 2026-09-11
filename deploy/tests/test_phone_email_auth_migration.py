from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]
MIGRATION = DEPLOY_DIR / "sql" / "db_migration_phone_email_auth.sql"


def test_phone_email_auth_migration_mirror_matches_canonical_sql():
    assert (DEPLOY_DIR / "db_migration_phone_email_auth.sql").read_bytes() == MIGRATION.read_bytes()


def test_phone_email_auth_migration_prepares_legacy_binding_and_email_delivery():
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "legacy_login_enabled" in sql
    assert "uq_users_phone_number" in sql
    assert "uq_users_verified_email" in sql
    assert "CREATE TABLE IF NOT EXISTS email_outbox" in sql
