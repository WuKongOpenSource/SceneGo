"""Persist a recoverable application job before publishing it to a worker."""
import asyncio

from fastapi import HTTPException
from dao.business.jimeng_job import JimengJobDAO
from dao.business.task import TaskDAO
from services.jimeng_cli_runtime import CliConfig

ENQUEUE_MANAGED_KEY = '_jimeng_enqueue_managed'


async def enqueue_jimeng_task(queue, task):
    config = await asyncio.to_thread(CliConfig.load)
    # The same account lock gates paid submission. A worker cannot execute an
    # ambiguously published task while its enqueue outcome is being recorded.
    async with JimengJobDAO.account_lock(config.account_id) as locked:
        if locked is None:
            raise HTTPException(status_code=503, detail='即梦通道正在处理任务，本次未提交，请稍后重试。')
        await TaskDAO.create_task(task_id=task.task_id, user_id=task.user_id,
            task_type=task.task_type, task_data=task.data)
        await JimengJobDAO.ensure(task, config)
        # After this point generic enqueue rollback must not refund on its own:
        # the committed job owns the outcome, including lost Redis acknowledgements.
        task.data[ENQUEUE_MANAGED_KEY] = True
        try:
            queued = await queue.enqueue(task)
        except Exception:
            queued = False
        if queued:
            return
        # No provider call can have started while this account lock was held.
        # Persist refund_pending before releasing the lock so late queue claims
        # only reconcile the refund, never generate against released credit.
        await JimengJobDAO.update(task.task_id, stage='refund_pending',
            message='任务投递未完成，本次未提交即梦；正在退还预留创作点数。', delay=0)
        # Return the durable task ID, not an ambiguous HTTP failure inviting a
        # new paid attempt. Recovery also restores missing Redis state.
