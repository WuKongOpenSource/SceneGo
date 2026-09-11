"""Keep the SQL boundary strict without confusing Redis batch flushes with SQL."""
from __future__ import annotations

from pathlib import Path

import pytest

from scripts.check_service_dao_boundary import check_file


def scan(tmp_path: Path, source: str):
    path = tmp_path / "sample_service.py"
    path.write_text(source, encoding="utf-8")
    return check_file(path)


def test_queryless_pipeline_flush_is_not_raw_sql(tmp_path):
    assert scan(tmp_path, """
async def touch(redis_client):
    pipe = redis_client.pipeline(transaction=False)
    pipe.set('online', '1', ex=60)
    return await pipe.execute()
""") == []


@pytest.mark.parametrize("call", [
    "db.execute(query)",
    "pipe.execute(command=query)",
    "db.execute(*args)",
    "db.execute(**kwargs)",
    "execute(query)",
    "db.executemany(query, rows)",
    "db.fetch(query)",
    "db.fetchall()",
    "db.fetchone()",
    "db.fetchrow(query)",
    "db.fetchval(query)",
])
def test_raw_database_calls_still_fail_even_without_literal_sql(tmp_path, call):
    violations = scan(tmp_path, f"async def read():\n    return await {call}\n")
    assert any("raw DB method" in item.message for item in violations)


@pytest.mark.parametrize("source", [
    "import asyncpg",
    "from db_manager import get_db_manager",
    "from core.db_manager import get_db_manager",
    "async def read():\n    return await pool.acquire()",
    "async def read():\n    return await service.pool.acquire()",
    "query = 'SELECT name FROM users'\npipe.execute()",
    "query = 'UPDATE users SET enabled = FALSE'\npipe.execute()",
    "query = 'DELETE FROM users'\npipe.execute()",
])
def test_pipeline_flush_does_not_exempt_sql_or_direct_connections(tmp_path, source):
    assert scan(tmp_path, source)


def test_current_presence_service_has_no_raw_database_calls():
    path = Path(__file__).parents[1] / "services" / "user_presence_service.py"
    assert check_file(path) == []
