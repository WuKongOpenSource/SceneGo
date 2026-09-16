from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from services import jimeng_submission_service as service


@pytest.fixture
def runtime(monkeypatch):
    events = []
    @asynccontextmanager
    async def account_lock(_):
        events.append('locked')
        try:
            yield object()
        finally:
            events.append('unlocked')
    async def ensure(*_):
        events.append('durable')
    async def update(*_, **data):
        events.append(data['stage'])
    config = SimpleNamespace(account_id='123')
    task = SimpleNamespace(task_id='task_1', task_type='jimeng_multimodal', user_id='user_1', data={'prompt': 'original'})
    dao = SimpleNamespace(account_lock=account_lock, ensure=AsyncMock(side_effect=ensure), update=AsyncMock(side_effect=update))
    queue = SimpleNamespace(enqueue=AsyncMock(return_value=True))
    monkeypatch.setattr(service.CliConfig, 'load', lambda: config)
    monkeypatch.setattr(service, 'JimengJobDAO', dao)
    monkeypatch.setattr(service, 'TaskDAO', SimpleNamespace(create_task=AsyncMock()))
    return SimpleNamespace(task=task, dao=dao, queue=queue, events=events)


@pytest.mark.asyncio
async def test_durable_job_precedes_queue_visibility(runtime):
    r = runtime
    async def enqueue(_):
        assert r.events == ['locked', 'durable']
        assert r.task.data[service.ENQUEUE_MANAGED_KEY]
        return True
    r.queue.enqueue.side_effect = enqueue
    await service.enqueue_jimeng_task(r.queue, r.task)
    assert r.events == ['locked', 'durable', 'unlocked']
    r.dao.update.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('error', [None, TimeoutError('lost queue acknowledgement')])
async def test_uncertain_queue_delivery_becomes_refund_only_before_worker_can_submit(runtime, error):
    r = runtime
    r.queue.enqueue.return_value = False
    r.queue.enqueue.side_effect = error
    await service.enqueue_jimeng_task(r.queue, r.task)
    assert r.events == ['locked', 'durable', 'refund_pending', 'unlocked']
    assert r.task.data[service.ENQUEUE_MANAGED_KEY]


@pytest.mark.asyncio
async def test_unavailable_lock_has_no_publication_or_managed_reservation(runtime):
    r = runtime
    @asynccontextmanager
    async def busy(_):
        yield None
    r.dao.account_lock = busy
    with pytest.raises(HTTPException):
        await service.enqueue_jimeng_task(r.queue, r.task)
    assert not r.task.data.get(service.ENQUEUE_MANAGED_KEY)
    r.queue.enqueue.assert_not_awaited()


@pytest.mark.asyncio
async def test_sql_failure_after_publication_does_not_trigger_generic_refund(runtime):
    r = runtime
    r.queue.enqueue.return_value = False
    r.dao.update.side_effect = RuntimeError('database unavailable')
    with pytest.raises(RuntimeError):
        await service.enqueue_jimeng_task(r.queue, r.task)
    assert r.task.data[service.ENQUEUE_MANAGED_KEY]
    assert r.events == ['locked', 'durable', 'unlocked']
