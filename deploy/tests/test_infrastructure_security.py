from __future__ import annotations

import pytest

from core.infrastructure_security import (
    InfrastructureSecurityError,
    is_loopback_host,
    validate_database_security,
    validate_redis_security,
)


def test_loopback_detection_does_not_trust_similar_hostnames() -> None:
    assert is_loopback_host("localhost")
    assert is_loopback_host("127.0.0.1")
    assert is_loopback_host("::1")
    assert not is_loopback_host("localhost.example.org")
    assert not is_loopback_host("10.0.0.5")


def test_development_database_keeps_manual_local_setup_compatible() -> None:
    assert validate_database_security(
        host="localhost",
        password="",
        environ={"OSTORY_RUNTIME_ENV": "development"},
    ) == "disable"


def test_production_database_requires_password_by_default() -> None:
    with pytest.raises(InfrastructureSecurityError, match="DB_PASSWORD"):
        validate_database_security(
            host="localhost",
            password="",
            environ={"OSTORY_RUNTIME_ENV": "production"},
        )


def test_remote_production_database_requires_identity_verified_tls() -> None:
    with pytest.raises(InfrastructureSecurityError, match="verify-full"):
        validate_database_security(
            host="db.internal.example",
            password="<TEST_ONLY_PASSWORD>",
            ssl_mode="require",
            environ={"OSTORY_RUNTIME_ENV": "production"},
        )
    assert validate_database_security(
        host="db.internal.example",
        password="<TEST_ONLY_PASSWORD>",
        ssl_mode="verify-full",
        environ={"OSTORY_RUNTIME_ENV": "production"},
    ) == "verify-full"


def test_remote_production_redis_requires_password_and_tls() -> None:
    with pytest.raises(InfrastructureSecurityError, match="REDIS_PASSWORD"):
        validate_redis_security(
            host="redis.internal.example",
            password=None,
            tls_enabled=False,
            environ={"OSTORY_RUNTIME_ENV": "production"},
        )
    with pytest.raises(InfrastructureSecurityError, match="REDIS_SSL"):
        validate_redis_security(
            host="redis.internal.example",
            password="<TEST_ONLY_PASSWORD>",
            tls_enabled=False,
            environ={"OSTORY_RUNTIME_ENV": "production"},
        )
    validate_redis_security(
        host="redis.internal.example",
        password="<TEST_ONLY_PASSWORD>",
        tls_enabled=True,
        environ={"OSTORY_RUNTIME_ENV": "production"},
    )
