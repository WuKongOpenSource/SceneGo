"""Browser session-cookie helpers.

Bearer tokens remain accepted for API clients during the migration, while
browser-only transports such as media elements and EventSource authenticate
with an HttpOnly same-site cookie instead of leaking JWTs into URLs.
"""
from __future__ import annotations

import os
from collections.abc import Iterable
from typing import Optional
from urllib.parse import urlsplit

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


PRODUCTION_COOKIE_NAME = "__Host-ostory_session"
DEVELOPMENT_COOKIE_NAME = "ostory_session"
SESSION_TTL_SECONDS = 86400
UNSAFE_HTTP_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
SESSION_ESTABLISHING_PATHS = frozenset(
    {
        "/api/login",
        "/api/auth/login",
        "/api/auth/phone/register",
        "/api/auth/phone/login",
        "/api/auth/legacy/bind-phone",
        "/api/auth/phone/password-reset",
    }
)
BEARER_RESPONSE_HEADER = "X-Ostory-Session-Mode"
BEARER_RESPONSE_VALUE = "bearer"


def is_production_runtime() -> bool:
    return os.environ.get("OSTORY_RUNTIME_ENV", "development").strip().lower() == "production"


def session_cookie_name() -> str:
    return PRODUCTION_COOKIE_NAME if is_production_runtime() else DEVELOPMENT_COOKIE_NAME


def set_session_cookie(response: Response, token: str, *, max_age: int = SESSION_TTL_SECONDS) -> None:
    if not token:
        raise ValueError("session token is required")
    response.set_cookie(
        key=session_cookie_name(),
        value=token,
        max_age=max_age,
        httponly=True,
        secure=is_production_runtime(),
        samesite="strict",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"


def expose_bearer_token(request: Request) -> bool:
    """Return whether an API client explicitly requested a bearer response.

    Browser sessions are cookie-only by default so page JavaScript cannot read
    the JWT. Command-line and native clients that cannot retain cookies may opt
    into the compatibility response with ``X-Ostory-Session-Mode: bearer``.
    Merely sending an ``Authorization`` header is not enough: login requests do
    not have a pre-existing credential and response exposure must be explicit.
    """
    return request.headers.get(BEARER_RESPONSE_HEADER, "").strip().casefold() == BEARER_RESPONSE_VALUE


def session_response_payload(
    request: Request,
    token: str,
    payload: dict,
) -> dict:
    """Build a no-store session response with optional API-client bearer data."""
    result = dict(payload)
    result["session_mode"] = "cookie"
    if expose_bearer_token(request):
        result["session_mode"] = "cookie+bearer"
        result["token"] = token
    return result


def clear_session_cookies(response: Response) -> None:
    # Delete both names so a development/production transition cannot leave a
    # stale browser credential behind.
    for name in (PRODUCTION_COOKIE_NAME, DEVELOPMENT_COOKIE_NAME):
        response.delete_cookie(key=name, path="/", secure=name.startswith("__Host-"), samesite="strict")


def bearer_token(request: Request) -> str:
    authorization = request.headers.get("Authorization") or ""
    scheme, _, value = authorization.partition(" ")
    return value.strip() if scheme.lower() == "bearer" else ""


def request_session_token(request: Request) -> Optional[str]:
    """Resolve a request credential without accepting secrets in the URL."""
    header_token = bearer_token(request)
    if header_token:
        return header_token
    return (
        request.cookies.get(PRODUCTION_COOKIE_NAME)
        or request.cookies.get(DEVELOPMENT_COOKIE_NAME)
        or None
    )


def _has_session_cookie(request: Request) -> bool:
    return bool(
        request.cookies.get(PRODUCTION_COOKIE_NAME)
        or request.cookies.get(DEVELOPMENT_COOKIE_NAME)
    )


def _canonical_origin(value: str) -> str:
    try:
        parsed = urlsplit(value)
    except ValueError:
        return ""
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    return f"{parsed.scheme.lower()}://{parsed.netloc.casefold()}"


def _same_origin_request(request: Request, allowed_origins: frozenset[str]) -> bool:
    source = request.headers.get("origin") or request.headers.get("referer") or ""
    if not source or source == "null":
        return False
    origin = _canonical_origin(source)
    if not origin:
        return False
    request_host = (request.headers.get("host") or "").casefold()
    request_origins = {f"http://{request_host}", f"https://{request_host}"} if request_host else set()
    return origin in request_origins or origin in allowed_origins


class SameOriginSessionMiddleware(BaseHTTPMiddleware):
    """Reject cross-origin state changes authenticated only by a cookie.

    Bearer-token API clients are not subject to browser CSRF. Browser cookie
    requests and browser requests that establish a new session must prove that
    their Origin (or Referer fallback) matches the request Host; otherwise a
    cross-site form could log the victim into an attacker-controlled account.
    """

    def __init__(self, app, *, allowed_origins: Iterable[str] = ()):
        super().__init__(app)
        self.allowed_origins = frozenset(
            origin
            for value in allowed_origins
            if value != "*" and (origin := _canonical_origin(value))
        )

    async def dispatch(self, request: Request, call_next):
        unsafe_method = request.method.upper() in UNSAFE_HTTP_METHODS
        requires_browser_origin = (
            _has_session_cookie(request)
            or request.url.path in SESSION_ESTABLISHING_PATHS
        )
        api_client_opt_in = expose_bearer_token(request)
        if (
            unsafe_method
            and requires_browser_origin
            and not bearer_token(request)
            and not api_client_opt_in
            and not _same_origin_request(request, self.allowed_origins)
        ):
            return JSONResponse(
                status_code=403,
                content={"detail": "拒绝跨站会话请求"},
                headers={"Cache-Control": "no-store"},
            )
        return await call_next(request)


class SessionCookieUpgradeMiddleware(BaseHTTPMiddleware):
    """Upgrade a valid legacy Bearer session to an HttpOnly browser cookie."""

    def __init__(self, app, *, token_verifier):
        super().__init__(app)
        self.token_verifier = token_verifier

    async def dispatch(self, request: Request, call_next):
        legacy_token = bearer_token(request)
        response = await call_next(request)
        if (
            legacy_token
            and response.status_code < 400
            and self.token_verifier(legacy_token)
        ):
            # A login, rename, password change or logout owns its response
            # session. Never overwrite a fresh token or resurrect a cleared one.
            session_names = {PRODUCTION_COOKIE_NAME, DEVELOPMENT_COOKIE_NAME}
            endpoint_sets_session = any(
                cookie.partition("=")[0].strip() in session_names
                for cookie in response.headers.getlist("set-cookie")
            )
            if not endpoint_sets_session:
                set_session_cookie(response, legacy_token)
            # The frontend removes its legacy localStorage copy only after this
            # explicit acknowledgement, preventing a partial-deploy logout.
            response.headers["X-Ostory-Session-Upgraded"] = "1"
        return response
