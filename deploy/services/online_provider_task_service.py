"""Submission service restricted to configured online-provider task types."""
from __future__ import annotations

import logging
import uuid
from typing import Any, Optional

from fastapi import HTTPException

from core.online_provider_queue import OnlineProviderQueue
from core.online_provider_task_model import OnlineProviderTask
from core.online_provider_task_types import is_online_provider_task
from services.sensitive_data_redaction import redact_sensitive_text

logger = logging.getLogger(__name__)


class OnlineProviderTaskService:
    def __init__(self, redis_client: Any, model_access_checker: Any = None) -> None:
        self.redis = redis_client
        self.queue = OnlineProviderQueue(redis_client)
        self.model_access_checker = model_access_checker

    def get_queue(self) -> OnlineProviderQueue:
        return self.queue

    async def submit(
        self,
        task_type: str,
        task_data: dict[str, Any],
        user_id: str,
        *,
        priority: int = 2,
        task_id: Optional[str] = None,
        prepare: bool = False,
    ) -> str:
        # Shared audio routes explicitly disable preparation. Accept that
        # contract without importing or silently emulating a local executor.
        if prepare is not False:
            raise HTTPException(status_code=422, detail="在线任务不支持本地工作流准备")
        if not is_online_provider_task(task_type):
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "online_provider_task_required",
                    "message": "公开在线运行时不包含本地节点执行器；请配置在线模型或自行实现连接器。",
                },
            )

        task_id = task_id or str(uuid.uuid4())
        from dao_user import UserDAO
        from dao_task import TaskDAO
        from services.online_task_quota_service import (
            load_online_quota_seeds, online_daily_quota, reserve_online_daily_quota,
        )
        from services.credit_service import InsufficientCreditsError
        from services.model_access_service import require_user_model_access
        from services.task_credit_billing_service import release_task_credits, reserve_task_credits

        checker = self.model_access_checker or require_user_model_access
        reserved = False
        daily_quota_key: Optional[str] = None
        try:
            await checker(
                user_id,
                user_dao=UserDAO,
                task_type=task_type,
                task_data=task_data,
            )
            from services.seedance_audio_validation_service import preflight_seedance_reference_audio
            await preflight_seedance_reference_audio(task_type, task_data, user_id)
            window = online_daily_quota(task_type) if self.redis is not None else None
            if window is not None:
                seed_ids = await load_online_quota_seeds(window, task_dao=TaskDAO)
                daily_quota_key = window.key
                await reserve_online_daily_quota(self.queue, window, task_id, seed_ids)
            try:
                reserved = bool(
                    await reserve_task_credits(
                        task_id=task_id,
                        task_type=task_type,
                        task_data=task_data,
                        user_id=user_id,
                    )
                )
            except InsufficientCreditsError as exc:
                raise HTTPException(status_code=402, detail=f"创作点数不足：{exc}") from exc

            from core.video_submission_grace import set_video_submission_grace
            set_video_submission_grace(task_type, task_data)
            task = OnlineProviderTask(
                task_id,
                task_type,
                task_data,
                priority=priority,
                user_id=user_id,
            )
            if not await self.queue.enqueue(task):
                raise HTTPException(status_code=500, detail="任务入队失败")
            return task_id
        except Exception:
            if reserved:
                try:
                    await release_task_credits(
                        task_id=task_id,
                        task_data=task_data,
                        user_id=user_id,
                        reason="enqueue_failed",
                    )
                except Exception as exc:
                    logger.error(
                        "Online task credit rollback failed: %s",
                        redact_sensitive_text(exc),
                        exc_info=True,
                    )
            if daily_quota_key:
                try:
                    await self.queue.release_daily_quota(daily_quota_key, task_id)
                except Exception as exc:
                    logger.error("Online daily quota rollback failed: %s", redact_sensitive_text(exc))
            raise
