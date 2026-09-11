from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

import video_reverse_routes


class _RecordingService:
    def __init__(self, events, *, error=None):
        self.events = events
        self.error = error

    async def submit(self, **kwargs):
        self.events.append(('submit', kwargs['task_id']))
        if self.error:
            raise self.error
        return kwargs['task_id']


@pytest.mark.asyncio
async def test_video_reverse_freezes_before_enqueue(monkeypatch):
    events = []

    async def freeze(*_args, **kwargs):
        events.append(('freeze', kwargs['task_id']))

    monkeypatch.setattr(video_reverse_routes.credit_service, 'freeze', freeze)
    monkeypatch.setattr(video_reverse_routes.credit_service, 'release', AsyncMock())
    monkeypatch.setattr(video_reverse_routes.VideoReverseTaskDAO, 'update_status', AsyncMock())

    await video_reverse_routes._freeze_and_submit_reverse_task(
        svc=_RecordingService(events),
        task_id='task-reserved',
        reverse_task_id='vrev-1',
        task_data={'reverse_task_id': 'vrev-1'},
        user_id='user-1',
        estimate={'enabled': True, 'estimated_cost': 20, 'rule_version': 'v1'},
        project_id='project-1',
    )

    assert events == [('freeze', 'task-reserved'), ('submit', 'task-reserved')]


@pytest.mark.asyncio
async def test_video_reverse_enqueue_failure_releases_freeze(monkeypatch):
    release = AsyncMock()
    update_status = AsyncMock()
    monkeypatch.setattr(video_reverse_routes.credit_service, 'freeze', AsyncMock())
    monkeypatch.setattr(video_reverse_routes.credit_service, 'release', release)
    monkeypatch.setattr(video_reverse_routes.VideoReverseTaskDAO, 'update_status', update_status)

    with pytest.raises(RuntimeError, match='queue unavailable'):
        await video_reverse_routes._freeze_and_submit_reverse_task(
            svc=_RecordingService([], error=RuntimeError('queue unavailable')),
            task_id='task-reserved',
            reverse_task_id='vrev-1',
            task_data={'reverse_task_id': 'vrev-1'},
            user_id='user-1',
            estimate={'enabled': True, 'estimated_cost': 20},
            project_id='project-1',
        )

    release.assert_awaited_once_with(
        'task-reserved',
        reason='任务入队失败，退回预冻结创作点数',
        operator='user-1',
        project_id='project-1',
    )
    update_status.assert_awaited_once_with(
        'vrev-1', 'failed', progress=100,
        error_message='queue unavailable', completed=True,
    )


@pytest.mark.asyncio
async def test_video_reverse_insufficient_credit_never_enqueues(monkeypatch):
    service = _RecordingService([])
    release = AsyncMock()
    update_status = AsyncMock()
    monkeypatch.setattr(
        video_reverse_routes.credit_service,
        'freeze',
        AsyncMock(side_effect=video_reverse_routes.credit_service.InsufficientCreditsError('余额不足')),
    )
    monkeypatch.setattr(video_reverse_routes.credit_service, 'release', release)
    monkeypatch.setattr(video_reverse_routes.VideoReverseTaskDAO, 'update_status', update_status)

    with pytest.raises(HTTPException) as exc_info:
        await video_reverse_routes._freeze_and_submit_reverse_task(
            svc=service,
            task_id='task-reserved',
            reverse_task_id='vrev-1',
            task_data={'reverse_task_id': 'vrev-1'},
            user_id='user-1',
            estimate={'enabled': True, 'estimated_cost': 20},
        )

    assert exc_info.value.status_code == 402
    assert service.events == []
    release.assert_not_awaited()
    update_status.assert_awaited_once()
