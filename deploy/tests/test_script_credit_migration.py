from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]


def test_script_credit_migration_mirror_and_manifest():
    root = DEPLOY_DIR / "db_migration_script_credit_rules.sql"
    mirror = DEPLOY_DIR / "sql" / "db_migration_script_credit_rules.sql"
    tier_root = DEPLOY_DIR / "db_migration_script_model_tier_credit_rules.sql"
    tier_mirror = DEPLOY_DIR / "sql" / "db_migration_script_model_tier_credit_rules.sql"
    manifest = (DEPLOY_DIR / "db_build" / "manifest.txt").read_text(encoding="utf-8")

    assert root.read_bytes() == mirror.read_bytes()
    assert tier_root.read_bytes() == tier_mirror.read_bytes()
    assert "sql/db_migration_script_credit_rules.sql" in manifest
    assert "sql/db_migration_script_model_tier_credit_rules.sql" in manifest
    assert manifest.index("sql/db_migration_script_credit_rules.sql") < manifest.index(
        "sql/db_migration_script_model_tier_credit_rules.sql"
    )


def test_script_credit_rules_cover_tokens_shots_and_models():
    sql = (DEPLOY_DIR / "db_migration_script_credit_rules.sql").read_text(encoding="utf-8")

    assert "script_model_call" in sql
    assert "storyboard_design_generation" in sql
    assert '"input_tokens"' in sql
    assert '"output_tokens"' in sql
    assert '"shot_count"' in sql
    assert '"model"' in sql


def test_script_credit_rules_define_public_model_tier_multipliers():
    sql = (DEPLOY_DIR / "db_migration_script_model_tier_credit_rules.sql").read_text(encoding="utf-8")

    assert "script_model_call" in sql
    assert "storyboard_design_generation" in sql
    assert "script_tier_1" in sql
    assert "script_tier_2" in sql
    assert "script_tier_3" in sql
    assert "script_tier_4" in sql
    assert "'multiplier', 4" in sql
