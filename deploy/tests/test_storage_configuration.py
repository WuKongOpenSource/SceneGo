from __future__ import annotations

import pytest

from utils.storage_manager import StorageConfig, StorageConfigurationError


def _configure_valid_minio(monkeypatch) -> None:
    monkeypatch.setattr(StorageConfig, "MINIO_ENDPOINT", "minio.internal:9000")
    monkeypatch.setattr(StorageConfig, "MINIO_ACCESS_KEY", "ostory-service")
    monkeypatch.setattr(StorageConfig, "MINIO_SECRET_KEY", "a-long-random-storage-secret")
    monkeypatch.setattr(StorageConfig, "MINIO_BUCKET", "ostory-media")
    monkeypatch.setattr(StorageConfig, "MINIO_SECURE", True)


def test_local_storage_does_not_require_minio_configuration(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")

    StorageConfig.validate("local")


def test_production_minio_rejects_default_credentials(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    _configure_valid_minio(monkeypatch)
    monkeypatch.setattr(StorageConfig, "MINIO_ACCESS_KEY", "minioadmin")

    with pytest.raises(StorageConfigurationError, match="MINIO_ACCESS_KEY"):
        StorageConfig.validate("minio")


def test_production_minio_requires_tls_for_remote_endpoint(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    _configure_valid_minio(monkeypatch)
    monkeypatch.setattr(StorageConfig, "MINIO_SECURE", False)

    with pytest.raises(StorageConfigurationError, match="MINIO_SECURE=true"):
        StorageConfig.validate("minio")


def test_production_minio_allows_loopback_without_tls(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    _configure_valid_minio(monkeypatch)
    monkeypatch.setattr(StorageConfig, "MINIO_ENDPOINT", "127.0.0.1:9000")
    monkeypatch.setattr(StorageConfig, "MINIO_SECURE", False)

    StorageConfig.validate("minio")


def test_production_minio_accepts_explicit_secure_configuration(monkeypatch) -> None:
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    _configure_valid_minio(monkeypatch)

    StorageConfig.validate("minio")
