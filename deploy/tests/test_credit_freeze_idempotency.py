from contextlib import asynccontextmanager

import pytest

from dao.business import credit


class FakeConnection:
    def __init__(self, existing, transaction=None):
        self.existing = existing
        self.transaction_row = transaction
        self.executed = []
        self.fetches = []

    @asynccontextmanager
    async def transaction(self):
        yield

    async def execute(self, query, *args):
        self.executed.append((query, args))
        return "SELECT 1"

    async def fetchrow(self, query, *args):
        self.fetches.append((query, args))
        if "FROM credit_freezes f" in query:
            return self.existing
        if "FROM credit_transactions" in query:
            return self.transaction_row
        raise AssertionError(f"unexpected query after idempotent freeze: {query}")


class FakeDB:
    def __init__(self, conn):
        self.conn = conn

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


def active_freeze(**overrides):
    row = {
        "freeze_id": "frz_1",
        "account_id": "acct_1",
        "task_id": "task_1",
        "feature_key": "video_reverse",
        "amount": 20,
        "rule_version": "v1",
        "status": "frozen",
        "freeze_owner_type": "user",
        "freeze_owner_id": "user_1",
        "available_credits": 80,
        "frozen_credits": 20,
        "total_used_credits": 0,
        "account_created_at": None,
        "account_updated_at": None,
    }
    row.update(overrides)
    return row


@pytest.mark.asyncio
async def test_duplicate_task_freeze_reuses_active_freeze(monkeypatch):
    conn = FakeConnection(
        active_freeze(),
        {"transaction_id": "txn_1", "balance_before": 100, "balance_after": 80},
    )
    monkeypatch.setattr(credit, "get_db_manager", lambda: FakeDB(conn))

    result = await credit.CreditLedgerDAO.freeze_credits(
        "user",
        "user_1",
        feature_key="video_reverse",
        amount=20,
        task_id="task_1",
    )

    assert result["idempotent"] is True
    assert result["freeze_id"] == "frz_1"
    assert result["balance_before"] == 100
    assert result["balance_after"] == 80
    assert len(conn.executed) == 1
    assert "pg_advisory_xact_lock" in conn.executed[0][0]
    assert not any("UPDATE credit_accounts" in query for query, _args in conn.fetches)


@pytest.mark.asyncio
async def test_duplicate_task_freeze_rejects_conflicting_amount(monkeypatch):
    conn = FakeConnection(active_freeze(amount=30))
    monkeypatch.setattr(credit, "get_db_manager", lambda: FakeDB(conn))

    with pytest.raises(credit.CreditDAOError, match="Conflicting active credit freeze"):
        await credit.CreditLedgerDAO.freeze_credits(
            "user",
            "user_1",
            feature_key="video_reverse",
            amount=20,
            task_id="task_1",
        )
