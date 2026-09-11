from __future__ import annotations

import pytest

from core import jwt_auth


def test_production_requires_explicit_jwt_secret(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)

    with pytest.raises(jwt_auth.JwtConfigurationError, match="JWT_SECRET_KEY is required"):
        jwt_auth._resolve_secret()


def test_production_rejects_short_jwt_secret(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    monkeypatch.setenv("JWT_SECRET_KEY", "too-short")

    with pytest.raises(jwt_auth.JwtConfigurationError, match="at least 32 bytes"):
        jwt_auth._resolve_secret()


def test_production_accepts_strong_jwt_secret(monkeypatch) -> None:
    expected = "a-unique-production-secret-with-more-than-32-bytes"
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    monkeypatch.setenv("JWT_SECRET_KEY", expected)

    assert jwt_auth._resolve_secret() == expected


def test_token_carries_session_version_and_rejects_invalid_version() -> None:
    jwt_auth.init("unit-test-signing-secret")
    token = jwt_auth.create_token("user-1", session_version=7)

    assert jwt_auth.verify_token(token) == "user-1"
    assert jwt_auth.verify_token_claims(token)["sv"] == 7

    with pytest.raises(ValueError, match="positive integer"):
        jwt_auth.create_token("user-1", session_version=0)


def test_token_operations_lazily_initialize_a_missing_signing_state(monkeypatch) -> None:
    signing_material = "lazy-init-" + ("abcdefghijklmnopqrstuvwx" * 2)
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    monkeypatch.setenv("JWT_SECRET_KEY", signing_material)
    monkeypatch.setattr(jwt_auth, "_secret_key", "")

    token = jwt_auth.create_token("user-1", session_version=2)

    assert jwt_auth.verify_token(token) == "user-1"
    assert len(jwt_auth._secret_key) == len(signing_material)
