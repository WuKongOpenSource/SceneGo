from unittest.mock import AsyncMock

import pytest

from services import video_reverse_service


@pytest.mark.asyncio
async def test_reverse_task_active_guard_reads_task_status(monkeypatch):
    get_task = AsyncMock(return_value={"status": "analyzing"})
    monkeypatch.setattr(video_reverse_service.VideoReverseTaskDAO, "get", get_task)

    await video_reverse_service._ensure_reverse_task_active("vrev_active")

    get_task.assert_awaited_once_with("vrev_active")


@pytest.mark.asyncio
async def test_reverse_task_active_guard_rejects_cancelled_task(monkeypatch):
    monkeypatch.setattr(
        video_reverse_service.VideoReverseTaskDAO,
        "get",
        AsyncMock(return_value={"status": "cancelled"}),
    )

    with pytest.raises(video_reverse_service.VideoReverseCancelled, match="已由用户取消"):
        await video_reverse_service._ensure_reverse_task_active("vrev_cancelled")
