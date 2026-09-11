from services import binding_token_service as svc


def test_binding_token_is_scoped_and_tamper_evident(monkeypatch):
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "development")
    token = svc.create_binding_token("user_123", ttl_seconds=60)

    assert token.startswith("bind.")
    assert svc.verify_binding_token(token) == "user_123"
    assert svc.verify_binding_token(token + "x") is None


def test_production_binding_token_requires_random_secret(monkeypatch):
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "production")
    monkeypatch.delenv("OSTORY_VERIFICATION_CODE_SECRET", raising=False)

    try:
        svc.create_binding_token("user_123")
    except RuntimeError as exc:
        assert "at least 32 characters" in str(exc)
    else:
        raise AssertionError("production must fail closed without a verification secret")
