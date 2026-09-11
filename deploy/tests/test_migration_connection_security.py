"""Migration entrypoints must enforce the application's transport policy."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from core import db_config_loader
from core.infrastructure_security import InfrastructureSecurityError
from db_build import build_fresh_db
from scripts import apply_migrations as runner


@pytest.fixture(autouse=True)
def isolated_database_settings(monkeypatch, tmp_path):
    # No test may fall back to an operator's actual connection settings.
    for key in (
        "DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_SSLMODE",
        "ALLOW_PASSWORDLESS_LOCAL_DATABASE", "ALLOW_INSECURE_DATABASE_TRANSPORT",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "development")
    monkeypatch.setattr(
        db_config_loader, "DEFAULT_DATABASE_CONFIG_FILE", tmp_path / "unused.env"
    )


@pytest.fixture
def connection_probe(monkeypatch):
    conn = AsyncMock()
    connect = AsyncMock(return_value=conn)
    monkeypatch.setattr(runner.asyncpg, "connect", connect)
    monkeypatch.setattr(runner, "list_migrations", AsyncMock(return_value=[]))
    monkeypatch.setattr(runner, "apply_migrations", AsyncMock(return_value=[]))
    monkeypatch.setattr(build_fresh_db, "apply_migrations", AsyncMock(return_value=[]))
    return connect, conn


async def invoke(entrypoint, *extra_args):
    if entrypoint == "fresh":
        return await build_fresh_db.run([])
    if entrypoint == "status":
        return await runner.async_main(runner.build_parser().parse_args(["--status", *extra_args]))
    return await runner.async_main(runner.build_parser().parse_args(["fixture.sql", *extra_args]))


@pytest.mark.parametrize("entrypoint", ["fresh", "status", "migrate"])
@pytest.mark.parametrize(
    "host,configured,expected",
    [
        ("localhost", "", "disable"),
        ("127.0.0.1", "", "disable"),
        ("db.example.test", "", "verify-full"),
        ("db.example.test", " VERIFY-FULL ", "verify-full"),
        ("localhost", "require", "require"),
    ],
)
async def test_entrypoints_pass_normalized_ssl_to_asyncpg(
    entrypoint, host, configured, expected, monkeypatch, connection_probe
):
    monkeypatch.setenv("DB_HOST", host)
    monkeypatch.setenv("DB_SSLMODE", configured)
    monkeypatch.setenv("DB_PORT", "15432")
    monkeypatch.setenv("DB_NAME", "fixture_db")
    monkeypatch.setenv("DB_USER", "fixture_user")
    monkeypatch.setenv("DB_PASSWORD", "test-only")

    assert await invoke(entrypoint) == 0
    connect, conn = connection_probe
    connect.assert_awaited_once_with(
        host=host, port=15432, database="fixture_db", user="fixture_user",
        password="test-only", ssl=expected,
    )
    conn.close.assert_awaited_once()


@pytest.mark.parametrize("entrypoint", ["fresh", "status", "migrate"])
@pytest.mark.parametrize(
    "runtime,password,mode,error",
    [
        ("development", "test-only", "invalid", "DB_SSLMODE"),
        ("production", "test-only", "require", "verify-full"),
        ("production", "test-only", "disable", "verify-full"),
        ("production", "", "verify-full", "DB_PASSWORD"),
    ],
)
async def test_invalid_security_settings_fail_before_connect(
    entrypoint, runtime, password, mode, error, monkeypatch, connection_probe
):
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", runtime)
    monkeypatch.setenv("DB_HOST", "db.example.test")
    monkeypatch.setenv("DB_PASSWORD", password)
    monkeypatch.setenv("DB_SSLMODE", mode)
    with pytest.raises(InfrastructureSecurityError, match=error):
        await invoke(entrypoint)
    connection_probe[0].assert_not_awaited()
    connection_probe[1].close.assert_not_awaited()


@pytest.mark.parametrize("entrypoint", ["fresh", "status", "migrate"])
async def test_explicit_reviewed_transport_override_is_preserved(
    entrypoint, monkeypatch, connection_probe
):
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    monkeypatch.setenv("DB_HOST", "db.example.test")
    monkeypatch.setenv("DB_PASSWORD", "test-only")
    monkeypatch.setenv("DB_SSLMODE", "require")
    monkeypatch.setenv("ALLOW_INSECURE_DATABASE_TRANSPORT", "true")
    assert await invoke(entrypoint) == 0
    assert connection_probe[0].await_args.kwargs["ssl"] == "require"


@pytest.mark.parametrize("process_mode", [None, "", "verify-full"])
async def test_fresh_builder_ssl_file_value_and_process_priority(
    process_mode, monkeypatch, tmp_path, connection_probe
):
    config = tmp_path / "database.env"
    config.write_text("DB_HOST=localhost\nDB_SSLMODE=require\n", encoding="utf-8")
    monkeypatch.setattr(db_config_loader, "DEFAULT_DATABASE_CONFIG_FILE", config)
    if process_mode is not None:
        monkeypatch.setenv("DB_SSLMODE", process_mode)
    assert await invoke("fresh") == 0
    expected = "require" if process_mode is None else (process_mode or "disable")
    assert connection_probe[0].await_args.kwargs["ssl"] == expected


@pytest.mark.parametrize("process_mode", [None, "", "verify-full"])
async def test_migration_explicit_env_file_and_process_priority(
    process_mode, monkeypatch, tmp_path, connection_probe
):
    first = tmp_path / "first.env"
    second = tmp_path / "second.env"
    first.write_text("DB_SSLMODE='require'\n", encoding="utf-8")
    second.write_text("DB_SSLMODE=disable\n", encoding="utf-8")
    # Register undo for setdefault mutations made by the CLI's env loader.
    monkeypatch.setenv("DB_SSLMODE", process_mode or "")
    if process_mode is None:
        monkeypatch.delenv("DB_SSLMODE")
    assert await invoke("status", "--env", str(first), "--env", str(second)) == 0
    expected = "require" if process_mode is None else (process_mode or "disable")
    assert connection_probe[0].await_args.kwargs["ssl"] == expected


async def test_migration_does_not_implicitly_load_application_config(
    monkeypatch, tmp_path, connection_probe
):
    config = tmp_path / "application.env"
    config.write_text("DB_HOST=unselected.example.test\nDB_SSLMODE=require\n", encoding="utf-8")
    monkeypatch.setattr(db_config_loader, "DEFAULT_DATABASE_CONFIG_FILE", config)
    assert await invoke("status") == 0
    params = connection_probe[0].await_args.kwargs
    assert params["host"] == "localhost"
    assert params["ssl"] == "disable"


def test_manifest_check_is_offline_even_with_invalid_database_security(monkeypatch, connection_probe):
    monkeypatch.setenv("DB_SSLMODE", "invalid")
    monkeypatch.setattr(build_fresh_db.sys, "argv", ["build_fresh_db.py", "--check"])
    assert build_fresh_db.main() == 0
    connection_probe[0].assert_not_awaited()
