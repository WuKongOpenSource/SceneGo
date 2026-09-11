from __future__ import annotations

import hashlib
from contextlib import asynccontextmanager
from pathlib import Path

import pytest

from scripts import apply_migrations as runner


class FakeConnection:
    def __init__(self, *, existing_schema=False):
        self.ledger = {}
        self.executed = []
        self.existing_schema = existing_schema

    async def execute(self, sql, *args):
        self.executed.append((sql, args))
        if "INSERT INTO schema_migrations" in sql:
            self.ledger[args[0]] = args[1]
        return "OK"

    async def fetchrow(self, _sql, migration_id):
        checksum = self.ledger.get(migration_id)
        return {"checksum_sha256": checksum} if checksum else None

    async def fetchval(self, _sql, *_args):
        return self.existing_schema

    @asynccontextmanager
    async def transaction(self):
        yield


@pytest.mark.asyncio
async def test_apply_migrations_is_ordered_and_idempotent(tmp_path):
    first = tmp_path / "001_first.sql"
    second = tmp_path / "002_second.sql"
    first.write_text("CREATE TABLE one(id int);", encoding="utf-8")
    second.write_text("CREATE TABLE two(id int);", encoding="utf-8")
    conn = FakeConnection()

    initial = await runner.apply_migrations(conn, [first, second], root=tmp_path, git_sha="abc123")
    repeated = await runner.apply_migrations(conn, [first, second], root=tmp_path, git_sha="abc123")

    assert initial == [("001_first.sql", "applied"), ("002_second.sql", "applied")]
    assert repeated == [("001_first.sql", "skipped"), ("002_second.sql", "skipped")]
    migration_sql = [sql for sql, _args in conn.executed if sql.startswith("CREATE TABLE one") or sql.startswith("CREATE TABLE two")]
    assert migration_sql == ["CREATE TABLE one(id int);", "CREATE TABLE two(id int);"]


@pytest.mark.asyncio
async def test_changed_applied_migration_is_blocked(tmp_path):
    path = tmp_path / "001.sql"
    path.write_text("SELECT 1;", encoding="utf-8")
    conn = FakeConnection()
    conn.ledger["001.sql"] = hashlib.sha256(b"old content").hexdigest()

    with pytest.raises(RuntimeError, match="checksum mismatch"):
        await runner.apply_migrations(conn, [path], root=tmp_path)


@pytest.mark.asyncio
async def test_line_ending_only_change_is_accepted(tmp_path):
    path = tmp_path / "001.sql"
    path.write_bytes(b"SELECT 1;\nSELECT 2;\n")
    conn = FakeConnection()
    conn.ledger["001.sql"] = hashlib.sha256(b"SELECT 1;\r\nSELECT 2;\r\n").hexdigest()

    result = await runner.apply_migrations(conn, [path], root=tmp_path)

    assert result == [("001.sql", "skipped")]


@pytest.mark.asyncio
async def test_known_precommit_migration_checksum_is_accepted():
    deploy_dir = Path(__file__).resolve().parents[1]
    path = deploy_dir / "sql" / "db_migration_episode_script_sources.sql"
    conn = FakeConnection()
    conn.ledger["sql/db_migration_episode_script_sources.sql"] = (
        "bbe14ea12b6cc44d39e312d7fb3250b6957c33eab64b3ffe400c40fdd989d1e1"
    )

    result = await runner.apply_migrations(conn, [path], root=deploy_dir)

    assert result == [("sql/db_migration_episode_script_sources.sql", "skipped")]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("relative_path", "recorded_checksum"),
    [
        (
            "sql/database_schema.sql",
            "d544a23283cccd3cc03794ef38c13e3afa5de032401c772cdd1b2ada2a9d1360",
        ),
        (
            "sql/db_migration_admin_users_groups.sql",
            "82b88580b0b144c1b7eef38100aac8ad093f34ad54e7e8c3a0808b961bee2fd0",
        ),
        (
            "sql/db_migration_credits.sql",
            "7953c3fdd50b0a55b51ac1a537b248fef6f233499b8c5b6babf48b4855a39a75",
        ),
        (
            "sql/db_migration_video_reverse.sql",
            "63d9aead1c79690ab25fdc0f4cac15f956b816df6f5916979f3552b7dad4ae13",
        ),
    ],
)
async def test_comment_only_migration_rewrites_keep_ledger_compatibility(
    relative_path: str,
    recorded_checksum: str,
) -> None:
    deploy_dir = Path(__file__).resolve().parents[1]
    path = deploy_dir / relative_path
    conn = FakeConnection()
    conn.ledger[relative_path] = recorded_checksum

    result = await runner.apply_migrations(conn, [path], root=deploy_dir)

    assert result == [(relative_path, "skipped")]


def test_checksum_alias_targets_match_canonical_migrations() -> None:
    deploy_dir = Path(__file__).resolve().parents[1]

    for relative_path, aliases in runner.LEGACY_CHECKSUM_ALIASES.items():
        variants = runner.migration_checksum_variants(deploy_dir / relative_path)
        assert set(aliases.values()) <= variants, relative_path


def test_explicit_outer_transaction_control_is_removed():
    sql = "BEGIN;\nSELECT 1;\nCOMMIT;"
    assert runner.prepare_migration_sql(sql).strip() == "SELECT 1;"


def test_manifest_paths_are_resolved_from_root(tmp_path):
    manifest = tmp_path / "manifest.txt"
    manifest.write_text("# ordered\nsql/001.sql # first\n\nsql/002.sql\n", encoding="utf-8")

    assert runner.read_manifest(manifest, root=tmp_path) == [
        tmp_path / "sql" / "001.sql",
        tmp_path / "sql" / "002.sql",
    ]




@pytest.mark.asyncio
async def test_existing_schema_adopts_untracked_legacy_migration(tmp_path):
    legacy = tmp_path / "database_schema.sql"
    legacy.write_text("CREATE TABLE users(id int);", encoding="utf-8")
    conn = FakeConnection(existing_schema=True)

    result = await runner.apply_migrations(conn, [legacy], root=tmp_path, git_sha="release")

    assert result == [("database_schema.sql", "baselined")]
    assert not any(sql.startswith("CREATE TABLE users") for sql, _args in conn.executed)
    assert conn.ledger["database_schema.sql"] == runner.migration_checksum(legacy)


@pytest.mark.asyncio
async def test_fresh_schema_executes_legacy_migration(tmp_path):
    legacy = tmp_path / "database_schema.sql"
    legacy.write_text("CREATE TABLE users(id int);", encoding="utf-8")
    conn = FakeConnection(existing_schema=False)

    result = await runner.apply_migrations(conn, [legacy], root=tmp_path)

    assert result == [("database_schema.sql", "applied")]
    assert any(sql.startswith("CREATE TABLE users") for sql, _args in conn.executed)


@pytest.mark.asyncio
async def test_existing_schema_still_executes_new_migration(tmp_path):
    current = tmp_path / "db_migration_script_conversations.sql"
    current.write_text("CREATE TABLE episode_script_messages(id int);", encoding="utf-8")
    conn = FakeConnection(existing_schema=True)

    result = await runner.apply_migrations(conn, [current], root=tmp_path)

    assert result == [("db_migration_script_conversations.sql", "applied")]
    assert any(sql.startswith("CREATE TABLE episode_script_messages") for sql, _args in conn.executed)
