"""Authenticated final-product sharing and public review endpoints."""
from __future__ import annotations

from pathlib import Path
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

import media_library_service
from dao_final_product_share import FinalProductShareDAO
from dao_media_library import MediaLibraryDAO
from services.media_response_policy import safe_content_disposition
from services.public_feedback_rate_limit_service import (
    PublicFeedbackRateLimitConfigurationError,
    PublicFeedbackRateLimited,
    PublicFeedbackRateLimitUnavailable,
    consume_public_feedback_attempt,
)


class FeedbackCreateRequest(BaseModel):
    author_name: str = Field(default="访客", max_length=40)
    content: str = Field(min_length=1, max_length=1000)
    timestamp_seconds: Optional[float] = Field(default=None, ge=0)


_SHARE_TOKEN = re.compile(r"^[A-Za-z0-9_-]{20,128}$")


def _valid_share_token(value: str) -> str:
    token = str(value or "")
    if not _SHARE_TOKEN.fullmatch(token):
        raise HTTPException(status_code=404, detail="分享链接不存在或已停止")
    return token


def _clean_feedback_text(value: str, *, multiline: bool) -> str:
    clean = str(value or "").strip()
    if "\x00" in clean or any(
        ord(character) < 32 and character not in ({"\n", "\r", "\t"} if multiline else set())
        for character in clean
    ):
        raise HTTPException(status_code=400, detail="意见包含不支持的控制字符")
    return clean


def create_final_product_share_router(
    *,
    get_current_user_dependency: Any,
    share_dao: Any = FinalProductShareDAO,
    media_dao: Any = MediaLibraryDAO,
    media_roots: Optional[list[Path]] = None,
    get_redis_client: Any = None,
) -> APIRouter:
    router = APIRouter(tags=["final-product-sharing"])
    get_current_user = get_current_user_dependency
    deploy_root = Path(__file__).resolve().parent
    allowed_media_roots = [
        root.resolve()
        for root in (
            media_roots
            or [deploy_root / "persistent_storage", deploy_root / "temp" / "uploads"]
        )
    ]

    def resolve_public_media_path(raw_path: Any) -> Path:
        value = str(raw_path or "").strip()
        if not value:
            raise HTTPException(status_code=404, detail="分享媒体不存在")
        candidate = Path(value)
        if not candidate.is_absolute():
            candidate = deploy_root / candidate
        try:
            resolved = candidate.resolve(strict=True)
        except (OSError, RuntimeError) as exc:
            raise HTTPException(status_code=404, detail="分享媒体不存在") from exc
        if not resolved.is_file() or not any(resolved.is_relative_to(root) for root in allowed_media_roots):
            raise HTTPException(status_code=404, detail="分享媒体不存在")
        return resolved

    def public_final_payload(share: dict[str, Any], share_token: str) -> dict[str, Any]:
        payload = dict(share)
        payload["file_url"] = f"/api/public/final-products/{share_token}/media"
        for private_field in (
            "file_id",
            "file_name",
            "file_path",
            "mime_type",
            "thumbnail_url",
        ):
            payload.pop(private_field, None)
        return payload

    async def require_final(library_item_id: str) -> dict:
        item = await media_dao.get(library_item_id)
        if not item or item.get("source") != "composed_final":
            raise HTTPException(status_code=404, detail="成品不存在")
        return item

    @router.get("/api/final-products/{library_item_id}/share")
    async def get_share(
        library_item_id: str,
        user_id: str = Depends(get_current_user),
    ):
        item = await require_final(library_item_id)
        if not await media_library_service.can_view(item, user_id):
            raise HTTPException(status_code=404, detail="成品不存在")
        share = await share_dao.get_active_for_item(library_item_id)
        return {"success": True, "share": share}

    @router.post("/api/final-products/{library_item_id}/share")
    async def create_share(
        library_item_id: str,
        user_id: str = Depends(get_current_user),
    ):
        item = await require_final(library_item_id)
        if not await media_library_service.can_mutate(item, user_id):
            raise HTTPException(status_code=403, detail="无权分享该成品")
        project_id = str(item.get("project_id") or "").strip()
        if not project_id:
            raise HTTPException(status_code=400, detail="成品未关联项目，无法分享")
        share = await share_dao.create_or_get(
            library_item_id=library_item_id,
            owner_user_id=user_id,
            project_id=project_id,
            episode_id=item.get("episode_id"),
        )
        return {"success": True, "share": share}

    @router.delete("/api/final-products/{library_item_id}/share/{share_id}")
    async def deactivate_share(
        library_item_id: str,
        share_id: str,
        user_id: str = Depends(get_current_user),
    ):
        item = await require_final(library_item_id)
        if not await media_library_service.can_mutate(item, user_id):
            raise HTTPException(status_code=403, detail="无权停止分享该成品")
        if not await share_dao.deactivate(share_id, user_id):
            raise HTTPException(status_code=404, detail="分享链接不存在或已停止")
        return {"success": True}

    @router.get("/api/final-products/{library_item_id}/feedback")
    async def list_owner_feedback(
        library_item_id: str,
        user_id: str = Depends(get_current_user),
    ):
        item = await require_final(library_item_id)
        if not await media_library_service.can_view(item, user_id):
            raise HTTPException(status_code=404, detail="成品不存在")
        feedback = await share_dao.list_feedback_for_item(library_item_id)
        return {"success": True, "feedback": feedback}

    @router.get("/api/public/final-products/{share_token}")
    async def get_public_final(share_token: str):
        share_token = _valid_share_token(share_token)
        share = await share_dao.get_public(share_token)
        if not share:
            raise HTTPException(status_code=404, detail="分享链接不存在或已停止")
        await share_dao.increment_access(share["share_id"])
        feedback = await share_dao.list_feedback_for_share(share["share_id"], limit=50)
        return {
            "success": True,
            "final": public_final_payload(share, share_token),
            "feedback": feedback,
        }

    @router.get("/api/public/final-products/{share_token}/media")
    async def get_public_final_media(share_token: str):
        share_token = _valid_share_token(share_token)
        share = await share_dao.get_public(share_token)
        if not share:
            raise HTTPException(status_code=404, detail="分享链接不存在或已停止")
        path = resolve_public_media_path(share.get("file_path"))
        mime_type, content_disposition, extra_headers = safe_content_disposition(
            path,
            download_name=str(share.get("file_name") or path.name),
        )
        return FileResponse(
            path,
            media_type=mime_type,
            headers={
                **extra_headers,
                "Cache-Control": "private, no-store, max-age=0",
                "Content-Disposition": content_disposition,
                "X-Content-Type-Options": "nosniff",
            },
        )

    @router.post("/api/public/final-products/{share_token}/feedback")
    async def create_public_feedback(
        share_token: str,
        payload: FeedbackCreateRequest,
        request: Request,
    ):
        share_token = _valid_share_token(share_token)
        try:
            await consume_public_feedback_attempt(
                get_redis_client() if get_redis_client else None,
                share_token=share_token,
                remote_ip=request.client.host if request.client else None,
            )
        except PublicFeedbackRateLimited as exc:
            raise HTTPException(
                status_code=429,
                detail=str(exc),
                headers={"Retry-After": str(exc.retry_after)},
            ) from exc
        except (PublicFeedbackRateLimitConfigurationError, PublicFeedbackRateLimitUnavailable) as exc:
            raise HTTPException(status_code=503, detail="意见提交保护服务暂不可用") from exc
        share = await share_dao.get_public(share_token)
        if not share:
            raise HTTPException(status_code=404, detail="分享链接不存在或已停止")
        content = _clean_feedback_text(payload.content, multiline=True)
        if not content:
            raise HTTPException(status_code=400, detail="请输入意见")
        author_name = _clean_feedback_text(payload.author_name, multiline=False) or "访客"
        duration = float(share.get("duration_seconds") or 0)
        if payload.timestamp_seconds is not None and duration > 0 and payload.timestamp_seconds > duration + 1:
            raise HTTPException(status_code=400, detail="意见时间点超出成品时长")
        feedback = await share_dao.add_feedback(
            share_id=share["share_id"],
            author_name=author_name,
            content=content,
            timestamp_seconds=payload.timestamp_seconds,
        )
        return {"success": True, "feedback": feedback}

    return router


__all__ = ["FeedbackCreateRequest", "create_final_product_share_router"]
