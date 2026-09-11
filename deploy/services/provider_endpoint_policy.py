"""Validation policy for administrator-configured outbound AI endpoints.

Provider URLs are powerful configuration: the server attaches API credentials
and sends requests to them.  Treating them as arbitrary strings would turn a
stolen administrator session into an SSRF primitive.  This module keeps the
policy in one place so CRUD, import, activation, health checks, and runtime
loading can enforce the same rules.

Development remains compatible with localhost and plain HTTP.  Production is
fail-closed by default: provider endpoints must use HTTPS and resolve only to
public addresses.  Private/insecure destinations require explicit environment
opt-ins intended for reviewed enterprise gateway deployments.
"""
from __future__ import annotations

import os
import re
from collections.abc import Mapping as MappingABC
from typing import Mapping, Optional
from urllib.parse import urlsplit

from utils.net_guard import assert_public_http_url


class ProviderEndpointPolicyError(ValueError):
    """Raised when an outbound provider or proxy URL violates policy."""


_TRUE_VALUES = {"1", "true", "yes", "on"}
_PROXY_MODES = {"direct", "system", "custom"}
_HEADER_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$")
_FORBIDDEN_OUTBOUND_HEADERS = {
    "connection",
    "content-length",
    "host",
    "keep-alive",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


def _env_bool(name: str, default: bool = False, *, environ: Optional[Mapping[str, str]] = None) -> bool:
    source = os.environ if environ is None else environ
    return str(source.get(name, "1" if default else "0")).strip().lower() in _TRUE_VALUES


def _runtime_env(*, environ: Optional[Mapping[str, str]] = None) -> str:
    source = os.environ if environ is None else environ
    return str(source.get("OSTORY_RUNTIME_ENV", "development")).strip().lower()


def _validate_http_url_shape(value: str, *, label: str) -> str:
    clean = str(value or "").strip()
    if not clean:
        raise ProviderEndpointPolicyError(f"{label} is required")
    if any(ord(character) < 32 for character in clean):
        raise ProviderEndpointPolicyError(f"{label} contains control characters")
    try:
        parsed = urlsplit(clean)
        # Accessing port also detects malformed/out-of-range port values.
        _ = parsed.port
    except ValueError as exc:
        raise ProviderEndpointPolicyError(f"{label} is not a valid URL") from exc
    if parsed.scheme.lower() not in {"http", "https"}:
        raise ProviderEndpointPolicyError(f"{label} must use http or https")
    if not parsed.hostname:
        raise ProviderEndpointPolicyError(f"{label} must include a hostname")
    if parsed.fragment:
        raise ProviderEndpointPolicyError(f"{label} must not include a URL fragment")
    if parsed.username is not None or parsed.password is not None:
        raise ProviderEndpointPolicyError(f"{label} must not embed credentials in the URL")
    return clean


def validate_provider_endpoint(
    endpoint: str,
    *,
    environ: Optional[Mapping[str, str]] = None,
) -> str:
    """Validate one external model endpoint and return its trimmed value."""
    clean = _validate_http_url_shape(endpoint, label="provider endpoint")
    parsed = urlsplit(clean)
    if _runtime_env(environ=environ) != "production":
        return clean

    if parsed.scheme.lower() != "https" and not _env_bool(
        "ALLOW_INSECURE_PROVIDER_ENDPOINTS", environ=environ
    ):
        raise ProviderEndpointPolicyError(
            "provider endpoint must use HTTPS in production; "
            "set ALLOW_INSECURE_PROVIDER_ENDPOINTS=true only for a reviewed private gateway"
        )
    if not _env_bool("ALLOW_PRIVATE_PROVIDER_ENDPOINTS", environ=environ):
        try:
            assert_public_http_url(clean)
        except ValueError as exc:
            raise ProviderEndpointPolicyError(
                "provider endpoint must resolve to public addresses in production; "
                "set ALLOW_PRIVATE_PROVIDER_ENDPOINTS=true only for a reviewed private gateway"
            ) from exc
    return clean


def validate_proxy_settings(
    proxy_mode: str,
    custom_proxy: str,
    *,
    environ: Optional[Mapping[str, str]] = None,
) -> tuple[str, str]:
    """Validate outbound proxy configuration and return normalized strings."""
    mode = str(proxy_mode or "direct").strip().lower()
    proxy = str(custom_proxy or "").strip()
    if mode not in _PROXY_MODES:
        raise ProviderEndpointPolicyError(
            f"proxy_mode must be one of: {', '.join(sorted(_PROXY_MODES))}"
        )
    if mode != "custom":
        return mode, proxy
    proxy = _validate_http_url_shape(proxy, label="custom proxy")
    if _runtime_env(environ=environ) == "production" and not _env_bool(
        "ALLOW_PRIVATE_API_PROXIES", environ=environ
    ):
        try:
            assert_public_http_url(proxy)
        except ValueError as exc:
            raise ProviderEndpointPolicyError(
                "custom proxy must resolve to public addresses in production; "
                "set ALLOW_PRIVATE_API_PROXIES=true only for a reviewed private proxy"
            ) from exc
    return mode, proxy


def validate_provider_connection(
    endpoint: str,
    proxy_mode: str = "direct",
    custom_proxy: str = "",
    *,
    environ: Optional[Mapping[str, str]] = None,
) -> tuple[str, str, str]:
    """Validate a provider endpoint and its optional outbound proxy together."""
    clean_endpoint = validate_provider_endpoint(endpoint, environ=environ)
    clean_mode, clean_proxy = validate_proxy_settings(
        proxy_mode,
        custom_proxy,
        environ=environ,
    )
    return clean_endpoint, clean_mode, clean_proxy


def validate_provider_headers(headers: object) -> dict[str, str]:
    """Normalize admin headers and reject HTTP framing/header injection."""
    if headers in (None, ""):
        return {}
    if not isinstance(headers, MappingABC):
        raise ProviderEndpointPolicyError("provider headers must be a JSON object")
    if len(headers) > 64:
        raise ProviderEndpointPolicyError("provider headers may contain at most 64 fields")
    normalized: dict[str, str] = {}
    for raw_name, raw_value in headers.items():
        name = str(raw_name or "").strip()
        if not _HEADER_NAME.fullmatch(name):
            raise ProviderEndpointPolicyError("provider header name is invalid")
        if name.casefold() in _FORBIDDEN_OUTBOUND_HEADERS:
            raise ProviderEndpointPolicyError(f"provider header {name} is managed by the HTTP client")
        if not isinstance(raw_value, (str, int, float, bool)) or isinstance(raw_value, complex):
            raise ProviderEndpointPolicyError(f"provider header {name} must be a scalar value")
        value = str(raw_value)
        if len(value) > 8192:
            raise ProviderEndpointPolicyError(f"provider header {name} is too long")
        if "\r" in value or "\n" in value or "\x00" in value:
            raise ProviderEndpointPolicyError(f"provider header {name} contains control characters")
        normalized[name] = value
    return normalized
