"""Prompt template routes."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from schemas.misc import PromptTemplate
from services.prompt_service import (
    delete_prompt_template as delete_prompt_template_service,
    get_prompt_template as get_prompt_template_service,
    save_prompt_template as save_prompt_template_service,
)

logger = logging.getLogger(__name__)


def create_prompt_router(*, require_auth_dependency) -> APIRouter:
    router = APIRouter()

    @router.get("/api/prompts/{template_type}")
    async def get_prompt_template(
        template_type: str,
        username: str = Depends(require_auth_dependency),
    ):
        """Load a user's prompt template, falling back to bundled defaults."""
        try:
            result = await get_prompt_template_service(username, template_type)
            if result.get("is_custom"):
                logger.info("User %s loaded custom prompt template: %s", username, template_type)
            return result
        except Exception as exc:
            logger.error("Failed to load prompt template: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.post("/api/prompts/{template_type}")
    async def save_prompt_template(
        template_type: str,
        request: PromptTemplate,
        username: str = Depends(require_auth_dependency),
    ):
        """Save a user's custom prompt template."""
        try:
            result = await save_prompt_template_service(username, template_type, request.content)
            logger.info("User %s saved prompt template: %s", username, template_type)
            return result
        except Exception as exc:
            logger.error("Failed to save prompt template: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.delete("/api/prompts/{template_type}")
    async def delete_prompt_template(
        template_type: str,
        username: str = Depends(require_auth_dependency),
    ):
        """Delete a user's custom template so default content is used again."""
        try:
            result = await delete_prompt_template_service(username, template_type)
            logger.info("User %s deleted prompt template if present: %s", username, template_type)
            return result
        except Exception as exc:
            logger.error("Failed to delete prompt template: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return router
