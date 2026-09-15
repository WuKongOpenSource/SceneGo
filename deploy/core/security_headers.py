"""Central browser security headers and production API-document policy."""
from __future__ import annotations

import os

from starlette.middleware.base import BaseHTTPMiddleware


AUTH_PAGE_PATHS = frozenset({"/login", "/legacy-login", "/register", "/bind-phone", "/password-reset"})


def is_production_runtime() -> bool:
    return os.getenv("OSTORY_RUNTIME_ENV", "development").strip().lower() == "production"


def fastapi_documentation_options() -> dict[str, str | None]:
    """Disable schema discovery endpoints on an Internet-facing production app."""
    if not is_production_runtime():
        return {}
    return {"docs_url": None, "redoc_url": None, "openapi_url": None}


def trusted_host_patterns() -> list[str]:
    """Return an explicit production Host allowlist; development stays permissive."""
    raw = os.getenv("TRUSTED_HOSTS", "").strip()
    if raw:
        hosts = [host.strip() for host in raw.split(",") if host.strip()]
    elif is_production_runtime():
        # A distributable build cannot know the deployer's public hostname.
        # Guessing here would either leak the publisher's infrastructure or
        # accidentally trust an unrelated domain, so production fails closed.
        hosts = []
    else:
        hosts = ["*"]
    if is_production_runtime() and (not hosts or "*" in hosts):
        raise ValueError("TRUSTED_HOSTS must be an explicit allowlist in production")
    return hosts


def _allows_same_origin_frame(path: str, admin_entry_path: str) -> bool:
    # Only documents used by the admin and canvas shells may be embedded.
    legacy_root = f"{admin_entry_path.rstrip('/')}/legacy"
    return path in {
        legacy_root,
        f"{legacy_root}/",
        f"{legacy_root}/index.html",
        "/studio",
        "/studio/",
        "/studio/index.html",
    }


def _content_security_policy(path: str, admin_entry_path: str) -> str:
    frame_ancestors = "'self'" if _allows_same_origin_frame(path, admin_entry_path) else "'none'"
    directives = [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        f"frame-ancestors {frame_ancestors}",
        "form-action 'self'",
        "img-src 'self' data: blob: https:",
        "media-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self' https: wss: blob: data:",
        "worker-src 'self' blob:",
    ]
    if path in AUTH_PAGE_PATHS:
        # Authentication and its puzzle assets are entirely same-origin.
        directives.extend(
            [
                "script-src 'self' 'unsafe-inline'",
                "style-src 'self' 'unsafe-inline'",
                "frame-src 'none'",
            ]
        )
    elif path == f"{admin_entry_path}/legacy" or path.startswith(f"{admin_entry_path}/legacy/"):
        # The admin settings shell embeds this console and its inline handlers.
        directives.extend(["script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'"])
    else:
        directives.extend(["script-src 'self'", "style-src 'self' 'unsafe-inline'"])
    return "; ".join(directives)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, admin_entry_path: str):
        super().__init__(app)
        self.admin_entry_path = admin_entry_path.rstrip("/")

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault(
            "X-Frame-Options",
            "SAMEORIGIN" if _allows_same_origin_frame(request.url.path, self.admin_entry_path) else "DENY",
        )
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
        )
        response.headers.setdefault(
            "Content-Security-Policy",
            _content_security_policy(request.url.path, self.admin_entry_path),
        )
        if is_production_runtime():
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        if (
            request.url.path == "/api/login"
            or request.url.path.startswith("/api/auth/")
            or request.url.path.startswith("/api/admin/")
            or request.url.path.startswith("/api/user/")
        ):
            response.headers["Cache-Control"] = "no-store"
        return response
