"""Configuration boundaries for the self-hosted CAPTCHA provider."""
import pytest
from services import captcha_service


def test_development_can_disable_verification(monkeypatch):
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "development")
    monkeypatch.delenv("AUTH_CAPTCHA_REQUIRED", raising=False)
    assert captcha_service.public_captcha_config() == {"enabled": False, "provider": None, "site_key": None}


def test_production_requires_a_secret_and_slider_provider(monkeypatch):
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    monkeypatch.setenv("AUTH_CAPTCHA_REQUIRED", "true")
    monkeypatch.delenv("OSTORY_CAPTCHA_SECRET", raising=False)
    monkeypatch.delenv("OSTORY_VERIFICATION_CODE_SECRET", raising=False)
    monkeypatch.setenv("AUTH_CAPTCHA_PROVIDER", "slider")
    with pytest.raises(captcha_service.CaptchaConfigurationError, match="SECRET"):
        captcha_service.load_captcha_settings()
    monkeypatch.setenv("OSTORY_CAPTCHA_SECRET", "test-only-secret-" * 3)
    captcha_service.validate_captcha_configuration()
    monkeypatch.setenv("AUTH_CAPTCHA_PROVIDER", "unsupported")
    with pytest.raises(captcha_service.CaptchaConfigurationError, match="slider"):
        captcha_service.load_captcha_settings()


def test_public_config_does_not_disclose_server_secrets(monkeypatch):
    monkeypatch.setenv("AUTH_CAPTCHA_REQUIRED", "true")
    monkeypatch.setenv("AUTH_CAPTCHA_PROVIDER", "slider")
    monkeypatch.setenv("OSTORY_CAPTCHA_SECRET", "test-only-secret-" * 3)
    assert captcha_service.public_captcha_config() == {"enabled": True, "provider": "slider", "site_key": None}
