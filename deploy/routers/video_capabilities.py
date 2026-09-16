"""Runtime video capability flags used by the frontend."""

from fastapi import APIRouter, Depends, Response

from services.video_capability_service import get_video_capabilities


def create_video_capabilities_router(*, get_current_user_dependency) -> APIRouter:
    router = APIRouter()

    @router.get("/api/video/capabilities")
    async def video_capabilities(
        response: Response,
        scope: str = "workflow",
        user_id: str = Depends(get_current_user_dependency),
    ):
        """Expose backend feature flags that let the UI avoid unsupported flows."""
        response.headers["Cache-Control"] = "private, no-store"
        return await get_video_capabilities(scope, user_id=user_id)

    return router
