"""Online-only video model manifest for the source edition."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from services.public_video_capability_service import get_public_video_capabilities


def create_public_video_capabilities_router(*, require_auth_dependency) -> APIRouter:
    router = APIRouter()

    @router.get("/api/video/capabilities")
    async def public_video_capabilities(
        response: Response,
        scope: str = "workflow",
        _identity: str = Depends(require_auth_dependency),
    ):
        response.headers["Cache-Control"] = "private, no-store"
        return await get_public_video_capabilities(scope, user_id=_identity)

    return router
