"""Queue worker for tasks executed by configured online providers.

This module deliberately has no dependency on cluster managers, ComfyUI
clients, workflow definitions, or GPU-node discovery.  Keeping that boundary
explicit lets a source release include online-provider execution without
accidentally publishing the platform's private local-node implementation.
"""
from __future__ import annotations

import asyncio
import json
import logging
import signal
from datetime import datetime
from typing import Optional

from core.online_provider_tasks import OnlineProviderTaskHandlers
from core.runtime_config import WorkerConfig
from core.online_provider_task_model import OnlineProviderTask
from core.online_provider_task_types import is_online_provider_task
from services.sensitive_data_redaction import redact_sensitive_text

logger = logging.getLogger(__name__)

try:
    from dao_task import TaskDAO

    DB_AVAILABLE = True
except ImportError:
    TaskDAO = None
    DB_AVAILABLE = False


class OnlineProviderWorker(OnlineProviderTaskHandlers):
    """Consume only the queue reserved for online-provider tasks."""

    def __init__(self, worker_id: str, redis_client, task_queue, *, register_signals: bool = True):
        self.worker_id = worker_id
        self.redis = redis_client
        self.task_queue = task_queue
        self.running = False
        self.current_task: Optional[OnlineProviderTask] = None
        self.tasks_processed = 0
        self.tasks_failed = 0
        self.start_time = datetime.now()
        self._heartbeat_task: Optional[asyncio.Task] = None
        self.register_signals = bool(register_signals)

    async def start(self) -> None:
        """Run until a termination signal or an explicit stop request."""
        self.running = True
        logger.info("Online-provider worker %s started", self.worker_id)
        try:
            if self.register_signals:
                signal.signal(signal.SIGINT, self._signal_handler)
                signal.signal(signal.SIGTERM, self._signal_handler)
            self._heartbeat_task = asyncio.create_task(
                self._heartbeat_loop(), name=f"online-provider-heartbeat:{self.worker_id}"
            )
            await self._process_loop()
        finally:
            self.running = False
            await self._stop_heartbeat()

    def _signal_handler(self, signum, frame) -> None:
        logger.info("Online-provider worker %s received stop signal", self.worker_id)
        self.running = False

    async def stop(self) -> None:
        self.running = False
        try:
            if self.current_task:
                logger.info("Waiting for task %s before stopping", self.current_task.task_id)
                await asyncio.sleep(WorkerConfig.GRACEFUL_SHUTDOWN_TIMEOUT)
        finally:
            await self._stop_heartbeat()
        logger.info("Online-provider worker %s stopped", self.worker_id)

    async def _stop_heartbeat(self) -> None:
        """Join the owned heartbeat even if graceful task waiting is cancelled."""
        task = self._heartbeat_task
        if task is not None:
            task.cancel()
            try:
                await asyncio.gather(task, return_exceptions=True)
            finally:
                if task.done() and self._heartbeat_task is task:
                    self._heartbeat_task = None

    async def _heartbeat_loop(self) -> None:
        while self.running:
            try:
                await self._send_heartbeat()
                await asyncio.sleep(WorkerConfig.WORKER_HEARTBEAT_INTERVAL)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error("Online-provider heartbeat failed: %s", redact_sensitive_text(exc))

    async def _send_heartbeat(self) -> None:
        await self.redis.hset(
            WorkerConfig.WORKER_STATUS_KEY,
            self.worker_id,
            json.dumps(
                {
                    "last_heartbeat": datetime.now().isoformat(),
                    "current_task": self.current_task.task_id if self.current_task else None,
                    "tasks_processed": self.tasks_processed,
                    "tasks_failed": self.tasks_failed,
                    "uptime": (datetime.now() - self.start_time).total_seconds(),
                    "worker_kind": "online_provider",
                }
            ),
        )
        await self.redis.expire(WorkerConfig.WORKER_STATUS_KEY, WorkerConfig.WORKER_TIMEOUT)

    async def _process_loop(self) -> None:
        while self.running:
            try:
                task = await self.task_queue.dequeue(timeout=5, external_only=True)
                if not task:
                    await asyncio.sleep(1)
                    continue

                self.current_task = task
                success = await self._process_task(task)
                if success:
                    self.tasks_processed += 1
                else:
                    self.tasks_failed += 1
                self.current_task = None
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error(
                    "Online-provider worker loop failed: %s",
                    redact_sensitive_text(exc),
                    exc_info=True,
                )
                if self.current_task:
                    await self.task_queue.fail_task(
                        self.current_task.task_id,
                        redact_sensitive_text(exc),
                    )
                    self.current_task = None

    async def _record_task_start(self, task: OnlineProviderTask) -> None:
        if not DB_AVAILABLE:
            return
        try:
            await TaskDAO.create_task(
                task_id=task.task_id,
                user_id=task.user_id,
                task_type=task.task_type,
                task_data=task.data,
            )
            await TaskDAO.update_task_status(task_id=task.task_id, status="processing")
        except Exception as exc:
            logger.warning("Could not persist online-provider task start: %s", redact_sensitive_text(exc))

    async def _process_task(self, task: OnlineProviderTask) -> bool:
        """Dispatch one task while refusing anything outside the online lane."""
        if not is_online_provider_task(task.task_type):
            await self.task_queue.fail_task(
                task.task_id,
                "Task type is not supported by the online-provider worker",
                retry=False,
            )
            return False

        if not await self.task_queue.begin_submission(task.task_id):
            return True
        await self._record_task_start(task)

        if task.task_type in {"minimax_i2v", "minimax_morph"}:
            return await self._process_minimax_task(task)
        if task.task_type in {"sora2_i2v", "sora2_morph"}:
            return await self._process_sora2_task(task)
        if task.task_type in {"veo_i2v", "veo_morph"}:
            return await self._process_veo_task(task)
        if task.task_type == "wan26_i2v":
            return await self._process_wan26_task(task)
        if task.task_type.startswith("seedance_"):
            return await self._process_seedance_task(task)
        if task.task_type.startswith(("kling_", "vidu_", "happyhorse_")):
            return await self._process_dashscope_video_task(task)
        if task.task_type == "minimax_tts":
            return await self._process_minimax_tts_task(task)
        if task.task_type == "video_reverse_prompt":
            return await self._process_video_reverse_task(task)

        await self.task_queue.fail_task(
            task.task_id,
            "Online-provider task type is not implemented",
            retry=False,
        )
        return False
