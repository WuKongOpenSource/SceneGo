"""HTTP routes for source-edition online-provider task execution only."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable, Optional

import redis.asyncio as redis
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from core.online_provider_task_types import is_online_provider_task
from external_api.video.minimax import normalize_minimax_generation_options
from schemas.generation import GenerateRequest
from services.generation_access_service import (
    GenerationAccessDenied,
    generation_source_references,
    require_generation_request_access,
)
from services.sensitive_data_redaction import redact_sensitive_text
from services.task_read_service import (
    delete_db_task,
    get_task_status_response,
    list_user_tasks_response,
)
from services.video_credit_pricing import validate_seedance_generation_options


def create_online_provider_task_router(
    *,
    require_auth_dependency: Any,
    task_service: Any,
    task_dao: Any,
    file_dao: Any,
    get_pubsub_redis_client: Callable[[], Any],
    logger: logging.Logger,
    generation_access_checker: Any = require_generation_request_access,
) -> APIRouter:
    """Build routes that cannot submit a private local-execution task."""
    router = APIRouter()
    def _queue():
        return task_service.get_queue()

    def _require_online(task_type: str) -> None:
        if not is_online_provider_task(task_type):
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "online_provider_task_required",
                    "message": "此源码运行时只执行已配置的在线模型；本地执行需由部署者自行实现连接器。",
                },
            )

    @router.post("/api/generate/preflight")
    async def preflight(
        request: GenerateRequest,
        username: str = Depends(require_auth_dependency),
    ) -> dict[str, Any]:
        del username
        _require_online(request.task_type)
        queue = _queue()
        pending = await queue.get_external_queue_length()
        processing = await queue.get_external_processing_count()
        return {
            "success": True,
            "queue_mode": "online_provider",
            "runtime_profile": None,
            "tasks_ahead": max(0, pending) + max(0, processing),
            "estimated_wait_seconds": None,
            "requires_confirmation": False,
            "can_cancel_before_submit": True,
            "accepting_submissions": True,
        }

    @router.post("/api/generate")
    async def create_task(
        request: GenerateRequest,
        username: str = Depends(require_auth_dependency),
    ) -> dict[str, Any]:
        _require_online(request.task_type)
        try:
            await generation_access_checker(
                request,
                username,
                generation_source_references(request),
                file_dao=file_dao,
            )
        except GenerationAccessDenied as exc:
            raise HTTPException(status_code=404, detail="Generation scope or source not found") from exc

        task_data = request.model_dump()
        if request.task_type in {"minimax_i2v", "minimax_morph"}:
            raw_duration = request.duration if "duration" in request.model_fields_set else None
            try:
                duration, resolution = normalize_minimax_generation_options(
                    raw_duration,
                    task_data.get("minimax_resolution"),
                )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            task_data["duration"] = duration
            task_data["minimax_resolution"] = resolution
        try:
            validate_seedance_generation_options(task_data)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        queue = _queue()
        pending = await queue.get_external_queue_length()
        processing = await queue.get_external_processing_count()
        try:
            task_id = await task_service.submit(
                request.task_type,
                task_data,
                username,
                priority=min(3, max(1, int(request.priority))),
            )
        except HTTPException:
            raise
        except Exception as exc:
            logger.error(
                "Online task submission failed: %s",
                redact_sensitive_text(exc),
                exc_info=True,
            )
            raise HTTPException(status_code=500, detail="任务提交失败") from exc

        deadline = task_data.get("cancel_deadline")
        return {
            "success": True,
            "task_id": task_id,
            "message": "任务已加入在线模型队列",
            "queue_position": max(0, pending) + max(0, processing) + 1,
            "queue_mode": "online_provider",
            "runtime_profile": None,
            "tasks_ahead": max(0, pending) + max(0, processing),
            "estimated_wait_seconds": None,
            "requires_confirmation": False,
            "can_cancel_before_submit": True,
            "accepting_submissions": True,
            **({"cancel_deadline": deadline, "can_cancel": True} if deadline else {}),
        }

    @router.get("/api/task/{task_id}")
    async def get_task(
        task_id: str,
        username: str = Depends(require_auth_dependency),
    ) -> dict[str, Any]:
        response = await get_task_status_response(
            task_id=task_id,
            task_queue=_queue(),
            task_dao=task_dao,
            logger=logger,
            username=username,
        )
        if not response:
            raise HTTPException(status_code=404, detail="任务不存在")
        return response

    @router.delete("/api/task/{task_id}")
    async def cancel_task(
        task_id: str,
        username: str = Depends(require_auth_dependency),
    ) -> dict[str, Any]:
        visible = await get_task_status_response(
            task_id=task_id,
            task_queue=_queue(),
            task_dao=task_dao,
            logger=logger,
            username=username,
        )
        if not visible:
            raise HTTPException(status_code=404, detail="任务不存在")
        from core.task_dispatch_guard import cancellation_response

        try:
            success = await _queue().cancel_task(task_id)
        except Exception:
            logger.exception("Could not confirm cancellation for task %s", task_id)
            raise HTTPException(status_code=503, detail="暂时无法确认取消结果，请稍后重试；重复取消不会重复退还积分")
        if not success:
            raise HTTPException(status_code=409, detail="任务已提交执行或已结束，无法取消；只有尚未提交的排队任务可以取消并退还积分")
        return await cancellation_response(_queue(), task_id)

    @router.delete("/api/task/{task_id}/delete")
    async def delete_task(
        task_id: str,
        username: str = Depends(require_auth_dependency),
    ) -> dict[str, Any]:
        visible = await get_task_status_response(
            task_id=task_id,
            task_queue=_queue(),
            task_dao=task_dao,
            logger=logger,
            username=username,
        )
        if not visible:
            raise HTTPException(status_code=404, detail="任务不存在")
        if visible.get("status") in {"pending", "queued", "processing"}:
            raise HTTPException(status_code=409, detail="请先取消尚未提交的排队任务；执行中的任务不能删除")
        if visible.get("refund_status") == "pending":
            raise HTTPException(status_code=409, detail="积分退还处理中，请到账后再删除任务记录")
        await delete_db_task(
            task_id=task_id,
            username=username,
            task_dao=task_dao,
            logger=logger,
        )
        await _queue().delete_task(task_id)
        return {
            "success": True,
            "message": "任务记录已删除；关联素材仍由素材库生命周期单独管理",
            "deleted_files_count": 0,
        }

    @router.get("/api/tasks")
    async def list_tasks(
        username: str = Depends(require_auth_dependency),
        limit: int = 100,
        status: Optional[str] = None,
    ) -> dict[str, Any]:
        return await list_user_tasks_response(
            username=username,
            limit=min(200, max(1, int(limit))),
            status=status,
            task_queue=_queue(),
            task_dao=task_dao,
            logger=logger,
        )

    @router.get("/api/tasks/stream")
    async def task_event_stream(
        request: Request,
        username: str = Depends(require_auth_dependency),
    ) -> StreamingResponse:
        async def event_generator():
            pubsub = None
            try:
                pubsub = get_pubsub_redis_client().pubsub()
                await pubsub.psubscribe("task_progress:*")
                await pubsub.subscribe(f"task_complete:{username}", f"task_failed:{username}")
                yield "event: ready\ndata: {}\n\n"
                while not await request.is_disconnected():
                    try:
                        message = await pubsub.get_message(
                            ignore_subscribe_messages=True,
                            timeout=1.0,
                        )
                    except (redis.ConnectionError, asyncio.CancelledError):
                        break
                    if message and message.get("type") in {"message", "pmessage"}:
                        raw = message.get("data")
                        raw = raw.decode("utf-8") if isinstance(raw, bytes) else str(raw or "")
                        try:
                            payload = json.loads(raw)
                        except (TypeError, ValueError, json.JSONDecodeError):
                            payload = None
                        if isinstance(payload, dict) and payload.get("task_id"):
                            task = await _queue().get_task(str(payload["task_id"]))
                            if task and str(task.user_id or "") == str(username):
                                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                    await asyncio.sleep(0.1)
            except Exception as exc:
                logger.error("Online task event stream failed: %s", redact_sensitive_text(exc))
                yield "event: error\ndata: {\"reason\":\"pubsub_unavailable\"}\n\n"
            finally:
                if pubsub is not None:
                    for cleanup in (pubsub.punsubscribe, pubsub.unsubscribe, pubsub.close):
                        try:
                            await cleanup()
                        except Exception:
                            pass

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    return router
