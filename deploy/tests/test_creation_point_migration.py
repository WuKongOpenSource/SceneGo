from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]
MIGRATION = DEPLOY_DIR / "sql" / "db_migration_creation_points.sql"


def test_creation_point_migration_mirror_matches_canonical_sql():
    assert (DEPLOY_DIR / "db_migration_creation_points.sql").read_bytes() == MIGRATION.read_bytes()


def test_creation_point_migration_keeps_permanent_and_expiring_buckets_separate():
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "account_credits INTEGER NOT NULL DEFAULT 0" in sql
    assert "gift_credits INTEGER NOT NULL DEFAULT 0" in sql
    assert "frozen_account_credits INTEGER NOT NULL DEFAULT 0" in sql
    assert "frozen_gift_credits INTEGER NOT NULL DEFAULT 0" in sql
    assert "SET account_credits = available_credits" in sql
    assert "gift_expires_at TIMESTAMPTZ" in sql


def test_creation_point_migration_grants_phone_registration_200_points():
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "COALESCE(NEW.phone_verified, FALSE) THEN 200" in sql
    assert "'signup_grant'" in sql
    assert "'source', 'phone_registration'" in sql
    assert "'point_bucket', 'account'" in sql


def test_creation_point_manifest_runs_after_auth_and_credit_tables():
    manifest = (DEPLOY_DIR / "db_build" / "manifest.txt").read_text(encoding="utf-8").splitlines()
    credits = next(i for i, row in enumerate(manifest) if row.startswith("sql/db_migration_credits.sql"))
    auth = next(i for i, row in enumerate(manifest) if row.startswith("sql/db_migration_phone_email_auth.sql"))
    points = next(i for i, row in enumerate(manifest) if row.startswith("sql/db_migration_creation_points.sql"))

    assert credits < points
    assert auth < points
