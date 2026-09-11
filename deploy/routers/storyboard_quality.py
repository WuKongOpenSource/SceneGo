"""Storyboard image consistency review route."""
from __future__ import annotations

from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from services.entity_access_service import EntityAccessDenied, require_file_access
from services.project_access_service import require_project_access
from services.storyboard_service import (
    EpisodeNotFound,
    StoryboardItemNotFound,
    require_storyboard_item_access,
)
from services.storyboard_quality_service import review_storyboard_image


class StoryboardQualityReviewRequest(BaseModel):
    image_url: str
    file_id: Optional[str] = None
    generation_model: Optional[str] = None
    generation_attempt: int = 1
    prompt: str = ""
    script_segment: str = ""
    scene: str = ""
    characters: List[dict] = []
    reference_images: List[dict] = []


def create_storyboard_quality_router(
    *,
    get_current_user_dependency: Any,
    file_dao: Any,
    storyboard_dao: Any,
    episode_dao: Any,
    project_access_checker: Any = require_project_access,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency

    class QualityFileAccessDAO:
        @staticmethod
        async def get_by_id(file_id: str):
            return await file_dao.get_file(file_id)

    @router.post("/api/storyboard-items/{item_id}/quality-review")
    async def review_storyboard_generation(
        item_id: str,
        data: StoryboardQualityReviewRequest,
        user_id: str = Depends(get_current_user),
    ):
        try:
            item = await require_storyboard_item_access(
                item_id,
                user_id,
                "readonly",
                storyboard_dao=storyboard_dao,
                episode_dao=episode_dao,
                project_access_checker=project_access_checker,
            )
        except (StoryboardItemNotFound, EpisodeNotFound):
            raise HTTPException(status_code=404, detail="分镜不存在")

        file_record = None
        if data.file_id:
            try:
                file_record = await require_file_access(
                    data.file_id,
                    user_id,
                    "readonly",
                    file_dao=QualityFileAccessDAO,
                )
            except EntityAccessDenied:
                raise HTTPException(status_code=404, detail="文件不存在")

            file_entity_type = str(file_record.get("entity_type") or "").lower()
            file_entity_id = str(file_record.get("entity_id") or "")
            if file_entity_type in {"storyboard_item", "material"} and file_entity_id != item_id:
                raise HTTPException(status_code=404, detail="文件不存在")

        review = await review_storyboard_image(
            image_url=data.image_url,
            prompt=data.prompt,
            script_segment=data.script_segment,
            characters=data.characters,
            scene=data.scene,
            reference_images=data.reference_images,
        )
        if data.file_id and file_record:
            await file_dao.merge_metadata(data.file_id, {
                "storyboard_quality_review": review,
                "storyboard_generation_model": data.generation_model,
                "storyboard_generation_attempt": data.generation_attempt,
                "storyboard_item_id": item_id,
            })
        return review

    return router
