"""Explicit, local-only database configuration and transaction cleanup for tests."""
from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass, field
import os
import re
from typing import Mapping
from urllib.parse import parse_qs, unquote, urlsplit


class TestDatabaseConfigurationError(ValueError):
    __test__ = False


@dataclass(frozen=True)
class TestDatabaseConfig:
    __test__ = False

    host: str
    port: int
    database: str
    user: str
    password: str = field(repr=False)
    ssl: str = "disable"

    def connection_kwargs(self) -> dict[str, str | int]:
        # Explicit fields prevent asyncpg from falling back to PG* or app env.
        return {
            "host": self.host,
            "port": self.port,
            "database": self.database,
            "user": self.user,
            "password": self.password,
            "ssl": self.ssl,
            "timeout": 10,
            "command_timeout": 30,
        }


def test_database_required(environ: Mapping[str, str] | None = None) -> bool:
    env = os.environ if environ is None else environ
    value = env.get("OSTORY_REQUIRE_TEST_DB", "").strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"", "0", "false", "no", "off"}:
        return False
    raise TestDatabaseConfigurationError("OSTORY_REQUIRE_TEST_DB must be an explicit boolean.")


def load_test_database_config(environ: Mapping[str, str] | None = None) -> TestDatabaseConfig | None:
    env = os.environ if environ is None else environ
    required = test_database_required(env)
    value = env.get("OSTORY_TEST_DATABASE_URL", "").strip()
    if not value:
        if required:
            raise TestDatabaseConfigurationError(
                "OSTORY_REQUIRE_TEST_DB requires an explicit OSTORY_TEST_DATABASE_URL."
            )
        return None
    try:
        url = urlsplit(value)
        host = url.hostname
        port = url.port if url.port is not None else 5432
        database = unquote(url.path.removeprefix("/"))
        user = unquote(url.username or "")
        password = unquote(url.password or "")
        query = parse_qs(url.query, keep_blank_values=True, strict_parsing=True)
        valid = (
            url.scheme in {"postgresql", "postgres"}
            and host in {"127.0.0.1", "localhost", "::1"}
            and 1 <= port <= 65535
            and bool(re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", database))
            and "test" in database.lower().split("_")
            and bool(user)
            and url.password is not None
            and not url.fragment
            and set(query) <= {"sslmode"}
            and all(len(values) == 1 for values in query.values())
            and not any(ord(char) < 32 for char in value + user + password)
        )
        ssl = query.get("sslmode", ["disable"])[0]
        valid = valid and ssl in {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}
    except (ValueError, TypeError):
        valid = False
    if not valid:
        # URLs may contain passwords: never include the value or parser error.
        raise TestDatabaseConfigurationError(
            "OSTORY_TEST_DATABASE_URL must use PostgreSQL on loopback, explicit user/password, "
            "and a database name with a separate 'test' segment; only sslmode is allowed in its query."
        ) from None
    return TestDatabaseConfig(host, port, database, user, password, ssl)


@asynccontextmanager
async def isolated_test_transaction(connection, manager):
    """Close an owned connection even if setup, rollback, or the test body fails."""
    transaction = None
    started = False
    try:
        transaction = connection.transaction()
        await transaction.start()
        started = True
        manager.bind(connection)
        yield connection
    finally:
        try:
            if started and not connection.is_closed():
                await transaction.rollback()
        finally:
            try:
                manager.unbind(connection)
            finally:
                await connection.close(timeout=5)
