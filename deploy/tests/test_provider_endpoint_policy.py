import socket

import pytest

from services import provider_endpoint_policy as policy


def test_development_allows_local_http_provider() -> None:
    assert policy.validate_provider_endpoint(
        "http://127.0.0.1:9000/v1",
        environ={"OSTORY_RUNTIME_ENV": "development"},
    ) == "http://127.0.0.1:9000/v1"


@pytest.mark.parametrize(
    "value",
    [
        "file:///etc/passwd",
        "https://user:secret@example.com/v1",
        "https://example.com/v1#fragment",
        "https://example.com:99999/v1",
    ],
)
def test_provider_endpoint_rejects_ambiguous_or_credential_bearing_urls(value: str) -> None:
    with pytest.raises(policy.ProviderEndpointPolicyError):
        policy.validate_provider_endpoint(value, environ={"OSTORY_RUNTIME_ENV": "development"})


def test_production_requires_https() -> None:
    with pytest.raises(policy.ProviderEndpointPolicyError, match="HTTPS"):
        policy.validate_provider_endpoint(
            "http://203.0.113.10/v1",
            environ={"OSTORY_RUNTIME_ENV": "production"},
        )


def test_production_rejects_private_provider_address() -> None:
    with pytest.raises(policy.ProviderEndpointPolicyError, match="public addresses"):
        policy.validate_provider_endpoint(
            "https://127.0.0.1/v1",
            environ={"OSTORY_RUNTIME_ENV": "production"},
        )


def test_production_private_provider_requires_explicit_opt_in() -> None:
    value = policy.validate_provider_endpoint(
        "https://127.0.0.1/v1",
        environ={
            "OSTORY_RUNTIME_ENV": "production",
            "ALLOW_PRIVATE_PROVIDER_ENDPOINTS": "true",
        },
    )
    assert value == "https://127.0.0.1/v1"


def test_production_rejects_hostname_when_any_dns_answer_is_private(monkeypatch) -> None:
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.7", 443)),
        ],
    )
    with pytest.raises(policy.ProviderEndpointPolicyError, match="public addresses"):
        policy.validate_provider_endpoint(
            "https://provider.example/v1",
            environ={"OSTORY_RUNTIME_ENV": "production"},
        )


def test_custom_proxy_is_required_and_private_proxy_is_production_opt_in() -> None:
    with pytest.raises(policy.ProviderEndpointPolicyError, match="required"):
        policy.validate_proxy_settings(
            "custom",
            "",
            environ={"OSTORY_RUNTIME_ENV": "development"},
        )
    with pytest.raises(policy.ProviderEndpointPolicyError, match="public addresses"):
        policy.validate_proxy_settings(
            "custom",
            "http://127.0.0.1:7890",
            environ={"OSTORY_RUNTIME_ENV": "production"},
        )


def test_non_custom_proxy_mode_keeps_dormant_value_for_compatibility() -> None:
    assert policy.validate_proxy_settings(
        "direct",
        "http://127.0.0.1:7890",
        environ={"OSTORY_RUNTIME_ENV": "production"},
    ) == ("direct", "http://127.0.0.1:7890")


def test_provider_headers_reject_http_framing_and_newline_injection() -> None:
    with pytest.raises(policy.ProviderEndpointPolicyError, match="managed"):
        policy.validate_provider_headers({"Host": "metadata.internal"})
    with pytest.raises(policy.ProviderEndpointPolicyError, match="control"):
        policy.validate_provider_headers({"X-Custom": "safe\r\nInjected: yes"})


def test_provider_headers_preserve_safe_authentication_metadata() -> None:
    assert policy.validate_provider_headers(
        {"Authorization": "Bearer <FILL_ME>", "X-Provider-Version": 3}
    ) == {"Authorization": "Bearer <FILL_ME>", "X-Provider-Version": "3"}
