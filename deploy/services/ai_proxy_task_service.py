"""Task persistence helpers for AI proxy routes."""
from __future__ import annotations

import json
import re
import time
from typing import Any, Callable, Dict, Optional


TimestampMsProvider = Callable[[], int]

_TEXT_CONTEXT_KEYS = (
    "operation",
    "display_name",
    "project_id",
    "episode_id",
    "source_page",
    "source_item_id",
    "entity_type",
    "entity_id",
    "suppress_notification",
)


def format_public_text_task_name(
    value: Any,
    *,
    provider: str = "",
    model: Optional[str] = None,
) -> str:
    """Translate provider/runtime text names to creator-facing model labels."""

    provider_key = str(provider or "").strip().lower()
    model_key = str(model or "").strip().lower()
    if provider_key == "deepseek":
        public_label = (
            "deepseek-v4-pro · 推理写作模型"
            if any(token in model_key for token in ("reasoner", "r1", "v4-pro", "v4_pro"))
            else "deepseek-v4-flash · 快速写作模型"
        )
    elif provider_key == "minimax":
        public_label = "MiniMax-M3 · 连续写作模型"
    elif provider_key == "gemini":
        public_label = "gemini-2.5-flash · 全能写作模型"
    else:
        public_label = "AI 文本生成"

    text = str(value or "").strip()
    if not text:
        return public_label

    exact_text_generation = re.fullmatch(
        r"(?:deepseek(?:[\s_-]*(?:reasoner|r1|chat|v4[\s_-]*(?:pro|flash)))?|minimax[\s_-]*m3|gemini)\s*文本生成",
        text,
        flags=re.IGNORECASE,
    )
    if exact_text_generation:
        if re.search(r"deepseek[\s_-]*(?:reasoner|r1|v4[\s_-]*pro)", text, flags=re.IGNORECASE):
            return "deepseek-v4-pro · 推理写作模型"
        if re.search(r"minimax[\s_-]*m3", text, flags=re.IGNORECASE):
            return "MiniMax-M3 · 连续写作模型"
        if re.search(r"gemini", text, flags=re.IGNORECASE):
            return "gemini-2.5-flash · 全能写作模型"
        return public_label

    replacements = (
        (r"deepseek[\s_-]*(?:reasoner|r1|v4[\s_-]*pro)", "deepseek-v4-pro · 推理写作模型"),
        (r"deepseek[\s_-]*(?:chat|v4[\s_-]*flash)", "deepseek-v4-flash · 快速写作模型"),
        (r"deepseek", public_label if provider_key == "deepseek" else "deepseek-v4-flash · 快速写作模型"),
        (r"minimax[\s_-]*m3", "MiniMax-M3 · 连续写作模型"),
        (r"gemini", "gemini-2.5-flash · 全能写作模型"),
    )
    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    return re.sub(r"\s{2,}", " ", text).strip()


def _default_timestamp_ms() -> int:
    return int(time.time() * 1000)


def _truncate_text(text: str, *, limit: int = 2000) -> str:
    return text[:limit] if len(text) > limit else text


async def _default_task_dao() -> Any:
    from dao_task import TaskDAO

    return TaskDAO


async def _default_notification_dao() -> Any:
    from dao_notification import NotificationDAO

    return NotificationDAO


def _normalize_text_context(task_context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(task_context, dict):
        return {}
    normalized: Dict[str, Any] = {}
    for key in _TEXT_CONTEXT_KEYS:
        value = task_context.get(key)
        if key == "suppress_notification" and isinstance(value, bool):
            normalized[key] = value
            continue
        if isinstance(value, str) and value.strip():
            normalized[key] = value.strip()[:200]
    return normalized


async def _emit_text_task_terminal(
    *,
    task_id: str,
    user_id: Optional[str],
    task_type: str,
    status: str,
    task_context: Optional[Dict[str, Any]],
    logger: Any,
    error_message: str = "",
    redis_client: Optional[Any] = None,
    notification_dao: Optional[Any] = None,
) -> None:
    """Publish the same terminal event shape used by queued tasks and persist it."""

    if not user_id:
        return

    context = _normalize_text_context(task_context)
    if context.get("suppress_notification") is True:
        return
    task_provider = task_type.split("_", 1)[0]
    display_name = format_public_text_task_name(
        context.get("display_name"),
        provider=task_provider,
    )
    project_id = context.get("project_id", "")
    source_page = context.get("source_page", "global")
    event_type = "task_complete" if status == "completed" else "task_failed"
    payload = {
        "type": event_type,
        "task_id": task_id,
        "status": status,
        "task_type": task_type,
        "display_name": display_name,
        "project_id": project_id,
        "source_page": source_page,
        "source_item_id": context.get("source_item_id", ""),
        "entity_type": context.get("entity_type", ""),
        "entity_id": context.get("entity_id", ""),
        "file_role": "",
        "episode_id": context.get("episode_id", ""),
    }
    if error_message:
        payload["error"] = error_message[:1000]

    if redis_client is not None:
        try:
            await redis_client.publish(
                f"{event_type}:{user_id}",
                json.dumps(payload, ensure_ascii=False),
            )
        except Exception as exc:
            logger.warning("AI proxy text terminal event publish failed: %s", exc)

    try:
        dao = notification_dao or await _default_notification_dao()
        succeeded = status == "completed"
        await dao.create(
            user_id=user_id,
            title=f"{display_name} {'已完成' if succeeded else '失败'}",
            message=(
                f"任务 {task_id} 执行成功"
                if succeeded
                else f"任务 {task_id} 执行失败: {error_message[:200]}"
            ),
            category="text",
            task_id=task_id,
            target_view="Script",
            target_project_id=project_id or None,
            target_page=source_page,
            target_item_id=context.get("source_item_id") or None,
            metadata={
                "operation": context.get("operation", ""),
                "episode_id": context.get("episode_id", ""),
                "entity_type": context.get("entity_type", ""),
                "entity_id": context.get("entity_id", ""),
            },
        )
    except Exception as exc:
        logger.warning("AI proxy text notification persistence failed: %s", exc)


async def create_ai_proxy_task(
    *,
    task_id_prefix: str,
    user_id: str,
    task_type: str,
    task_data: Dict[str, Any],
    logger: Any,
    task_dao: Optional[Any] = None,
    timestamp_ms_provider: TimestampMsProvider = _default_timestamp_ms,
) -> Optional[str]:
    """Create an AI proxy task row as best-effort bookkeeping."""

    # Account access is authoritative and must fail closed before a billable
    # provider call. Task-row persistence below remains best-effort.
    from dao_user import UserDAO
    from services.model_access_service import require_user_model_access

    # Production callers use the canonical DAO resolved below. Passing an
    # explicit task DAO is the supported isolated-test/integration seam.
    if task_dao is None:
        await require_user_model_access(
            user_id,
            user_dao=UserDAO,
            model=str(task_data.get("model") or task_data.get("provider") or ""),
            task_type=task_type,
            task_data=task_data,
        )

    try:
        dao = task_dao or await _default_task_dao()
        task_id = f"{task_id_prefix}_{timestamp_ms_provider()}"
        await dao.create_task(
            task_id=task_id,
            user_id=user_id,
            task_type=task_type,
            task_data=task_data,
        )
        logger.info("AI proxy task created: %s", task_id)
        return task_id
    except Exception as exc:
        logger.error("AI proxy task create failed: %s", exc, exc_info=True)
        return None


async def complete_ai_proxy_text_task(
    *,
    task_id: str,
    text_content: str,
    logger: Any,
    task_dao: Optional[Any] = None,
    user_id: Optional[str] = None,
    task_type: str = "text",
    task_context: Optional[Dict[str, Any]] = None,
    redis_client: Optional[Any] = None,
    notification_dao: Optional[Any] = None,
) -> bool:
    """Persist a completed streaming/text result back to the task table."""

    try:
        dao = task_dao or await _default_task_dao()
        await dao.update_task_status(
            task_id=task_id,
            status="completed",
            result_data={"text": _truncate_text(text_content), "full_length": len(text_content)},
        )
        logger.info("AI proxy text task completed: %s length=%s", task_id, len(text_content))
        await _emit_text_task_terminal(
            task_id=task_id,
            user_id=user_id,
            task_type=task_type,
            status="completed",
            task_context=task_context,
            logger=logger,
            redis_client=redis_client,
            notification_dao=notification_dao,
        )
        return True
    except Exception as exc:
        logger.error("AI proxy text task completion failed: %s", exc, exc_info=True)
        return False


async def start_ai_proxy_task(
    *,
    task_id_prefix: str,
    user_id: str,
    task_type: str,
    task_data: Dict[str, Any],
    logger: Any,
    task_dao: Optional[Any] = None,
    timestamp_ms_provider: TimestampMsProvider = _default_timestamp_ms,
) -> Optional[str]:
    """Create an AI proxy task and mark it processing immediately."""

    task_id = await create_ai_proxy_task(
        task_id_prefix=task_id_prefix,
        user_id=user_id,
        task_type=task_type,
        task_data=task_data,
        logger=logger,
        task_dao=task_dao,
        timestamp_ms_provider=timestamp_ms_provider,
    )
    if not task_id:
        return None

    try:
        dao = task_dao or await _default_task_dao()
        await dao.update_task_status(task_id=task_id, status="processing")
        logger.info("AI proxy task started: %s", task_id)
    except Exception as exc:
        logger.error("AI proxy task start failed: %s", exc, exc_info=True)
    return task_id


async def complete_ai_proxy_image_task(
    *,
    task_id: Optional[str],
    images_count: int,
    reference_snapshot: Optional[list[dict[str, Any]]] = None,
    logger: Any,
    task_dao: Optional[Any] = None,
) -> bool:
    """Persist a completed image generation task."""

    if not task_id:
        return False
    try:
        dao = task_dao or await _default_task_dao()
        result_data: Dict[str, Any] = {"images_count": images_count}
        if reference_snapshot is not None:
            result_data["reference_snapshot"] = reference_snapshot
        await dao.update_task_status(
            task_id=task_id,
            status="completed",
            result_data=result_data,
        )
        logger.info("AI proxy image task completed: %s images=%s", task_id, images_count)
        return True
    except Exception as exc:
        logger.error("AI proxy image task completion failed: %s", exc, exc_info=True)
        return False


async def fail_ai_proxy_task(
    *,
    task_id: Optional[str],
    error_message: str,
    logger: Any,
    task_dao: Optional[Any] = None,
    user_id: Optional[str] = None,
    task_type: str = "text",
    task_context: Optional[Dict[str, Any]] = None,
    redis_client: Optional[Any] = None,
    notification_dao: Optional[Any] = None,
) -> bool:
    """Persist a failed AI proxy task without masking the original error."""

    if not task_id:
        return False
    try:
        dao = task_dao or await _default_task_dao()
        await dao.update_task_status(
            task_id=task_id,
            status="failed",
            error_message=error_message[:1000],
        )
        logger.info("AI proxy task failed: %s", task_id)
        if user_id:
            await _emit_text_task_terminal(
                task_id=task_id,
                user_id=user_id,
                task_type=task_type,
                status="failed",
                task_context=task_context,
                logger=logger,
                error_message=error_message,
                redis_client=redis_client,
                notification_dao=notification_dao,
            )
        return True
    except Exception as exc:
        logger.error("AI proxy task failure persistence failed: %s", exc, exc_info=True)
        return False


async def create_deepseek_text_task(
    *,
    user_id: str,
    prompt: str,
    response_format: Optional[str],
    temperature: float,
    logger: Any,
    model: Optional[str] = None,
    task_dao: Optional[Any] = None,
    timestamp_ms_provider: TimestampMsProvider = _default_timestamp_ms,
    task_context: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    task_data = {
        "prompt": prompt[:500],
        "response_format": response_format,
        "temperature": temperature,
        "model": model,
    }
    task_data.update(_normalize_text_context(task_context))
    return await start_ai_proxy_task(
        task_id_prefix="deepseek_text",
        user_id=user_id,
        task_type="deepseek_text",
        task_data=task_data,
        logger=logger,
        task_dao=task_dao,
        timestamp_ms_provider=timestamp_ms_provider,
    )


async def create_minimax_text_task(
    *,
    user_id: str,
    prompt: str,
    response_format: Optional[str],
    temperature: float,
    logger: Any,
    model: Optional[str] = None,
    task_dao: Optional[Any] = None,
    timestamp_ms_provider: TimestampMsProvider = _default_timestamp_ms,
    task_context: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    task_data = {
        "prompt": prompt[:500],
        "response_format": response_format,
        "temperature": temperature,
        "model": model or "minimax-m3",
    }
    task_data.update(_normalize_text_context(task_context))
    return await start_ai_proxy_task(
        task_id_prefix="minimax_text",
        user_id=user_id,
        task_type="minimax_text",
        task_data=task_data,
        logger=logger,
        task_dao=task_dao,
        timestamp_ms_provider=timestamp_ms_provider,
    )


async def create_gemini_text_task(
    *,
    user_id: str,
    prompt: str,
    system_prompt: Optional[str],
    temperature: float,
    model: Optional[str],
    logger: Any,
    task_dao: Optional[Any] = None,
    timestamp_ms_provider: TimestampMsProvider = _default_timestamp_ms,
    task_context: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    task_data = {
        "prompt": prompt[:500],
        "system_prompt": system_prompt[:200] if system_prompt else None,
        "temperature": temperature,
        "model": model,
    }
    task_data.update(_normalize_text_context(task_context))
    return await start_ai_proxy_task(
        task_id_prefix="gemini_text",
        user_id=user_id,
        task_type="gemini_text",
        task_data=task_data,
        logger=logger,
        task_dao=task_dao,
        timestamp_ms_provider=timestamp_ms_provider,
    )


async def create_completed_gemini_text_task(
    *,
    user_id: str,
    prompt: str,
    system_prompt: Optional[str],
    temperature: float,
    model: Optional[str],
    content: str,
    logger: Any,
    task_dao: Optional[Any] = None,
    timestamp_ms_provider: TimestampMsProvider = _default_timestamp_ms,
    task_context: Optional[Dict[str, Any]] = None,
    redis_client: Optional[Any] = None,
    notification_dao: Optional[Any] = None,
) -> Optional[str]:
    task_id = await create_gemini_text_task(
        user_id=user_id,
        prompt=prompt,
        system_prompt=system_prompt,
        temperature=temperature,
        model=model,
        logger=logger,
        task_dao=task_dao,
        timestamp_ms_provider=timestamp_ms_provider,
        task_context=task_context,
    )
    if task_id:
        await complete_ai_proxy_text_task(
            task_id=task_id,
            text_content=content,
            logger=logger,
            task_dao=task_dao,
            user_id=user_id,
            task_type="gemini_text",
            task_context=task_context,
            redis_client=redis_client,
            notification_dao=notification_dao,
        )
    return task_id


async def create_completed_image_task(
    *,
    task_id_prefix: str,
    user_id: str,
    task_type: str,
    task_data: Dict[str, Any],
    images_count: int,
    logger: Any,
    task_dao: Optional[Any] = None,
    timestamp_ms_provider: TimestampMsProvider = _default_timestamp_ms,
) -> Optional[str]:
    task_id = await create_ai_proxy_task(
        task_id_prefix=task_id_prefix,
        user_id=user_id,
        task_type=task_type,
        task_data=task_data,
        logger=logger,
        task_dao=task_dao,
        timestamp_ms_provider=timestamp_ms_provider,
    )
    if task_id:
        await complete_ai_proxy_image_task(
            task_id=task_id,
            images_count=images_count,
            logger=logger,
            task_dao=task_dao,
        )
    return task_id
