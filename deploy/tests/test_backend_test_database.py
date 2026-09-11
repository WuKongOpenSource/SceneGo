"""The integration harness must not inherit application databases or leak state."""
import asyncio
from unittest.mock import AsyncMock, Mock

import pytest

import backend_test_database as support
import conftest as fixtures


TEST_URL = "postgresql://fixture_user:fixture-password@127.0.0.1:25432/ostory_test"


def test_application_and_libpq_settings_never_opt_in_to_database_tests():
    assert support.load_test_database_config({
        "DB_HOST": "production.example.test", "DB_NAME": "business", "DB_PASSWORD": "private",
        "DATABASE_URL": "postgresql://user:private@production.example.test/business",
        "PGHOST": "production.example.test", "PGDATABASE": "business", "PGPASSWORD": "private",
    }) is None


@pytest.mark.parametrize("required", ["true", "1", "YES", " on "])
def test_required_database_without_explicit_configuration_fails(required):
    with pytest.raises(support.TestDatabaseConfigurationError, match="requires an explicit"):
        support.load_test_database_config({"OSTORY_REQUIRE_TEST_DB": required})


@pytest.mark.parametrize("required", ["treu", "required", "false extra"])
def test_misspelled_required_flag_cannot_silently_disable_integration_tests(required):
    with pytest.raises(support.TestDatabaseConfigurationError, match="explicit boolean"):
        support.load_test_database_config({"OSTORY_REQUIRE_TEST_DB": required})


def test_explicit_connection_fields_and_timeouts_override_inherited_defaults():
    config = support.load_test_database_config({"OSTORY_TEST_DATABASE_URL": TEST_URL})
    assert config.connection_kwargs() == {
        "host": "127.0.0.1", "port": 25432, "database": "ostory_test", "user": "fixture_user",
        "password": "fixture-password", "ssl": "disable", "timeout": 10, "command_timeout": 30,
    }
    assert "fixture-password" not in repr(config)


@pytest.mark.parametrize("url, host, database", [
    ("postgres://fixture:pass@localhost/test_ci", "localhost", "test_ci"),
    ("postgresql://fixture:pass@[::1]:25432/ostory_test_ci", "::1", "ostory_test_ci"),
    ("postgresql://fixture:pass@127.0.0.1/test", "127.0.0.1", "test"),
])
def test_local_test_database_names_are_supported(url, host, database):
    config = support.load_test_database_config({"OSTORY_TEST_DATABASE_URL": url})
    assert config.host == host and config.database == database


@pytest.mark.parametrize("mode", ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"])
def test_explicit_tls_mode_is_preserved(mode):
    config = support.load_test_database_config({"OSTORY_TEST_DATABASE_URL": TEST_URL + "?sslmode=" + mode})
    assert config.ssl == mode


@pytest.mark.parametrize("url", [
    "http://fixture:pass@127.0.0.1/ostory_test",
    "postgresql://fixture:pass@production.example.test/ostory_test",
    "postgresql://fixture:pass@10.0.0.1/ostory_test",
    "postgresql://fixture:pass@127.0.0.1/business",
    "postgresql://fixture:pass@127.0.0.1/latest",
    "postgresql://fixture:pass@127.0.0.1/ostory_test/extra",
    "postgresql://fixture:pass@127.0.0.1/ostory_test%2Fextra",
    "postgresql://fixture@127.0.0.1/ostory_test",
    "postgresql://:pass@127.0.0.1/ostory_test",
    "postgresql://fixture:pass@127.0.0.1:0/ostory_test",
    "postgresql://fixture:pass@127.0.0.1:65536/ostory_test",
    "postgresql://fixture:pass@127.0.0.1:bad/ostory_test",
    "postgresql://fixture:pass@[::1/ostory_test",
    TEST_URL + "?host=production.example.test",
    TEST_URL + "?database=business",
    TEST_URL + "?options=unsafe",
    TEST_URL + "?sslmode=invalid",
    TEST_URL + "?sslmode=disable&sslmode=require",
    TEST_URL + "?sslmode",
    TEST_URL + "#fragment",
    "postgresql://fixture:pass%0Aword@127.0.0.1/ostory_test",
])
def test_unsafe_or_ambiguous_database_urls_fail_without_echoing_credentials(url):
    with pytest.raises(support.TestDatabaseConfigurationError) as error:
        support.load_test_database_config({"OSTORY_TEST_DATABASE_URL": url})
    assert url not in str(error.value)
    assert "fixture-password" not in str(error.value)
    assert error.value.__cause__ is None


def connection_and_manager():
    transaction = Mock(start=AsyncMock(), rollback=AsyncMock())
    connection = Mock(transaction=Mock(return_value=transaction), close=AsyncMock(), is_closed=Mock(return_value=False))
    manager = fixtures._TransactionalTestDatabaseManager()
    return connection, transaction, manager


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [None, "transaction", "start", "seed", "body", "rollback", "close"])
async def test_cleanup_covers_setup_body_and_teardown_failures(failure):
    connection, transaction, manager = connection_and_manager()
    if failure in {"transaction", "close"}:
        getattr(connection, failure).side_effect = RuntimeError(failure)
    if failure in {"start", "rollback"}:
        getattr(transaction, failure).side_effect = RuntimeError(failure)

    async def exercise():
        async with support.isolated_test_transaction(connection, manager):
            assert manager._require_connection() is connection
            if failure in {"seed", "body"}:
                raise RuntimeError(failure)

    if failure:
        with pytest.raises(RuntimeError, match=failure):
            await exercise()
    else:
        await exercise()
    connection.close.assert_awaited_once_with(timeout=5)
    assert manager.connection is None
    assert transaction.rollback.await_count == (0 if failure in {"transaction", "start"} else 1)


@pytest.mark.asyncio
async def test_closed_connection_is_unbound_without_attempting_rollback():
    connection, transaction, manager = connection_and_manager()
    async with support.isolated_test_transaction(connection, manager):
        connection.is_closed.return_value = True
    transaction.rollback.assert_not_awaited()
    connection.close.assert_awaited_once_with(timeout=5)
    assert manager.connection is None


@pytest.mark.asyncio
async def test_real_fixture_does_not_connect_when_only_application_config_exists(monkeypatch):
    monkeypatch.delenv("OSTORY_TEST_DATABASE_URL", raising=False)
    monkeypatch.delenv("OSTORY_REQUIRE_TEST_DB", raising=False)
    monkeypatch.setenv("DB_HOST", "production.example.test")
    connect = AsyncMock()
    monkeypatch.setattr(fixtures.asyncpg, "connect", connect)
    fixture = fixtures.test_db.__wrapped__(monkeypatch)
    with pytest.raises(pytest.skip.Exception, match="dedicated"):
        await anext(fixture)
    connect.assert_not_awaited()


@pytest.mark.asyncio
async def test_real_fixture_closes_connection_when_parent_seed_fails(monkeypatch):
    connection, transaction, manager = connection_and_manager()
    monkeypatch.setenv("OSTORY_TEST_DATABASE_URL", TEST_URL)
    monkeypatch.setattr(fixtures, "_test_db_manager", manager)
    monkeypatch.setattr(fixtures, "_test_db_unavailable_reason", None)
    monkeypatch.setattr(fixtures.asyncpg, "connect", AsyncMock(return_value=connection))
    monkeypatch.setattr(fixtures, "_seed_test_parents", AsyncMock(side_effect=RuntimeError("seed failed")))
    fixture = fixtures.test_db.__wrapped__(monkeypatch)
    with pytest.raises(RuntimeError, match="seed failed"):
        await anext(fixture)
    transaction.rollback.assert_awaited_once()
    connection.close.assert_awaited_once_with(timeout=5)
    assert manager.connection is None


@pytest.mark.asyncio
async def test_required_database_does_not_silently_skip_cached_connection_failure(monkeypatch):
    monkeypatch.setenv("OSTORY_TEST_DATABASE_URL", TEST_URL)
    monkeypatch.setenv("OSTORY_REQUIRE_TEST_DB", "true")
    config = support.load_test_database_config()
    monkeypatch.setattr(fixtures, "_test_db_unavailable_config", config)
    monkeypatch.setattr(fixtures, "_test_db_unavailable_reason", "Dedicated database unavailable")
    fixture = fixtures.test_db.__wrapped__(monkeypatch)
    with pytest.raises(pytest.fail.Exception, match="unavailable"):
        await anext(fixture)


@pytest.mark.asyncio
async def test_cancelled_test_still_rolls_back_and_closes_its_connection():
    connection, transaction, manager = connection_and_manager()
    with pytest.raises(asyncio.CancelledError):
        async with support.isolated_test_transaction(connection, manager):
            raise asyncio.CancelledError()
    transaction.rollback.assert_awaited_once()
    connection.close.assert_awaited_once_with(timeout=5)
    assert manager.connection is None


@pytest.mark.asyncio
@pytest.mark.parametrize("required", [True, False])
async def test_connection_failure_suppresses_sensitive_exception_details(monkeypatch, required):
    monkeypatch.setenv("OSTORY_TEST_DATABASE_URL", TEST_URL)
    monkeypatch.setenv("OSTORY_REQUIRE_TEST_DB", str(required))
    monkeypatch.setattr(fixtures, "_test_db_unavailable_reason", None)
    monkeypatch.setattr(fixtures, "_test_db_unavailable_config", None)
    monkeypatch.setattr(fixtures.asyncpg, "connect", AsyncMock(side_effect=OSError("private connection details")))
    fixture = fixtures.test_db.__wrapped__(monkeypatch)
    expected = pytest.fail.Exception if required else pytest.skip.Exception
    with pytest.raises(expected) as error:
        await anext(fixture)
    assert "OSError" in str(error.value)
    assert "private connection details" not in str(error.value)
    assert error.value.__suppress_context__ is True


@pytest.mark.asyncio
async def test_an_explicitly_changed_database_retries_instead_of_using_a_stale_skip(monkeypatch):
    old_config = support.load_test_database_config({"OSTORY_TEST_DATABASE_URL": TEST_URL})
    monkeypatch.setattr(fixtures, "_test_db_unavailable_config", old_config)
    monkeypatch.setattr(fixtures, "_test_db_unavailable_reason", "Previously unavailable")
    monkeypatch.setenv("OSTORY_TEST_DATABASE_URL", TEST_URL.replace(":25432/", ":25433/"))
    connection, transaction, manager = connection_and_manager()
    connect = AsyncMock(return_value=connection)
    monkeypatch.setattr(fixtures.asyncpg, "connect", connect)
    monkeypatch.setattr(fixtures, "_test_db_manager", manager)
    monkeypatch.setattr(fixtures, "_seed_test_parents", AsyncMock())
    fixture = fixtures.test_db.__wrapped__(monkeypatch)
    assert await anext(fixture) is connection
    await fixture.aclose()
    assert connect.await_args.kwargs["port"] == 25433
    transaction.rollback.assert_awaited_once()
    assert manager.connection is None


@pytest.mark.asyncio
@pytest.mark.parametrize("status, body", [(401, {}), (200, {"session_mode": "cookie"})])
async def test_auth_headers_never_substitute_a_fake_token(status, body):
    client = Mock(post=AsyncMock(return_value=Mock(status_code=status, json=Mock(return_value=body))))
    with pytest.raises(pytest.fail.Exception, match="did not return a token"):
        await fixtures.auth_headers.__wrapped__(client)


@pytest.mark.asyncio
async def test_auth_headers_explicitly_request_the_api_bearer_mode():
    client = Mock(post=AsyncMock(return_value=Mock(status_code=200, json=Mock(return_value={"token": "test-token"}))))
    assert await fixtures.auth_headers.__wrapped__(client) == {"Authorization": "Bearer test-token"}
    assert client.post.await_args.kwargs["headers"] == {"X-Ostory-Session-Mode": "bearer"}


@pytest.mark.asyncio
async def test_shared_http_fixture_uses_the_public_application():
    import public_main

    fixture = fixtures.client.__wrapped__(None)
    client = await anext(fixture)
    try:
        assert client._transport.app is public_main.app
    finally:
        await fixture.aclose()
