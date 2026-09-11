from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]


def test_video_credit_migration_mirror_and_manifest():
    root = DEPLOY_DIR / "db_migration_video_credit_pricing.sql"
    mirror = DEPLOY_DIR / "sql" / "db_migration_video_credit_pricing.sql"
    root_v2 = DEPLOY_DIR / "db_migration_video_credit_pricing_v2.sql"
    mirror_v2 = DEPLOY_DIR / "sql" / "db_migration_video_credit_pricing_v2.sql"
    root_v4 = DEPLOY_DIR / "db_migration_seedance_credit_pricing_v4.sql"
    mirror_v4 = DEPLOY_DIR / "sql" / "db_migration_seedance_credit_pricing_v4.sql"
    manifest = (DEPLOY_DIR / "db_build" / "manifest.txt").read_text(encoding="utf-8")

    assert root.read_bytes() == mirror.read_bytes()
    assert root_v2.read_bytes() == mirror_v2.read_bytes()
    assert root_v4.read_bytes() == mirror_v4.read_bytes()
    assert "sql/db_migration_video_credit_pricing.sql" in manifest
    assert "sql/db_migration_video_credit_pricing_v2.sql" in manifest
    assert "sql/db_migration_seedance_credit_pricing_v4.sql" in manifest


def test_video_credit_migration_documents_product_boundaries():
    sql = (DEPLOY_DIR / "db_migration_video_credit_pricing.sql").read_text(encoding="utf-8")

    assert "base_cost = 10" in sql
    assert "min_cost = 10" in sql
    assert "按20积分/元换算" in sql
    assert "HappyHorse 1.0 1080P 5秒为160积分" in sql
    assert "失败或取消不扣积分" in sql


def test_video_credit_v2_migration_only_updates_the_new_pricing_metadata():
    sql = (DEPLOY_DIR / "db_migration_video_credit_pricing_v2.sql").read_text(encoding="utf-8")

    assert "2026-08-19-video-cost-v2" in sql
    assert "MiniMax H3勾选720P放大加5积分" in sql
    assert "WHERE feature_key = 'video_generation'" in sql
    assert "INSERT INTO" not in sql


def test_seedance_pricing_v4_documents_reference_video_and_resolution_rules():
    sql = (DEPLOY_DIR / "db_migration_seedance_credit_pricing_v4.sql").read_text(encoding="utf-8")

    assert "2026-09-02-video-cost-v4" in sql
    assert "参考视频总时长" in sql
    assert "Fast/Mini仅支持480P和720P" in sql
    assert "每段15秒" in sql
