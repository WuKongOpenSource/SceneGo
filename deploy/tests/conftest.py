


import pytest
import os
import sys
import asyncpg
from contextlib import asynccontextmanager
from httpx import AsyncClient, ASGITransport
from backend_test_database import (
    isolated_test_transaction,
    load_test_database_config,
    test_database_required,
)


os.environ.setdefault("ALLOW_DEV_ADMIN_PASSWORD", "true")


_test_db_unavailable_reason = None
_test_db_unavailable_config = None


class _TransactionalTestDatabaseManager:
    """Route DAO calls through the fixture transaction instead of a global pool."""

    def __init__(self):
        self.connection = None

    def bind(self, connection):
        self.connection = connection

    def unbind(self, connection):
        if self.connection is connection:
            self.connection = None

    def _require_connection(self):
        if self.connection is None or self.connection.is_closed():
            raise RuntimeError("The test database transaction is not active")
        return self.connection

    @asynccontextmanager
    async def acquire(self):
        yield self._require_connection()

    async def execute(self, query, *args):
        return await self._require_connection().execute(query, *args)

    async def fetch(self, query, *args):
        rows = await self._require_connection().fetch(query, *args)
        return [dict(row) for row in rows]

    async def fetchrow(self, query, *args):
        row = await self._require_connection().fetchrow(query, *args)
        return dict(row) if row else None

    async def fetchval(self, query, *args):
        return await self._require_connection().fetchval(query, *args)


_test_db_manager = _TransactionalTestDatabaseManager()


async def _seed_test_parents(conn):
    """Create the minimal parent records required by DAO integration tests."""
    await conn.execute(
        """
        INSERT INTO users (user_id, username, password_hash)
        VALUES ('user_dao_fixture', 'dao_fixture_user', 'test-only')
        ON CONFLICT (user_id) DO NOTHING
        """
    )
    for project_id in ("proj_test1", "proj_1", "proj_A"):
        await conn.execute(
            """
            INSERT INTO projects (project_id, user_id, project_name)
            VALUES ($1, 'user_dao_fixture', $2)
            ON CONFLICT (project_id) DO NOTHING
            """,
            project_id,
            f"DAO fixture {project_id}",
        )
    for episode_id, episode_number in (("ep_1", 1), ("ep_test1", 2)):
        await conn.execute(
            """
            INSERT INTO episodes (
                episode_id, project_id, episode_number, episode_name
            )
            VALUES ($1, 'proj_1', $2, $3)
            ON CONFLICT (episode_id) DO NOTHING
            """,
            episode_id,
            episode_number,
            f"DAO fixture {episode_id}",
        )
    for item_id, sort_order in (("sb_001", -2), ("sb_005", -1)):
        await conn.execute(
            """
            INSERT INTO storyboard_items (item_id, episode_id, sort_order)
            VALUES ($1, 'ep_1', $2)
            ON CONFLICT (item_id) DO NOTHING
            """,
            item_id,
            sort_order,
        )


@pytest.fixture
async def test_db(monkeypatch):
    global _test_db_unavailable_reason, _test_db_unavailable_config
    config = load_test_database_config()
    if config is None:
        pytest.skip("Database integration requires a dedicated OSTORY_TEST_DATABASE_URL; application DB settings are never used.")
    required = test_database_required()
    if _test_db_unavailable_reason and _test_db_unavailable_config == config:
        if required:
            pytest.fail(_test_db_unavailable_reason)
        pytest.skip(_test_db_unavailable_reason)
    try:
        conn = await asyncpg.connect(**config.connection_kwargs())
    except (OSError, asyncpg.PostgresError, TimeoutError) as exc:
        reason = f"Dedicated PostgreSQL integration database unavailable ({type(exc).__name__}); connection details omitted."
        if required:
            raise pytest.fail.Exception(reason, pytrace=False) from None
        _test_db_unavailable_reason = reason
        _test_db_unavailable_config = config
        raise pytest.skip.Exception(reason) from None
    async with isolated_test_transaction(conn, _test_db_manager):
        await _seed_test_parents(conn)

        # Cached DAO imports share a proxy, never a connection from a prior test.
        import core.db_manager as core_db_manager
        import db_manager as legacy_db_manager

        monkeypatch.setattr(core_db_manager, "get_db_manager", lambda: _test_db_manager)
        monkeypatch.setattr(legacy_db_manager, "get_db_manager", lambda: _test_db_manager)
        for module_name, module in list(sys.modules.items()):
            if not module_name.startswith("dao") or module is None:
                continue
            if hasattr(module, "get_db_manager"):
                monkeypatch.setattr(module, "get_db_manager", lambda: _test_db_manager)
        yield conn


@pytest.fixture
async def client(test_db):

    # Shared fixtures must remain usable when the private entrypoint is absent.
    from public_main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def auth_headers(client):

    resp = await client.post("/api/login", headers={"X-Ostory-Session-Mode": "bearer"}, json={
        "username": "admin",
        "password": "admin123"
    })
    if resp.status_code == 200 and resp.json().get("token"):
        return {"Authorization": f"Bearer {resp.json()['token']}"}
    pytest.fail("Test administrator login did not return a token; seed an explicit test account instead of using a fake fallback.")
