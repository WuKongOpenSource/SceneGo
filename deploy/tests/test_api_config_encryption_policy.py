from __future__ import annotations

import base64

import pytest
from cryptography.fernet import Fernet

from dao.admin.api_config import (
    ApiConfigDAO,
    ApiConfigEncryptionError,
    validate_api_config_encryption_configuration,
)


def test_development_keeps_legacy_encoding_compatibility(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "development")
    monkeypatch.delenv("API_CONFIG_ENC_KEY", raising=False)

    encoded = ApiConfigDAO._encrypt_key("development-only-placeholder")

    assert encoded == base64.b64encode(b"development-only-placeholder").decode()
    assert ApiConfigDAO._decrypt_key(encoded) == "development-only-placeholder"


def test_production_rejects_missing_encryption_key(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    monkeypatch.delenv("API_CONFIG_ENC_KEY", raising=False)

    with pytest.raises(ApiConfigEncryptionError, match="API_CONFIG_ENC_KEY is missing"):
        validate_api_config_encryption_configuration()
    with pytest.raises(ApiConfigEncryptionError, match="API_CONFIG_ENC_KEY is missing"):
        ApiConfigDAO._encrypt_key("must-not-be-base64")


def test_production_rejects_invalid_encryption_key(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    monkeypatch.setenv("API_CONFIG_ENC_KEY", "not-a-fernet-key")

    with pytest.raises(ApiConfigEncryptionError, match="not a valid Fernet key"):
        validate_api_config_encryption_configuration()


def test_production_encrypts_and_decrypts_with_fernet(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    monkeypatch.setenv("API_CONFIG_ENC_KEY", Fernet.generate_key().decode())

    validate_api_config_encryption_configuration()
    encrypted = ApiConfigDAO._encrypt_key("provider-key-placeholder")

    assert encrypted.startswith("fernet:")
    assert "provider-key-placeholder" not in encrypted
    assert ApiConfigDAO._decrypt_key(encrypted) == "provider-key-placeholder"


def test_production_rejects_fernet_ciphertext_from_another_key(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    first_key = Fernet.generate_key()
    monkeypatch.setenv("API_CONFIG_ENC_KEY", first_key.decode())
    encrypted = ApiConfigDAO._encrypt_key("provider-key-placeholder")

    monkeypatch.setenv("API_CONFIG_ENC_KEY", Fernet.generate_key().decode())
    with pytest.raises(ApiConfigEncryptionError, match="cannot be decrypted"):
        ApiConfigDAO._decrypt_key(encrypted)

