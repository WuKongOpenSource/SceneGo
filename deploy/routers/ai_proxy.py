"""AI proxy routes.

Provider calls live in dedicated service modules. This router keeps the HTTP
route layer focused on auth, request shaping, task persistence, and response
format.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from schemas.generation import (
    DeepseekChatRequest,
    DoubaoImageRequest,
    GeminiImageRequest,
    GeminiTextRequest,
    GptImageRequest,
    ImageReferenceValidationRequest,
    MinimaxChatRequest,
)
from services.ai_proxy_deepseek_service import (
    ensure_deepseek_configured,
    stream_deepseek_chat,
)
from services.ai_proxy_doubao_image_service import (
    generate_doubao_images as proxy_generate_doubao_images,
)
from services.ai_proxy_gemini_image_service import (
    generate_gemini_images as proxy_generate_gemini_images,
)
from services.ai_proxy_gemini_text_service import (
    generate_gemini_text_result,
    resolve_gemini_stream_config,
    stream_gemini_text,
)
from services.ai_proxy_gpt_image_service import (
    generate_gpt_images as proxy_generate_gpt_images,
)
from services.ai_proxy_minimax_text_service import (
    ensure_minimax_configured,
    stream_minimax_chat,
)
from services.ai_proxy_types import AIProxyError
from services.ai_proxy_image_persistence_service import persist_generated_ai_images
from services.ai_proxy_task_service import (
    complete_ai_proxy_image_task,
    complete_ai_proxy_text_task,
    create_completed_image_task,
    create_deepseek_text_task,
    create_gemini_text_task,
    create_minimax_text_task,
    fail_ai_proxy_task,
    format_public_text_task_name,
    start_ai_proxy_task,
)
from services.ai_proxy_reference_service import (
    ReferenceImageError,
    build_reference_snapshot,
    prepare_doubao_reference_inputs,
    prepare_gemini_image_parts,
    prepare_gpt_image_reference_inputs,
    resolve_registered_reference_paths,
)
from services.text_model_catalog_service import build_text_model_catalog
from services.image_generation_capability_service import build_image_generation_capabilities
from services.generation_access_service import (
    GenerationAccessDenied,
    require_generation_request_access,
)

logger = logging.getLogger(__name__)


def create_ai_proxy_router(
    *,
    require_auth_dependency,
    get_main_event_loop: Callable[[], Optional[asyncio.AbstractEventLoop]],
    get_redis_client: Callable[[], Optional[Any]],
    file_dao: Any = None,
    generation_access_checker: Any = require_generation_request_access,
) -> APIRouter:
    router = APIRouter()

    async def _authorize_generation_request(request: Any, username: str, references: list[str]) -> None:
        if file_dao is None:
            raise HTTPException(status_code=503, detail="Studio access validation is unavailable")
        try:
            await generation_access_checker(
                request,
                username,
                references,
                file_dao=file_dao,
            )
        except GenerationAccessDenied as exc:
            raise HTTPException(status_code=404, detail="项目或参考素材不可用，可能已删除或无权访问。请刷新页面并重新选择参考图。") from exc

    async def _registered_reference_paths(references: list[str]):
        try:
            return await resolve_registered_reference_paths(references, file_dao=file_dao)
        except ReferenceImageError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/api/ai/image-references/validate")
    async def validate_image_references(request: ImageReferenceValidationRequest, username: str = Depends(require_auth_dependency)):
        # Authorize the target before reporting indexes; never return source paths
        # or distinguish another user's file from a missing file.
        await _authorize_generation_request(request, username, [])
        invalid_indexes = []
        for index, reference in enumerate(request.references):
            if not reference.strip():
                invalid_indexes.append(index)
                continue
            try:
                await _authorize_generation_request(request, username, [reference])
                await _registered_reference_paths([reference])
            except HTTPException as exc:
                if exc.status_code not in (400, 404):
                    raise
                invalid_indexes.append(index)
        return {"invalid_indexes": invalid_indexes}

    text_operation_names = {
        "storyboard_script_generate": "分镜脚本生成",
        "storyboard_script_continue": "分镜脚本续写",
        "script_rewrite": "剧本修改",
        "script_generate": "剧本生成",
        "shot_design_generate": "镜头设计生成",
        "script_metadata_extract": "剧本元素提取",
        "prompt_rewrite": "提示词改写",
    }

    def _text_task_context(request, *, provider: str) -> dict[str, Any]:
        operation = (getattr(request, "operation", None) or "").strip()
        requested_name = (getattr(request, "display_name", None) or "").strip()
        model = (getattr(request, "model", None) or "").strip()
        business_name = requested_name[:80] or text_operation_names.get(operation, "")
        values = {
            "operation": operation,
            "display_name": format_public_text_task_name(
                business_name,
                provider=provider,
                model=model,
            ),
            "project_id": getattr(request, "project_id", None),
            "episode_id": getattr(request, "episode_id", None),
            "source_page": getattr(request, "source_page", None) or "global",
            "source_item_id": getattr(request, "source_item_id", None),
            "entity_type": getattr(request, "entity_type", None),
            "entity_id": getattr(request, "entity_id", None),
            "model_scope": getattr(request, "model_scope", None),
            "suppress_notification": bool(getattr(request, "suppress_notification", False)),
        }
        return {
            key: value
            for key, value in values.items()
            if (isinstance(value, str) and value.strip())
            or (key == "suppress_notification" and value is True)
        }

    def _current_redis_client():
        try:
            return get_redis_client()
        except Exception as exc:
            logger.warning("获取 Redis 客户端失败，文本通知将仅写入数据库: %s", exc)
            return None

    def _schedule_text_result_save(
        task_id: Optional[str],
        complete_text: str,
        *,
        user_id: str,
        task_type: str,
        task_context: dict[str, str],
    ):
        if not task_id or not complete_text:
            return
        loop = get_main_event_loop()
        if loop is not None and not loop.is_closed():
            try:
                asyncio.run_coroutine_threadsafe(
                    complete_ai_proxy_text_task(
                        task_id=task_id,
                        text_content=complete_text,
                        logger=logger,
                        user_id=user_id,
                        task_type=task_type,
                        task_context=task_context,
                        redis_client=_current_redis_client(),
                    ),
                    loop,
                )
            except Exception as e:
                logger.error("⚠️ 提交保存任务到主事件循环失败: %s", e, exc_info=True)
        else:
            logger.warning("⚠️ MAIN_EVENT_LOOP 不可用，跳过文本结果持久化")

    def _schedule_text_task_failure(
        task_id: Optional[str],
        error_message: str,
        *,
        user_id: str,
        task_type: str,
        task_context: dict[str, str],
    ):
        if not task_id:
            return
        loop = get_main_event_loop()
        if loop is not None and not loop.is_closed():
            try:
                asyncio.run_coroutine_threadsafe(
                    fail_ai_proxy_task(
                        task_id=task_id,
                        error_message=error_message,
                        logger=logger,
                        user_id=user_id,
                        task_type=task_type,
                        task_context=task_context,
                        redis_client=_current_redis_client(),
                    ),
                    loop,
                )
            except Exception as e:
                logger.error("⚠️ 提交文本失败状态到主事件循环失败: %s", e, exc_info=True)
        else:
            logger.warning("⚠️ MAIN_EVENT_LOOP 不可用，跳过文本失败状态持久化")

    def _image_task_data(request, *, provider: str, model: Optional[str] = None, **extra):
        reference_metadata = [
            item.model_dump() if hasattr(item, "model_dump") else dict(item)
            for item in (getattr(request, "reference_metadata", None) or [])
        ]
        entity_type = getattr(request, "entity_type", None)
        entity_id = getattr(request, "entity_id", None)
        source_page = getattr(request, "source_page", None)
        if not source_page:
            source_page = "generation" if entity_type == "storyboard_item" else "design"
        task_data = {
            "prompt": request.prompt,
            "provider": provider,
            "model": model,
            "model_scope": getattr(request, "model_scope", None),
            "entity_type": entity_type,
            "entity_id": entity_id,
            "file_role": request.file_role,
            "project_id": request.project_id,
            "episode_id": request.episode_id,
            "source_page": source_page,
            "source_item_id": getattr(request, "source_item_id", None) or entity_id,
            "display_name": extra.pop("display_name", f"{provider} image"),
            "category": "image",
            "reference_snapshot": build_reference_snapshot(
                getattr(request, "references", None),
                reference_metadata,
            ),
        }
        task_data.update(extra)
        return task_data

    @router.get("/api/ai/text-models")
    async def get_text_models(
        scope: str = "workflow",
        _username: str = Depends(require_auth_dependency),
    ):
        """Return the effective text models without exposing runtime secrets."""
        return {
            "success": True,
            "models": await build_text_model_catalog(scope),
        }

    @router.get("/api/ai/image-generation-capabilities")
    async def get_image_generation_capabilities(
        _username: str = Depends(require_auth_dependency),
    ):
        """Return preflight availability without exposing keys or endpoints."""
        return {"success": True, **build_image_generation_capabilities()}

    @router.post("/api/deepseek/chat")
    async def deepseek_chat(request: DeepseekChatRequest, username: str = Depends(require_auth_dependency)):

        try:
            ensure_deepseek_configured(request.model, usage_scope=request.model_scope)
        except AIProxyError as e:
            raise HTTPException(status_code=e.status_code, detail=e.detail)

        try:
            task_context = _text_task_context(request, provider="deepseek")
            task_id = await create_deepseek_text_task(
                user_id=username,
                prompt=request.prompt,
                response_format=request.response_format,
                temperature=request.temperature,
                model=request.model,
                logger=logger,
                task_context=task_context,
            )

            return StreamingResponse(
                stream_deepseek_chat(
                    prompt=request.prompt,
                    response_format=request.response_format,
                    temperature=request.temperature,
                    model=request.model,
                    usage_scope=request.model_scope,
                    on_complete=lambda text: _schedule_text_result_save(
                        task_id,
                        text,
                        user_id=username,
                        task_type="deepseek_text",
                        task_context=task_context,
                    ),
                    on_error=lambda error: _schedule_text_task_failure(
                        task_id,
                        error,
                        user_id=username,
                        task_type="deepseek_text",
                        task_context=task_context,
                    ),
                ),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("AI服务请求失败: %s", e)
            raise HTTPException(status_code=500, detail="AI服务请求失败，请稍后重试")

    @router.post("/api/minimax/chat")
    async def minimax_chat(request: MinimaxChatRequest, username: str = Depends(require_auth_dependency)):

        try:
            ensure_minimax_configured(request.model, usage_scope=request.model_scope)
        except AIProxyError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail)

        try:
            task_context = _text_task_context(request, provider="minimax")
            task_id = await create_minimax_text_task(
                user_id=username,
                prompt=request.prompt,
                response_format=request.response_format,
                temperature=request.temperature,
                model=request.model,
                logger=logger,
                task_context=task_context,
            )
            return StreamingResponse(
                stream_minimax_chat(
                    prompt=request.prompt,
                    response_format=request.response_format,
                    temperature=request.temperature,
                    model=request.model,
                    usage_scope=request.model_scope,
                    on_complete=lambda text: _schedule_text_result_save(
                        task_id,
                        text,
                        user_id=username,
                        task_type="minimax_text",
                        task_context=task_context,
                    ),
                    on_error=lambda error: _schedule_text_task_failure(
                        task_id,
                        error,
                        user_id=username,
                        task_type="minimax_text",
                        task_context=task_context,
                    ),
                ),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("MiniMax AI 服务请求失败: %s", exc)
            raise HTTPException(status_code=500, detail="AI服务请求失败，请稍后重试")

    @router.post("/api/gemini/text")
    async def gemini_text_chat(request: GeminiTextRequest, username: str = Depends(require_auth_dependency)):

        await _authorize_generation_request(request, username, [])
        task_context = _text_task_context(request, provider="gemini")
        task_id = await create_gemini_text_task(
            user_id=username,
            prompt=request.prompt,
            system_prompt=request.system_prompt,
            temperature=request.temperature,
            model=request.model,
            logger=logger,
            task_context=task_context,
        )
        try:
            text_result = await generate_gemini_text_result(
                prompt=request.prompt,
                system_prompt=request.system_prompt,
                temperature=request.temperature,
                model=request.model,
                usage_scope=request.model_scope,
            )
            content = text_result.content

            if task_id:
                await complete_ai_proxy_text_task(
                task_id=task_id,
                text_content=content,
                logger=logger,
                user_id=username,
                task_type="gemini_text",
                task_context=task_context,
                redis_client=_current_redis_client(),
            )

            return {
                "content": content,
                "provider": text_result.provider,
                "model": text_result.model_name,
                "failover": text_result.failover,
            }

        except AIProxyError as e:
            await fail_ai_proxy_task(
                task_id=task_id,
                error_message=e.detail,
                logger=logger,
                user_id=username,
                task_type="gemini_text",
                task_context=task_context,
                redis_client=_current_redis_client(),
            )
            logger.error("文本生成失败: %s | upstream: %s", e, e.upstream)
            raise HTTPException(status_code=e.status_code, detail=e.detail)
        except Exception as e:
            await fail_ai_proxy_task(
                task_id=task_id,
                error_message=str(e),
                logger=logger,
                user_id=username,
                task_type="gemini_text",
                task_context=task_context,
                redis_client=_current_redis_client(),
            )
            logger.error("文本生成失败: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail="文本生成失败，请稍后重试")

    @router.post("/api/gemini/text/stream")
    async def gemini_text_stream(request: GeminiTextRequest, username: str = Depends(require_auth_dependency)):

        await _authorize_generation_request(request, username, [])
        try:
            stream_config = await resolve_gemini_stream_config(request.model, usage_scope=request.model_scope)
        except AIProxyError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail)
        task_context = _text_task_context(request, provider="gemini")
        task_id = await create_gemini_text_task(
            user_id=username,
            prompt=request.prompt,
            system_prompt=request.system_prompt,
            temperature=request.temperature,
            model=request.model,
            logger=logger,
            task_context=task_context,
        )
        return StreamingResponse(
            stream_gemini_text(
                prompt=request.prompt,
                system_prompt=request.system_prompt,
                temperature=request.temperature,
                model=request.model,
                usage_scope=request.model_scope,
                config=stream_config,
                on_complete=lambda text: _schedule_text_result_save(
                    task_id,
                    text,
                    user_id=username,
                    task_type="gemini_text",
                    task_context=task_context,
                ),
                on_error=lambda error: _schedule_text_task_failure(
                    task_id,
                    error,
                    user_id=username,
                    task_type="gemini_text",
                    task_context=task_context,
                ),
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @router.post("/api/gemini/image")
    async def gemini_image_generate(request: GeminiImageRequest, username: str = Depends(require_auth_dependency)):

        await _authorize_generation_request(request, username, request.references)
        reference_paths = await _registered_reference_paths(request.references)
        task_id = await start_ai_proxy_task(
            task_id_prefix="gemini_img",
            user_id=username,
            task_type="gemini_image",
            task_data=_image_task_data(
                request,
                provider="gemini",
                model=request.model,
                aspectRatio=request.aspectRatio,
                imageSize=request.imageSize,
                ref_count=len(request.references or []),
                display_name="AI 生图任务",
            ),
            logger=logger,
        )
        try:
            submitted_references = []
            parts = prepare_gemini_image_parts(
                prompt=request.prompt,
                references=request.references,
                registered_paths=reference_paths,
                reference_metadata=[item.model_dump() for item in request.reference_metadata],
                reference_snapshot=submitted_references,
                logger=logger,
            )

            images, model = await proxy_generate_gemini_images(
                parts=parts,
                requested_model=request.model,
                aspect_ratio=request.aspectRatio,
                image_size=request.imageSize,
                usage_scope=request.model_scope,
            )

            logger.info("✅ 图像生成成功: %s 张图片, 用户: %s", len(images), username)

            await complete_ai_proxy_image_task(
                task_id=task_id,
                images_count=len(images),
                reference_snapshot=submitted_references,
                logger=logger,
            )

            files_result = await persist_generated_ai_images(
                images,
                user_id=username,
                source="gemini",
                media_source="generated_image_gemini",
                prompt=request.prompt,
                model=model,
                entity_type=request.entity_type,
                entity_id=request.entity_id,
                file_role=request.file_role,
                project_id=request.project_id,
                episode_id=request.episode_id,
                file_metadata={
                    "prompt": request.prompt,
                    "model": model,
                    "reference_snapshot": submitted_references,
                },
                media_metadata={
                    "prompt": request.prompt,
                    "model": model,
                    "reference_snapshot": submitted_references,
                },
                source_task_id=task_id,
                logger=logger,
            )

            return {"success": True, "images": images, "files": files_result}

        except ReferenceImageError as e:
            await fail_ai_proxy_task(task_id=task_id, error_message=str(e), logger=logger)
            logger.warning("Gemini 角色参考图无效: %s", e)
            raise HTTPException(status_code=400, detail=str(e))
        except AIProxyError as e:
            await fail_ai_proxy_task(task_id=task_id, error_message=e.detail, logger=logger)
            logger.error("图像生成失败: %s | upstream: %s", e, e.upstream)
            raise HTTPException(status_code=e.status_code, detail=e.detail)
        except Exception as e:
            await fail_ai_proxy_task(task_id=task_id, error_message=str(e), logger=logger)
            logger.error("图像生成失败: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail="图像生成失败，请稍后重试")

    @router.post("/api/gpt-image/generate")
    async def gpt_image_generate(request: GptImageRequest, username: str = Depends(require_auth_dependency)):

        if not request.prompt or not request.prompt.strip():
            raise HTTPException(status_code=400, detail="prompt 不能为空")
        await _authorize_generation_request(request, username, request.references)

        try:
            reference_paths = await _registered_reference_paths(request.references)
            submitted_references = []
            reference_inputs = prepare_gpt_image_reference_inputs(
                request.references,
                registered_paths=reference_paths,
                reference_metadata=[item.model_dump() for item in request.reference_metadata],
                reference_snapshot=submitted_references,
                logger=logger,
            )
            if request.references and not reference_inputs:
                raise HTTPException(status_code=400, detail="提供了 references 但全部无法读取，无法发起图改图")

            images, model, tier = await proxy_generate_gpt_images(
                tier=request.tier,
                prompt=request.prompt,
                references=reference_inputs,
                n=request.n,
                size=request.size,
                quality=request.quality,
            )

            task_id = await create_completed_image_task(
                task_id_prefix="gpt_image",
                user_id=username,
                task_type="gpt_image",
                task_data=_image_task_data(
                    request,
                    provider=f"gpt-image-{tier}",
                    model=model,
                    tier=tier,
                    size=request.size,
                    quality=request.quality,
                    n=request.n,
                    ref_count=len(request.references or []),
                    submitted_reference_snapshot=submitted_references,
                    display_name=("GPT Image 2 VIP · 高清生图模型" if tier == "vip" else "GPT Image 2 · 全能生图模型"),
                ),
                images_count=len(images),
                logger=logger,
            )

            files_result = await persist_generated_ai_images(
                images,
                user_id=username,
                source=f"gpt-image-{tier}",
                media_source="generated_image_gpt",
                prompt=request.prompt,
                model=model,
                entity_type=request.entity_type,
                entity_id=request.entity_id,
                file_role=request.file_role,
                project_id=request.project_id,
                episode_id=request.episode_id,
                file_metadata={
                    "prompt": request.prompt,
                    "model": model,
                    "tier": tier,
                    "size": request.size,
                    "quality": request.quality,
                    "ref_count": len(request.references or []),
                    "reference_snapshot": submitted_references,
                },
                media_metadata={
                    "prompt": request.prompt,
                    "model": model,
                    "tier": tier,
                    "reference_snapshot": submitted_references,
                },
                include_url=True,
                source_task_id=task_id,
                logger=logger,
            )

            logger.info("✅ GPT Image %s 生成 %s 张, 用户: %s", tier, len(images), username)
            return {"success": True, "images": images, "files": files_result, "model": model, "tier": tier}
        except AIProxyError as e:
            logger.error("GPT Image 生成失败: %s | upstream: %s", e, e.upstream)
            raise HTTPException(status_code=e.status_code, detail=e.detail)
        except HTTPException:
            raise
        except Exception as e:
            logger.error("GPT Image 生成异常: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail="图像生成失败，请稍后重试")

    @router.post("/api/materials/doubao")
    async def generate_doubao_images(request: DoubaoImageRequest, username: str = Depends(require_auth_dependency)):
        await _authorize_generation_request(request, username, request.references)
        if request.seedance_portrait and request.references:
            raise HTTPException(status_code=422, detail="Seedance 人像分镜仅支持纯文生图，请移除参考图或关闭此模式。")
        reference_paths = await _registered_reference_paths(request.references)
        task_id = await start_ai_proxy_task(
            task_id_prefix="doubao_img",
            user_id=username,
            task_type="doubao_image",
            task_data=_image_task_data(
                request,
                provider="doubao",
                model=request.model,
                size=request.size,
                count=request.count,
                sequential=request.sequential,
                ref_count=len(request.references or []),
                display_name="Seedream 5.0 Pro" if "pro" in str(request.model or "").lower() else "Seedream 5.0 Lite",
            ),
            logger=logger,
        )
        try:
            submitted_references = []
            ref_inputs = prepare_doubao_reference_inputs(
                request.references,
                registered_paths=reference_paths,
                reference_metadata=[item.model_dump() for item in request.reference_metadata],
                reference_snapshot=submitted_references,
            )

            images = await proxy_generate_doubao_images(
                prompt=request.prompt,
                reference_inputs=ref_inputs,
                size=request.size,
                sequential=request.sequential,
                count=request.count,
                model=request.model,
                usage_scope=request.model_scope,
                seedance_portrait=request.seedance_portrait,
                reference_purpose=request.reference_purpose,
            )
            logger.info("✅ 豆包生成 %s 张图片, 用户: %s", len(images), username)
            actual_model = getattr(images, "model", None) or request.model or "doubao"

            files_result = await persist_generated_ai_images(
                images,
                user_id=username,
                source="doubao",
                media_source="generated_image_doubao",
                prompt=request.prompt,
                model=actual_model,
                entity_type=request.entity_type,
                entity_id=request.entity_id,
                file_role=request.file_role,
                project_id=request.project_id,
                episode_id=request.episode_id,
                file_metadata={
                    "prompt": request.prompt,
                    "model": actual_model,
                    "reference_snapshot": submitted_references,
                },
                media_metadata={
                    "prompt": request.prompt,
                    "model": actual_model,
                    "reference_snapshot": submitted_references,
                },
                source_task_id=task_id,
                logger=logger,
            )
            await complete_ai_proxy_image_task(
                task_id=task_id,
                images_count=len(images),
                reference_snapshot=submitted_references,
                logger=logger,
            )
            return {"success": True, "images": list(images), "files": files_result,
                    "actual_model": actual_model if getattr(images, "model_verified", False) else None}
        except AIProxyError as e:
            await fail_ai_proxy_task(task_id=task_id, error_message=e.detail, logger=logger)
            logger.error("豆包图像生成失败: %s | upstream: %s", e, e.upstream)
            raise HTTPException(status_code=e.status_code, detail=e.detail)
        except HTTPException:
            raise
        except Exception as e:
            await fail_ai_proxy_task(task_id=task_id, error_message=str(e), logger=logger)
            logger.error("豆包图像生成异常: %s", e)
            raise HTTPException(status_code=500, detail="图像生成失败，请稍后重试")

    @router.post("/api/materials/seedream-source")
    async def seedream_source_labels(request: ImageReferenceValidationRequest, username: str = Depends(require_auth_dependency)):
        from services.media_reference_service import resolve_media_file_record
        from services.seedance_image_provenance import verified_text_to_image_source, image_generation_source
        from services.seedance_portrait_reference_service import portrait_reference_badge
        result = {}
        for reference in request.references:
            try:
                await _authorize_generation_request(request, username, [reference])
                record = await resolve_media_file_record(reference, file_dao)
                metadata = (record or {}).get("metadata")
                result[reference] = {**image_generation_source(metadata), **verified_text_to_image_source(metadata)}
                if request.include_portrait_eligibility:
                    result[reference].update(await portrait_reference_badge(record))
            except HTTPException as exc:
                if exc.status_code not in (403, 404):
                    raise
                result[reference] = {}
        return {"items": result}

    return router
