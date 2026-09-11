from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]
MIGRATION = DEPLOY_DIR / "sql" / "db_migration_wechat_creation_point_recharge.sql"


def test_wechat_recharge_migration_mirror_matches_canonical_sql():
    assert (DEPLOY_DIR / "db_migration_wechat_creation_point_recharge.sql").read_bytes() == MIGRATION.read_bytes()


def test_wechat_recharge_order_and_ledger_are_unique_and_linked():
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "out_trade_no VARCHAR(32) UNIQUE NOT NULL" in sql
    assert "transaction_id VARCHAR(64) UNIQUE" in sql
    assert "notify_event_id VARCHAR(64) UNIQUE" in sql
    assert "CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_transactions_payment_order" in sql
    assert "REFERENCES wechat_creation_point_orders(payment_order_id)" in sql


def test_wechat_recharge_migration_runs_after_creation_point_buckets():
    rows = (DEPLOY_DIR / "db_build" / "manifest.txt").read_text(encoding="utf-8").splitlines()
    points = next(i for i, row in enumerate(rows) if row.startswith("sql/db_migration_creation_points.sql"))
    recharge = next(i for i, row in enumerate(rows) if row.startswith("sql/db_migration_wechat_creation_point_recharge.sql"))

    assert points < recharge
