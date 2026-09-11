import pytest

from core.runtime_config import parse_cors_allow_origins


def test_production_default_cors_requires_explicit_cross_origin_hosts(monkeypatch):
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    monkeypatch.delenv("CORS_ALLOW_ORIGINS", raising=False)

    assert parse_cors_allow_origins() == []


def test_explicit_cors_allowlist_is_normalized(monkeypatch):
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")

    assert parse_cors_allow_origins(" https://example.com/,https://two.example ") == [
        "https://example.com",
        "https://two.example",
    ]


@pytest.mark.parametrize("runtime", ["development", "production"])
def test_explicit_empty_cors_does_not_restore_development_defaults(monkeypatch, runtime):
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", runtime)
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", " , ")
    assert parse_cors_allow_origins() == []


def test_development_defaults_are_only_local_origins(monkeypatch):
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "development")
    monkeypatch.delenv("CORS_ALLOW_ORIGINS", raising=False)
    assert parse_cors_allow_origins() == [
        "http://localhost:6006", "http://127.0.0.1:6006",
        "http://localhost:5173", "http://127.0.0.1:5173",
    ]
