from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]


def test_generation_credit_migration_mirror_and_manifest():
    root = DEPLOY_DIR / "db_migration_generation_credit_rules.sql"
    mirror = DEPLOY_DIR / "sql" / "db_migration_generation_credit_rules.sql"
    manifest = (DEPLOY_DIR / "db_build" / "manifest.txt").read_text(encoding="utf-8")

    assert root.read_bytes() == mirror.read_bytes()
    assert "sql/db_migration_generation_credit_rules.sql" in manifest


def test_video_enhancement_rule_is_fixed_success_only_cost():
    sql = (DEPLOY_DIR / "db_migration_generation_credit_rules.sql").read_text(encoding="utf-8")

    assert "video_enhancement" in sql
    assert "TRUE, 5, 'task'" in sql
    assert "ON CONFLICT (rule_id) DO UPDATE" in sql
    assert "失败或取消不扣积分" in sql
