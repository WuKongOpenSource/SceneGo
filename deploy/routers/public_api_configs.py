"""Public-edition API-config routes with plaintext credential export removed."""
from __future__ import annotations

from fastapi import APIRouter


PLAINTEXT_CREDENTIAL_ROUTES = frozenset(
    {
        ("/api-configs/export-keys", "POST"),
    }
)


def create_public_api_config_router(source_router: APIRouter) -> APIRouter:
    """Copy reviewed config routes while excluding bulk plaintext extraction.

    The private application keeps its existing router unchanged.  Self-hosted
    public deployments should recover encrypted provider configuration through
    their own database and secret-management backup process, not a browser
    endpoint that returns every credential in one response.
    """
    # Filter before inclusion: modern FastAPI keeps included routers lazy.
    if any(getattr(route, "path", None) is None for route in source_router.routes):
        raise ValueError("Public API configuration export requires explicit reviewed routes")
    reviewed_routes = [
        route
        for route in source_router.routes
        if not any(
            route.path == path and method in (getattr(route, "methods", None) or set())
            for path, method in PLAINTEXT_CREDENTIAL_ROUTES
        )
    ]
    return APIRouter(routes=reviewed_routes)


__all__ = ["PLAINTEXT_CREDENTIAL_ROUTES", "create_public_api_config_router"]
