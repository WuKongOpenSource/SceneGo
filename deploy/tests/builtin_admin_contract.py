"""Both entrypoints must fail closed for invalid bootstrap credentials."""
import pytest


class BuiltinAdminContract:
    @pytest.fixture(autouse=True)
    def clean_bootstrap_environment(self, monkeypatch):
        for key in ("OSTORY_BUILTIN_ADMIN_USERNAME", "ADMIN_PASSWORD", "ALLOW_DEV_ADMIN_PASSWORD"):
            monkeypatch.delenv(key, raising=False)
        monkeypatch.setenv("OSTORY_RUNTIME_ENV", "development")

    def test_builtin_bootstrap_uses_explicit_username(self, monkeypatch):
        monkeypatch.setenv("OSTORY_BUILTIN_ADMIN_USERNAME", "installation-owner")
        monkeypatch.setenv("ADMIN_PASSWORD", "temporary-random-password")
        monkeypatch.delenv("ALLOW_DEV_ADMIN_PASSWORD", raising=False)
        assert self.load_users() == {"installation-owner": "temporary-random-password"}

    def test_empty_builtin_username_disables_environment_password(self, monkeypatch):
        monkeypatch.setenv("OSTORY_BUILTIN_ADMIN_USERNAME", "   ")
        monkeypatch.setenv("ADMIN_PASSWORD", "temporary-random-password")
        assert self.load_users() == {}

    @pytest.mark.parametrize("username,password", [("owner", "short"), ("   ", "temporary-random-password")])
    def test_invalid_explicit_credentials_never_fall_back_to_development_password(self, monkeypatch, username, password):
        monkeypatch.setenv("OSTORY_BUILTIN_ADMIN_USERNAME", username)
        monkeypatch.setenv("ADMIN_PASSWORD", password)
        monkeypatch.setenv("ALLOW_DEV_ADMIN_PASSWORD", "true")
        assert self.load_users() == {}

    @pytest.mark.parametrize("runtime", ["production", "PRODUCTION", " Production "])
    def test_production_never_uses_development_password(self, monkeypatch, runtime):
        monkeypatch.setenv("OSTORY_RUNTIME_ENV", runtime)
        monkeypatch.setenv("ALLOW_DEV_ADMIN_PASSWORD", "true")
        assert self.load_users() == {}

    @pytest.mark.parametrize("enabled", ["1", "true", "yes", "on", " TRUE "])
    def test_explicit_development_opt_in_keeps_existing_credentials(self, monkeypatch, enabled):
        monkeypatch.setenv("ALLOW_DEV_ADMIN_PASSWORD", enabled)
        assert self.load_users() == {"admin": "admin123"}

    def test_no_configuration_creates_no_builtin_credentials(self):
        assert self.load_users() == {}

    def test_production_preserves_valid_explicit_credentials(self, monkeypatch):
        monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
        monkeypatch.setenv("OSTORY_BUILTIN_ADMIN_USERNAME", "installation-owner")
        monkeypatch.setenv("ADMIN_PASSWORD", "temporary-random-password")
        monkeypatch.setenv("ALLOW_DEV_ADMIN_PASSWORD", "true")
        assert self.load_users() == {"installation-owner": "temporary-random-password"}
