from pathlib import Path

import pytest

from scripts.apply_migrations import migration_checksum_variants
from services.credit_service import compute_cost


DEPLOY_DIR = Path(__file__).resolve().parents[1]
LEGACY_UPSCALE_CHECKSUM = "5f0a44e15d6562ad4b7471a4d891337fb3d25d2206ad00d5f11b296b9abf092b"


def test_image_upscale_migration_is_manifested_and_capped_at_fifty():
    legacy_path = DEPLOY_DIR / "sql/db_migration_image_upscale_credit_rule.sql"
    legacy_sql = legacy_path.read_text(encoding="utf-8")
    sql = (DEPLOY_DIR / "sql/db_migration_image_upscale_credit_pricing_v2.sql").read_text(
        encoding="utf-8"
    )
    manifest = (DEPLOY_DIR / "db_build/manifest.txt").read_text(encoding="utf-8")

    # Preserve the ledger checksum while allowing Git's line-ending conversion.
    assert LEGACY_UPSCALE_CHECKSUM in migration_checksum_variants(legacy_path)
    assert "2026-09-02-image-upscale-v1" in legacy_sql
    assert "'image_upscale'" in sql
    assert "min_cost, max_cost" in sql
    assert "  50," in sql
    assert "sql/db_migration_image_upscale_credit_rule.sql" in manifest
    assert "sql/db_migration_image_upscale_credit_pricing_v2.sql" in manifest


@pytest.mark.parametrize("line_ending", [b"\n", b"\r\n"])
def test_legacy_upscale_checksum_allows_only_line_ending_changes(tmp_path, line_ending):
    original = (DEPLOY_DIR / "sql/db_migration_image_upscale_credit_rule.sql").read_bytes()
    normalized = original.replace(b"\r\n", b"\n")
    path = tmp_path / "migration.sql"
    path.write_bytes(normalized.replace(b"\n", line_ending))
    assert LEGACY_UPSCALE_CHECKSUM in migration_checksum_variants(path)

    path.write_bytes(path.read_bytes() + b"SELECT 1;" + line_ending)
    assert LEGACY_UPSCALE_CHECKSUM not in migration_checksum_variants(path)


def test_image_upscale_credit_tiers_dpi_and_text_mode_never_exceed_fifty():
    rule = {
        "feature_key": "image_upscale",
        "base_cost": 10,
        "factors": [
            {
                "key": "target_long_edge",
                "type": "range",
                "rules": [
                    {"min": 4096, "max": 4096, "multiplier": 0.8},
                    {"min": 4097, "max": 8192, "multiplier": 1.5},
                    {"min": 8193, "max": 16000, "multiplier": 2.5},
                    {"min": 16001, "max": 32000, "multiplier": 3.8},
                    {"min": 32001, "max": 50000, "multiplier": 4.5},
                ],
            },
            {
                "key": "text_clarity",
                "type": "enum_add",
                "rules": [{"value": True, "add": 2}],
            },
            {
                "key": "dpi",
                "type": "enum_add",
                "rules": [
                    {"value": 150, "add": 1},
                    {"value": 300, "add": 3},
                ],
            },
        ],
        "min_cost": 8,
        "max_cost": 50,
    }

    assert [
        compute_cost(rule, {"target_long_edge": edge, "dpi": 72})
        for edge in (4096, 8192, 16000, 32000, 50000)
    ] == [8, 15, 25, 38, 45]
    assert compute_cost(rule, {"target_long_edge": 50000, "dpi": 150}) == 46
    assert compute_cost(rule, {"target_long_edge": 50000, "dpi": 300}) == 48
    assert compute_cost(rule, {"target_long_edge": 50000, "dpi": 300, "text_clarity": True}) == 50


def test_frontend_exposes_standalone_image_upscale_route_and_controls():
    app = (DEPLOY_DIR / "new_html/App.tsx").read_text(encoding="utf-8")
    layout = (DEPLOY_DIR / "new_html/layouts/WorkflowLayout.tsx").read_text(encoding="utf-8")
    sidebar = (DEPLOY_DIR / "new_html/components/AppSidebar.tsx").read_text(encoding="utf-8")
    page = (DEPLOY_DIR / "new_html/pages/ImageUpscalePage.tsx").read_text(encoding="utf-8")

    assert 'path="image-upscale"' in app
    assert "label: '图片高清放大'" in layout
    assert "50000" in page
    assert "300 DPI" in page
    assert "文字清晰" in page
    assert 'aria-label="文字清晰"' in page
    assert "absolute left-0.5 top-0.5" in page
    assert "纯图片背景效果通常更稳定" in page
    assert "'image_upscale'" in page
    assert "结果保留 30 天" in page
    assert "formatImageUpscaleDeletionTime" in page
    assert "预计于" in (
        DEPLOY_DIR / "new_html/utils/imageUpscaleRetention.ts"
    ).read_text(encoding="utf-8")
    assert "预计处理耗时" in page
    assert "排队等待与下载时间另计" in page
    assert "[4, 8]" in page
    assert "不占用主站硬盘" not in page
    assert "/ticket" in page
    assert "图片放大历史" in page
    assert "'/api/tasks?limit=100'" in page
    assert "每位用户最多同时排队或处理 2 个" in page
    assert layout.index("label: '图片高清放大'") < layout.index("label: '生成历史'")
    assert sidebar.index("label: '图片高清放大'") < sidebar.index("label: '生成历史'")
