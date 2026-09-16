"""Durable independent CLI job runner. An uncertain paid submit is never replayed."""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time

from core.online_provider_task_model import OnlineProviderTask, OnlineTaskStatus
from dao.business.jimeng_job import JimengJobDAO
from dao.business.task import TaskDAO
from services.jimeng_cli_runtime import CliConfig, JimengCli, CliNotStarted
from services.jimeng_contract import TASK_TYPE, JimengError
from services.jimeng_media_service import inspect_inputs, trace_inputs
from services.jimeng_result_service import inspect_result, persist_result
from services.task_credit_billing_service import settle_task_credits, release_task_credits
from services.generation_access_service import GenerationAccessDenied
from services.jimeng_access_service import JimengAccessDenied, require_jimeng_admin

logger = logging.getLogger(__name__)


def binding_matches(job, config):
    return all(str(job.get(k) or "") == str(getattr(config, k)) for k in ("account_id", "session_id", "state_id"))


async def review(queue, task, message):
    await JimengJobDAO.update(task.task_id, stage="review_required", message=message)
    await queue.update_progress(task.task_id, 0, message)


async def advance(queue, task, config):
    """One bounded transition under a cross-process account lock."""
    async with JimengJobDAO.account_lock(config.account_id) as locked:
        if locked is None:
            return
        job = await JimengJobDAO.get(task.task_id)
        if not job or job["stage"] in {"completed", "failed", "review_required"}:
            return
        if not binding_matches(job, config):
            await review(queue, task, "即梦绑定账号、专用会话或持久化状态已变化，暂停并核查原任务。")
            return
        current = await queue.get_task(task.task_id)
        if current and str(current.status) in {"cancelled", "OnlineTaskStatus.CANCELLED", "TaskStatus.CANCELLED"}:
            if job["stage"] == "waiting":
                await JimengJobDAO.update(task.task_id, stage="failed", message="提交前已取消")
            else:
                await review(queue, task, "即梦任务已经提交，取消状态需要人工核查，不能重复生成。")
            return
        # Only server-persisted data, not mutable Redis/UI progress fields, drive execution.
        task.data = dict(job["task_data"])
        stage, cli = job["stage"], JimengCli(config)
        if stage == "submitting":
            await review(queue, task, "即梦提交结果未确认，请管理员核查供应商记录；已停止自动重试。")
            return
        if stage == "waiting":
            try:
                await require_jimeng_admin(task.user_id)
            except JimengAccessDenied:
                await JimengJobDAO.update(task.task_id, stage="refund_pending",
                    message="该真人视频模型仅限管理员使用，当前权限已变化；本次未提交，将退还预留创作点数。")
                return
            if await JimengJobDAO.account_busy(config.account_id, task.task_id):
                await queue.update_progress(task.task_id, 0, "等待即梦独立账号通道；尚未提交供应商")
                return
            await cli.account_status()
            from dao.content.content import FileDAO
            directory = config.private_directory(task.task_id)
            try:
                inputs = await inspect_inputs(task.data, task.user_id, file_dao=FileDAO, directory=directory)
                trace = trace_inputs(inputs)
                if trace != task.data.get("_jimeng_input_trace"):
                    raise JimengError("参考原文件已变化，本次未提交，请重新确认素材。")
                # Media verification may be slow; recheck immediately before
                # the paid boundary, not only when this request was enqueued.
                await require_jimeng_admin(task.user_id)
            except JimengAccessDenied:
                await JimengJobDAO.update(task.task_id, stage="refund_pending",
                    message="该真人视频模型仅限管理员使用，当前权限已变化；本次未提交，将退还预留创作点数。")
                return
            except JimengError as exc:
                await JimengJobDAO.update(task.task_id, stage="refund_pending", message=str(exc))
                return
            except GenerationAccessDenied:
                await JimengJobDAO.update(task.task_id, stage="refund_pending",
                    message="当前项目或原素材的访问权限已变化，本次未提交，退还预留创作点数。")
                return
            if not await queue.begin_submission(task.task_id):
                return
            await JimengJobDAO.update(task.task_id, stage="waiting", trace=trace)
            # This autocommit must finish before the first possible paid action.
            if not await JimengJobDAO.mark_submitting(task.task_id):
                return
            try:
                response = await cli.submit(task.data, inputs)
                submit_id = response.get("submit_id")
                if not isinstance(submit_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,160}", submit_id):
                    raise JimengError("Missing provider identity")
                credits = response.get("credit_count")
                credits = credits if isinstance(credits, int) and credits >= 0 else None
                await JimengJobDAO.update(task.task_id, stage="submitted", submit_id=submit_id,
                    provider_credits=credits, message="即梦已接收，等待供应商生成；不能估算整体进度")
            except CliNotStarted:
                await JimengJobDAO.update(task.task_id, stage="waiting", message="等待即梦账号检查结束；供应商尚未提交")
                # Only this exception proves no process started. Restore the
                # pre-submit cancellation boundary under the account lock.
                task.data.pop("_jimeng_paid_intent", None)
                await queue.restore_jimeng_task(task)
                return
            except Exception:
                # Even a CLI error could follow upstream acceptance. Never refund/resubmit on this path.
                await review(queue, task, "即梦提交结果未确认，请管理员核查供应商记录；已停止自动重试。")
                return
            await queue.update_progress(task.task_id, 0, "即梦已接收，等待供应商生成；不能估算整体进度")
            return
        if stage == "refund_pending":
            await release_task_credits(task_id=task.task_id, task_data=task.data, user_id=task.user_id, reason="jimeng_terminal_failure")
            message = job.get("message") or "即梦已确认生成失败，已退还预留创作点数。"
            await TaskDAO.update_task_status(task.task_id, "failed", error_message=message)
            if await queue.fail_task(task.task_id, message, retry=False):
                await JimengJobDAO.update(task.task_id, stage="failed", message=message)
            return
        if stage == "settling":
            if not job.get("result_data"):
                await review(queue, task, "即梦结果记录不完整，待人工核查；不会重新生成。")
                return
            await settle_task_credits(task_id=task.task_id, task_data=task.data, user_id=task.user_id)
            await TaskDAO.update_task_status(task.task_id, "completed", result_data=job["result_data"])
            if await queue.complete_task(task.task_id, job["result_data"]):
                await JimengJobDAO.update(task.task_id, stage="completed", message="成片已保存")
            return
        if not job.get("submit_id"):
            await review(queue, task, "即梦任务编号缺失，需人工核查，不能重新提交。")
            return
        await cli.account_status()
        directory = config.private_directory(task.task_id)
        await queue.update_progress(task.task_id, 0, "正在查询即梦原任务；生成及下载耗时暂不能估算")
        response = await cli.query(job["submit_id"], directory)
        if response.get("submit_id") != job["submit_id"]:
            await review(queue, task, "即梦返回的任务编号不一致，已暂停保存。")
            return
        status = response.get("gen_status")
        if status == "fail":
            # The raw failure payload may contain paths, device codes or provider internals.
            await JimengJobDAO.update(task.task_id, stage="refund_pending",
                message="即梦已确认生成失败，将退还预留创作点数；请检查素材是否符合供应商规范。")
        elif status == "success":
            await JimengJobDAO.update(task.task_id, stage="persisting", message="即梦生成完成，正在校验和保存原成片")
            path, metadata = await asyncio.to_thread(inspect_result, response, directory, task.data["duration"])
            result = await persist_result(task, path, metadata, job)
            await JimengJobDAO.update(task.task_id, stage="settling", result=result, message="成片已保存，正在确认创作点数")
        else:
            await JimengJobDAO.update(task.task_id, stage="submitted",
                message="即梦正在排队或生成；仅查询原任务，不会重复提交", delay=30)


async def process_jimeng(queue, task):
    """Never leak an uncertain job into the generic automatic retry handler."""
    try:
        config = await asyncio.to_thread(CliConfig.load)
        persisted = await TaskDAO.get_task(task.task_id)
        if not persisted:
            # The public queue may have been claimed just before its SQL mirror
            # completed. Create once; conflicts retain the original request.
            persisted = await TaskDAO.create_task(task_id=task.task_id, user_id=task.user_id,
                task_type=TASK_TYPE, task_data=task.data)
        if not persisted or persisted.get("user_id") != task.user_id or persisted.get("task_type") != TASK_TYPE:
            raise JimengError("任务归属尚未持久化，本次未提交。")
        if persisted.get("status") == "completed":
            result = persisted.get("result_data")
            if isinstance(result, str):
                result = json.loads(result)
            if result:
                await queue.complete_task(task.task_id, result)
            return True
        if persisted.get("status") in {"failed", "timeout"}:
            await queue.fail_task(task.task_id, '任务已结束，本次不会重新生成。', retry=False)
            return True
        if persisted.get("status") == 'cancelled':
            await queue.cancel_task(task.task_id)
            return True
        data = persisted.get("task_data")
        task.data = json.loads(data) if isinstance(data, str) else dict(data or {})
        if not binding_matches(task.data.get("_jimeng_binding") or {}, config) or not task.data.get("_credit_billing"):
            raise JimengError("即梦账号绑定或创作点数预留缺失，本次未提交。")
        if not await JimengJobDAO.mark_processing(task.task_id):
            return True
        job = await JimengJobDAO.get(task.task_id)
        if not job:
            await JimengJobDAO.ensure(task, config)
        await advance(queue, task, config)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        # No raw exception text: local paths, OAuth output and prompts are private.
        logger.warning("Jimeng task paused task=%s error_type=%s", task.task_id, type(exc).__name__)
        try:
            await queue.update_progress(task.task_id, 0, "即梦任务等待恢复或核查；不会自动重新生成")
        except Exception:
            logger.warning("Jimeng progress write unavailable task=%s", task.task_id)
    return True


async def restore_queue_task(queue, task, *, prefix, processing_key, user_prefix, ttl):
    """Restore only durable job records; submitted state is atomic with Redis data."""
    from core.task_dispatch_guard import save_task_unless_cancelled
    values = task.to_dict()
    values.update(status="processing", dispatch_state="submitted" if task.data.get("_jimeng_paid_intent") else "preparing")
    values["data"] = json.dumps(task.data, ensure_ascii=False)
    values["result"] = json.dumps(task.result) if task.result else ""
    mapping = {key: "" if value is None else str(value) for key, value in values.items()}
    await save_task_unless_cancelled(queue.redis, prefix + task.task_id, mapping, ttl)
    await queue.redis.zadd(processing_key, {task.task_id: int(time.time())})
    await queue.redis.zadd(user_prefix + task.user_id, {task.task_id: int(time.time())})


async def jimeng_recovery_loop(queue):
    while True:
        try:
            config = await asyncio.to_thread(CliConfig.load)
            for row in await JimengJobDAO.undiscovered():
                task = await queue.get_task(row["task_id"])
                if not task:
                    task = OnlineProviderTask(row["task_id"], TASK_TYPE, row["task_data"], user_id=row["user_id"])
                    task.status = OnlineTaskStatus.PROCESSING
                    await queue.restore_jimeng_task(task)
                await process_jimeng(queue, task)
            for job in await JimengJobDAO.due(config.account_id):
                task = await queue.get_task(job["task_id"])
                if not task:
                    row = await TaskDAO.get_task(job["task_id"])
                    if not row or row.get("status") == "cancelled":
                        continue
                    task = OnlineProviderTask(job["task_id"], TASK_TYPE, job["task_data"], user_id=job["user_id"])
                    task.status = OnlineTaskStatus.PROCESSING
                    task.data["_jimeng_paid_intent"] = job["stage"] != "waiting"
                    await queue.restore_jimeng_task(task)
                try:
                    await advance(queue, task, config)
                except Exception as exc:
                    logger.warning("Jimeng recovery deferred task=%s error_type=%s", job["task_id"], type(exc).__name__)
                    await queue.update_progress(job["task_id"], 0,
                        "即梦原任务暂时无法查询或保存，稍后继续；不会重新生成或重复计费")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            if not isinstance(exc, JimengError):
                logger.warning("Jimeng recovery unavailable error_type=%s", type(exc).__name__)
        await asyncio.sleep(30)
