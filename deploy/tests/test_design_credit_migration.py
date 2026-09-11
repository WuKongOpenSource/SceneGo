from pathlib import Path

from services import credit_service


DEPLOY_DIR = Path(__file__).resolve().parents[1]


def test_design_credit_migration_mirror_and_manifest():
    root = DEPLOY_DIR / "db_migration_design_credit_rules.sql"
    mirror = DEPLOY_DIR / "sql" / "db_migration_design_credit_rules.sql"
    manifest = (DEPLOY_DIR / "db_build" / "manifest.txt").read_text(encoding="utf-8")

    assert root.read_bytes() == mirror.read_bytes()
    assert "sql/db_migration_design_credit_rules.sql" in manifest


def test_design_credit_rules_cover_image_angle_and_upscale():
    sql = (DEPLOY_DIR / "db_migration_design_credit_rules.sql").read_text(encoding="utf-8")

    assert "design_image_generation" in sql
    assert "design_angle_adjustment" in sql
    assert "design_upscale_hd" in sql
    assert '"image_count"' in sql
    assert '"cost_per_unit":10' in sql


def test_design_image_credit_tier_migration_mirror_and_manifest():
    root = DEPLOY_DIR / "db_migration_design_image_credit_tiers.sql"
    mirror = DEPLOY_DIR / "sql" / "db_migration_design_image_credit_tiers.sql"
    manifest = (DEPLOY_DIR / "db_build" / "manifest.txt").read_text(encoding="utf-8")

    assert root.read_bytes() == mirror.read_bytes()
    assert "sql/db_migration_design_image_credit_tiers.sql" in manifest

    sql = root.read_text(encoding="utf-8")
    assert '"cost_per_unit":40' in sql
    assert '"value":"image_tier_1","multiplier":1' in sql
    assert '"value":"image_tier_2","multiplier":2.5' in sql
    assert '"value":"image_tier_3","multiplier":1.5' in sql
    # Applied migrations are immutable: keep the original ledger checksum and wording.
    assert "失败不扣积分" in sql


def test_design_image_credit_tiers_cost_40_to_100_per_image():
    rule = {
        "feature_key": "design_image_generation",
        "base_cost": 0,
        "min_cost": 40,
        "max_cost": 1500,
        "factors": [
            {"key": "image_count", "type": "linear_add", "cost_per_unit": 40},
            {
                "key": "model",
                "type": "enum",
                "rules": [
                    {"value": "image_tier_1", "multiplier": 1},
                    {"value": "image_tier_2", "multiplier": 2.5},
                    {"value": "image_tier_3", "multiplier": 1.5},
                ],
                "default_multiplier": 1,
            },
        ],
    }

    assert credit_service.compute_cost(rule, {"image_count": 1, "model": "image_tier_1"}) == 40
    assert credit_service.compute_cost(rule, {"image_count": 1, "model": "image_tier_2"}) == 100
    assert credit_service.compute_cost(rule, {"image_count": 1, "model": "image_tier_3"}) == 60
    assert credit_service.compute_cost(rule, {"image_count": 2, "model": "image_tier_1"}) == 80


def test_design_image_creation_point_pricing_v2_matrix_and_manifest():
    root = DEPLOY_DIR / "db_migration_design_image_credit_pricing_v2.sql"
    mirror = DEPLOY_DIR / "sql" / "db_migration_design_image_credit_pricing_v2.sql"
    manifest = (DEPLOY_DIR / "db_build" / "manifest.txt").read_text(encoding="utf-8")

    assert root.read_bytes() == mirror.read_bytes()
    assert "sql/db_migration_design_image_credit_pricing_v2.sql" in manifest
    sql = root.read_text(encoding="utf-8")
    assert '"type":"lookup_unit_add"' in sql
    assert '"model":"image_tier_2","resolution":"4K"' in sql
    assert '"cost_per_unit":26' in sql
    assert "失败不扣创作点数" in sql


def test_design_image_creation_point_pricing_v2_exact_matrix():
    rule = {
        "feature_key": "design_image_generation",
        "base_cost": 0,
        "min_cost": 5,
        "max_cost": 1500,
        "factors": [{
            "key": "image_count",
            "type": "lookup_unit_add",
            "default_cost_per_unit": 8,
            "rules": [
                {"when": {"model": "image_tier_1", "resolution": "1K"}, "cost_per_unit": 8},
                {"when": {"model": "image_tier_2", "resolution": "1K"}, "cost_per_unit": 12},
                {"when": {"model": "image_tier_2", "resolution": "2K"}, "cost_per_unit": 18},
                {"when": {"model": "image_tier_2", "resolution": "4K"}, "cost_per_unit": 26},
                {"when": {"model": "image_tier_3", "resolution": "1K"}, "cost_per_unit": 5},
                {"when": {"model": "image_tier_3", "resolution": "2K"}, "cost_per_unit": 10},
                {"when": {"model": "image_tier_3", "resolution": "4K"}, "cost_per_unit": 15},
                {"when": {"model": "image_tier_1"}, "cost_per_unit": 8},
                {"when": {"model": "image_tier_2"}, "cost_per_unit": 12},
                {"when": {"model": "image_tier_3"}, "cost_per_unit": 5},
            ],
        }],
    }

    expected = {
        ("image_tier_1", "1K"): 8,
        ("image_tier_2", "1K"): 12,
        ("image_tier_2", "2K"): 18,
        ("image_tier_2", "4K"): 26,
        ("image_tier_3", "1K"): 5,
        ("image_tier_3", "2K"): 10,
        ("image_tier_3", "4K"): 15,
    }
    for (model, resolution), cost in expected.items():
        assert credit_service.compute_cost(
            rule,
            {"image_count": 1, "model": model, "resolution": resolution},
        ) == cost
    assert credit_service.compute_cost(
        rule,
        {"image_count": 2, "model": "image_tier_2", "resolution": "4k"},
    ) == 52
    assert credit_service.compute_cost(
        rule,
        {"image_count": 1, "model": "image_tier_3"},
    ) == 5


def test_design_prompt_refinement_credit_rule_mirror_manifest_and_costs():
    root = DEPLOY_DIR / "db_migration_design_prompt_refinement_credit_rule.sql"
    mirror = DEPLOY_DIR / "sql" / "db_migration_design_prompt_refinement_credit_rule.sql"
    manifest = (DEPLOY_DIR / "db_build" / "manifest.txt").read_text(encoding="utf-8")

    assert root.read_bytes() == mirror.read_bytes()
    assert "sql/db_migration_design_prompt_refinement_credit_rule.sql" in manifest

    sql = root.read_text(encoding="utf-8")
    assert "design_prompt_refinement" in sql
    assert '"value":"script_tier_1","multiplier":1' in sql
    assert '"value":"script_tier_2","multiplier":2' in sql
    assert '"value":"script_tier_3","multiplier":3' in sql
    assert '"value":"script_tier_4","multiplier":4' in sql
    assert "失败不扣积分" in sql

    rule = {
        "feature_key": "design_prompt_refinement",
        "base_cost": 1,
        "min_cost": 1,
        "max_cost": 4,
        "factors": [
            {
                "key": "model",
                "type": "enum",
                "rules": [
                    {"value": "script_tier_1", "multiplier": 1},
                    {"value": "script_tier_2", "multiplier": 2},
                    {"value": "script_tier_3", "multiplier": 3},
                    {"value": "script_tier_4", "multiplier": 4},
                ],
                "default_multiplier": 1,
            },
        ],
    }

    assert credit_service.compute_cost(rule, {"model": "script_tier_1"}) == 1
    assert credit_service.compute_cost(rule, {"model": "script_tier_2"}) == 2
    assert credit_service.compute_cost(rule, {"model": "script_tier_3"}) == 3
    assert credit_service.compute_cost(rule, {"model": "script_tier_4"}) == 4


def test_design_multi_angle_credit_rule_mirror_manifest_and_fixed_cost():
    root = DEPLOY_DIR / "db_migration_design_multi_angle_credit_rule.sql"
    mirror = DEPLOY_DIR / "sql" / "db_migration_design_multi_angle_credit_rule.sql"
    manifest = (DEPLOY_DIR / "db_build" / "manifest.txt").read_text(encoding="utf-8")

    assert root.read_bytes() == mirror.read_bytes()
    assert "sql/db_migration_design_multi_angle_credit_rule.sql" in manifest

    sql = root.read_text(encoding="utf-8")
    assert "design_multi_angle_generation" in sql
    assert "固定生成14个" in sql
    assert "失败不扣积分" in sql

    rule = {
        "feature_key": "design_multi_angle_generation",
        "base_cost": 60,
        "min_cost": 60,
        "max_cost": 500,
        "factors": [],
    }
    assert credit_service.compute_cost(
        rule,
        {"operation_count": 1, "workflow": "human_multi_angle", "output_count": 14},
    ) == 60
