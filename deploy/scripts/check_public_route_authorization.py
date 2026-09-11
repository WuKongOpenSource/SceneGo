#!/usr/bin/env python3
"""Fail when the public FastAPI entry exposes an unreviewed anonymous API route."""
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi.routing import APIRoute, iter_route_contexts


DEPLOY_ROOT = Path(__file__).resolve().parents[1]
PROTECTING_DEPENDENCIES = frozenset(
    {
        "get_current_media_user",
        "get_current_user",
        "require_admin_access",
        "require_admin_session",
        "require_auth",
        "require_super_admin_access",
        "require_super_admin_session",
    }
)

# Every unauthenticated API surface must be named here and manually reviewed.
# Static SPA routes and the coarse /health liveness endpoint are not /api paths
# and are intentionally outside this matrix.
ANONYMOUS_API_ROUTES = frozenset(
    {
        ("POST", "/api/login"),
        ("GET", "/api/auth/captcha-config"),
        ("POST", "/api/auth/captcha/challenge"),
        ("POST", "/api/auth/captcha/check"),
        ("POST", "/api/auth/sms-code"),
        ("POST", "/api/auth/phone/register"),
        ("POST", "/api/auth/phone/login"),
        ("POST", "/api/auth/legacy/bind-phone"),
        ("POST", "/api/auth/phone/password-reset"),
        ("POST", "/api/auth/register"),
        ("POST", "/api/auth/login"),
        ("GET", "/api/public/final-products/{share_token}"),
        ("GET", "/api/public/final-products/{share_token}/media"),
        ("POST", "/api/public/final-products/{share_token}/feedback"),
        ("POST", "/api/payments/wechat/notify"),
    }
)


@dataclass(frozen=True, order=True)
class RouteAuthorizationIssue:
    method: str
    path: str
    reason: str


def _dependency_names(route: APIRoute) -> set[str]:
    names: set[str] = set()
    pending = list(route.dependant.dependencies)
    while pending:
        dependency = pending.pop()
        call = getattr(dependency, "call", None)
        name = getattr(call, "__name__", "")
        if name:
            names.add(name)
        pending.extend(dependency.dependencies)
    return names


def audit_public_route_authorization(app: Any) -> list[RouteAuthorizationIssue]:
    issues: set[RouteAuthorizationIssue] = set()
    observed_anonymous: set[tuple[str, str]] = set()

    for route in iter_route_contexts(app.routes):
        if not isinstance(route.original_route, APIRoute) or not (route.path or "").startswith("/api"):
            continue
        protected = bool(_dependency_names(route) & PROTECTING_DEPENDENCIES)
        for method in sorted((route.methods or set()) - {"HEAD", "OPTIONS"}):
            key = (method, route.path)
            if protected:
                continue
            if key in ANONYMOUS_API_ROUTES:
                observed_anonymous.add(key)
            else:
                issues.add(
                    RouteAuthorizationIssue(
                        method,
                        route.path,
                        "API route has no enforcing authentication dependency and is not allowlisted",
                    )
                )

    for method, path in ANONYMOUS_API_ROUTES - observed_anonymous:
        issues.add(
            RouteAuthorizationIssue(
                method,
                path,
                "anonymous-route allowlist entry is stale or the route became authenticated",
            )
        )
    return sorted(issues)


def main() -> int:
    if str(DEPLOY_ROOT) not in sys.path:
        sys.path.insert(0, str(DEPLOY_ROOT))
    from public_main import app

    issues = audit_public_route_authorization(app)
    if not issues:
        print(f"Public route authorization OK: {len(ANONYMOUS_API_ROUTES)} anonymous API routes reviewed")
        return 0
    print(f"Public route authorization failed: {len(issues)} issue(s)")
    for issue in issues:
        print(f"- {issue.method} {issue.path} [{issue.reason}]")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
