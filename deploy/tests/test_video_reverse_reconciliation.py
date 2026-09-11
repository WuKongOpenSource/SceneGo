from unittest.mock import AsyncMock

import pytest

import video_reverse_routes


@pytest.mark.asyncio
async def test_reconcile_marks_reverse_failed_and_releases_credits(monkeypatch):
    task = {
        "reverse_task_id": "vrev_1",
        "task_id": "task_1",
        "status": "pending",
        "progress": 0,
    }
    monkeypatch.setattr(
        video_reverse_routes.TaskDAO,
        "get_task",
        AsyncMock(return_value={"status": "failed", "error_message": "Unsupported task type"}),
    )
    update_status = AsyncMock()
    monkeypatch.setattr(video_reverse_routes.VideoReverseTaskDAO, "update_status", update_status)
    monkeypatch.setattr(
        video_reverse_routes.VideoReverseTaskDAO,
        "get",
        AsyncMock(return_value={**task, "status": "failed", "progress": 100}),
    )
    release = AsyncMock()
    monkeypatch.setattr(video_reverse_routes.credit_service, "release", release)

    result = await video_reverse_routes._reconcile_terminal_task(task)

    assert result["status"] == "failed"
    update_status.assert_awaited_once_with(
        "vrev_1",
        "failed",
        progress=100,
        error_message="Unsupported task type",
        completed=True,
    )
    release.assert_awaited_once_with("task_1", reason="Unsupported task type")


@pytest.mark.asyncio
async def test_reconcile_keeps_running_task_unchanged(monkeypatch):
    task = {
        "reverse_task_id": "vrev_2",
        "task_id": "task_2",
        "status": "analyzing",
    }
    monkeypatch.setattr(
        video_reverse_routes.TaskDAO,
        "get_task",
        AsyncMock(return_value={"status": "processing"}),
    )
    update_status = AsyncMock()
    monkeypatch.setattr(video_reverse_routes.VideoReverseTaskDAO, "update_status", update_status)

    result = await video_reverse_routes._reconcile_terminal_task(task)

    assert result is task
    update_status.assert_not_awaited()
