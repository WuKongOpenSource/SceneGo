from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

import pytest

from services import task_notification_service


class FakeTaskDAO:
    recent_args = None
    active_args = None
    terminal_args = None
    terminal_updates = []
    task_user_id = "user_1"

    @classmethod
    async def get_recent_completed_tasks(cls, user_id: str, hours: int):
        cls.recent_args = {"user_id": user_id, "hours": hours}
        return [{"task_id": "task_recent", "user_id": user_id}]

    @classmethod
    async def get_task(cls, task_id: str):
        if task_id == "missing":
            return None
        return {"task_id": task_id, "user_id": cls.task_user_id}

    @staticmethod
    async def get_task_files(task_id: str):
        return [{"file_id": "file_1", "task_id": task_id}]

    @classmethod
    async def get_active_tasks_for_user(cls, user_id: str, limit: int):
        cls.active_args = {"user_id": user_id, "limit": limit}
        return [{"task_id": "active_1", "user_id": user_id}]

    @classmethod
    async def reconcile_terminal_task(cls, **kwargs):
        cls.terminal_updates.append(kwargs)

    @classmethod
    async def get_terminal_tasks_for_notifications(cls, user_id: str, since_dt, limit: int):
        cls.terminal_args = {"user_id": user_id, "since_dt": since_dt, "limit": limit}
        return [
            {
                "task_id": "done_1",
                "user_id": user_id,
                "task_data": '{"entity_type": "shot", "entity_id": "sb_1", "file_role": "image", "episode_id": "ep_1"}',
            },
            {
                "task_id": "done_2",
                "user_id": user_id,
                "task_data": "bad-json",
            },
        ]


class FakeNotificationDAO:
    read = []
    dismissed = []

    @staticmethod
    async def get_unread_count(user_id: str):
        return 3

    @staticmethod
    async def get_unread(user_id: str, limit: int = 50):
        return [{"notification_id": "n_unread", "user_id": user_id, "limit": limit}]

    @staticmethod
    async def get_history(user_id: str, limit: int = 100, offset: int = 0):
        return [{"notification_id": "n_history", "user_id": user_id, "limit": limit, "offset": offset}]

    @classmethod
    async def mark_read(cls, notification_id: str, user_id: str):
        cls.read.append({"notification_id": notification_id, "user_id": user_id})
        return True

    @staticmethod
    async def mark_all_read(user_id: str):
        return 7

    @classmethod
    async def dismiss(cls, notification_id: str, user_id: str):
        cls.dismissed.append({"notification_id": notification_id, "user_id": user_id})
        return True


def setup_function():
    FakeTaskDAO.recent_args = None
    FakeTaskDAO.active_args = None
    FakeTaskDAO.terminal_args = None
    FakeTaskDAO.terminal_updates = []
    FakeTaskDAO.task_user_id = "user_1"
    FakeNotificationDAO.read = []
    FakeNotificationDAO.dismissed = []


async def test_get_recent_and_active_tasks_delegate_with_limits():
    recent = await task_notification_service.get_recent_tasks(
        user_id="user_1",
        hours=12,
        task_dao=FakeTaskDAO,
    )
    active = await task_notification_service.get_active_tasks(
        user_id="user_1",
        task_dao=FakeTaskDAO,
    )

    assert recent["tasks"] == [{"task_id": "task_recent", "user_id": "user_1"}]
    assert active["tasks"] == [{"task_id": "active_1", "user_id": "user_1"}]
    assert FakeTaskDAO.recent_args == {"user_id": "user_1", "hours": 12}
    assert FakeTaskDAO.active_args == {"user_id": "user_1", "limit": 50}


async def test_get_active_tasks_reconciles_terminal_redis_state():
    class ActiveTaskDAO(FakeTaskDAO):
        @classmethod
        async def get_active_tasks_for_user(cls, user_id: str, limit: int):
            return [
                {"task_id": "stale_failed", "user_id": user_id, "status": "processing"},
                {"task_id": "still_running", "user_id": user_id, "status": "processing"},
            ]

    class FakeTaskQueue:
        async def get_task(self, task_id: str):
            if task_id == "stale_failed":
                return SimpleNamespace(
                    task_id=task_id,
                    status="failed",
                    error="upstream 404",
                    result=None,
                    retries=3,
                )
            return SimpleNamespace(
                task_id=task_id,
                status="processing",
                error=None,
                result=None,
                retries=0,
                progress=42,
                data={"display_name": "Live task"},
                started_at="started-now",
            )

    result = await task_notification_service.get_active_tasks(
        user_id="user_1",
        task_dao=ActiveTaskDAO,
        task_queue=FakeTaskQueue(),
    )

    assert result["tasks"] == [{
        "task_id": "still_running",
        "user_id": "user_1",
        "status": "processing",
        "can_cancel": False,
        "progress": 42.0,
        "display_name": "Live task",
        "started_at": "started-now",
    }]
    assert ActiveTaskDAO.terminal_updates == [
        {
            "task_id": "stale_failed",
            "status": "failed",
            "result_data": None,
            "error_message": "upstream 404",
            "retries": 3,
        }
    ]


async def test_get_active_tasks_enriches_context_from_task_data():
    class ActiveTaskDAO(FakeTaskDAO):
        @classmethod
        async def get_active_tasks_for_user(cls, user_id: str, limit: int):
            return [
                {
                    "task_id": "doubao_img_1",
                    "user_id": user_id,
                    "status": "processing",
                    "task_type": "doubao_image",
                    "task_data": '{"project_id": "proj_1", "episode_id": "ep_1", "source_page": "design", "source_item_id": "asset_1", "entity_type": "asset", "entity_id": "asset_1", "file_role": "reference_image", "display_name": "豆包图像生成", "category": "image", "provider": "doubao", "model": "doubao-seedream-5-0-250428"}',
                }
            ]

    result = await task_notification_service.get_active_tasks(
        user_id="user_1",
        task_dao=ActiveTaskDAO,
    )

    task = result["tasks"][0]
    assert task["project_id"] == "proj_1"
    assert task["episode_id"] == "ep_1"
    assert task["source_page"] == "design"
    assert task["source_item_id"] == "asset_1"
    assert task["entity_type"] == "asset"
    assert task["entity_id"] == "asset_1"
    assert task["file_role"] == "reference_image"
    assert task["display_name"] == "豆包图像生成"
    assert task["category"] == "image"
    assert task["provider"] == "doubao"
    assert task["model"] == "doubao-seedream-5-0-250428"


async def test_get_active_tasks_hides_internal_notification_suppressed_text_tasks():
    class ActiveTaskDAO(FakeTaskDAO):
        @classmethod
        async def get_active_tasks_for_user(cls, user_id: str, limit: int):
            return [
                {
                    "task_id": "deepseek_internal_1",
                    "user_id": user_id,
                    "status": "processing",
                    "task_type": "deepseek_text",
                    "task_data": {
                        "display_name": "镜头设计局部修复",
                        "source_page": "script",
                        "suppress_notification": True,
                    },
                },
                {
                    "task_id": "deepseek_visible_1",
                    "user_id": user_id,
                    "status": "processing",
                    "task_type": "deepseek_text",
                    "task_data": {
                        "display_name": "剧本修改",
                        "source_page": "script",
                    },
                },
            ]

    result = await task_notification_service.get_active_tasks(
        user_id="user_1",
        task_dao=ActiveTaskDAO,
    )

    assert [task["task_id"] for task in result["tasks"]] == ["deepseek_visible_1"]


async def test_get_task_files_rejects_missing_or_foreign_task():
    result = await task_notification_service.get_task_files(
        task_id="task_1",
        user_id="user_1",
        task_dao=FakeTaskDAO,
    )

    assert result == {"success": True, "files": [{"file_id": "file_1", "task_id": "task_1"}]}

    FakeTaskDAO.task_user_id = "other"
    with pytest.raises(task_notification_service.TaskFileForbidden):
        await task_notification_service.get_task_files(
            task_id="task_1",
            user_id="user_1",
            task_dao=FakeTaskDAO,
        )

    with pytest.raises(task_notification_service.TaskFileForbidden):
        await task_notification_service.get_task_files(
            task_id="missing",
            user_id="user_1",
            task_dao=FakeTaskDAO,
        )


async def test_get_task_notifications_normalizes_task_data_and_since_ms():
    result = await task_notification_service.get_task_notifications(
        user_id="user_1",
        since=1710000000000,
        task_dao=FakeTaskDAO,
    )

    assert FakeTaskDAO.terminal_args["limit"] == 50
    assert isinstance(FakeTaskDAO.terminal_args["since_dt"], datetime)
    assert FakeTaskDAO.terminal_args["since_dt"].tzinfo is None
    assert result["notifications"][0]["entity_type"] == "shot"
    assert result["notifications"][0]["entity_id"] == "sb_1"
    assert result["notifications"][0]["file_role"] == "image"
    assert result["notifications"][0]["episode_id"] == "ep_1"
    assert result["notifications"][1]["entity_type"] == ""


async def test_task_lists_redact_local_workflow_stack_details():
    raw_error = 'execution_error: KSampler File "E:\\\\worker\\\\execution.py", line 542'

    class ErrorTaskDAO(FakeTaskDAO):
        @classmethod
        async def get_recent_completed_tasks(cls, user_id: str, hours: int):
            return [{
                "task_id": "local_failed",
                "user_id": user_id,
                "task_type": "i2i_fj",
                "task_data": {"requested_workflow_type": "i2i_fj"},
                "error_message": raw_error,
            }]

    result = await task_notification_service.get_recent_tasks(
        user_id="user_1",
        hours=12,
        task_dao=ErrorTaskDAO,
    )

    public_error = result["tasks"][0]["error_message"]
    assert "角度调整失败" in public_error
    assert "KSampler" not in public_error
    assert "execution.py" not in public_error


async def test_saved_notifications_redact_local_workflow_stack_details():
    class ErrorNotificationDAO(FakeNotificationDAO):
        @staticmethod
        async def get_unread(user_id: str, limit: int = 50):
            return [{
                "notification_id": "n_error",
                "user_id": user_id,
                "message": 'execution_error: prompt_id=private KSampler File "E:\\\\worker\\\\execution.py"',
                "metadata": {"task_type": "i2i_fj"},
            }]

    result = await task_notification_service.get_notifications(
        user_id="user_1",
        status="unread",
        limit=50,
        offset=0,
        notification_dao=ErrorNotificationDAO,
    )

    public_message = result["notifications"][0]["message"]
    assert "角度调整失败" in public_message
    assert "prompt_id" not in public_message
    assert "execution.py" not in public_message


async def test_notification_count_and_lists_delegate_to_notification_dao():
    unread_count = await task_notification_service.get_unread_notification_count(
        user_id="user_1",
        notification_dao=FakeNotificationDAO,
    )
    unread = await task_notification_service.get_notifications(
        user_id="user_1",
        status="unread",
        limit=5,
        offset=9,
        notification_dao=FakeNotificationDAO,
    )
    history = await task_notification_service.get_notifications(
        user_id="user_1",
        status=None,
        limit=6,
        offset=2,
        notification_dao=FakeNotificationDAO,
    )

    assert unread_count == {"success": True, "count": 3}
    assert unread["notifications"][0]["notification_id"] == "n_unread"
    assert unread["notifications"][0]["limit"] == 5
    assert history["notifications"][0]["notification_id"] == "n_history"
    assert history["notifications"][0]["offset"] == 2


async def test_mark_and_dismiss_notifications_delegate_to_notification_dao():
    marked = await task_notification_service.mark_notification_read(
        notification_id="n_1",
        user_id="user_1",
        notification_dao=FakeNotificationDAO,
    )
    all_marked = await task_notification_service.mark_all_notifications_read(
        user_id="user_1",
        notification_dao=FakeNotificationDAO,
    )
    dismissed = await task_notification_service.dismiss_notification(
        notification_id="n_2",
        user_id="user_1",
        notification_dao=FakeNotificationDAO,
    )

    assert marked == {"success": True}
    assert all_marked == {"success": True, "count": 7}
    assert dismissed == {"success": True, "dismissed": True}
    assert FakeNotificationDAO.read == [{"notification_id": "n_1", "user_id": "user_1"}]
    assert FakeNotificationDAO.dismissed == [{"notification_id": "n_2", "user_id": "user_1"}]
