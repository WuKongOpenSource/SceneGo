"""Runtime video capability flags used by the frontend."""

from fastapi import APIRouter

from services.video_capability_service import get_video_capabilities


def create_video_capabilities_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/video/capabilities")
    async def video_capabilities(scope: str = "workflow"):
        """Expose backend feature flags that let the UI avoid unsupported flows."""
        return await get_video_capabilities(scope)

    return router
