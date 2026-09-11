from datetime import datetime
from types import SimpleNamespace

import pytest

from services import task_read_service as svc


class _Logger:
    def info(self, *_args, **_kwargs):
        pass

    def warning(self, *_args, **_kwargs):
        pass

    def error(self, *_args, **_kwargs):
        pass


class _TaskDAO:
    def __init__(self, *, status_task=None, list_tasks=None, raise_on_list=False):
        self.status_task = status_task
        self.list_tasks = list_tasks
        self.raise_on_list = raise_on_list

    async def get_task_by_task_id(self, _task_id):
        return self.status_task

    async def get_user_tasks(self, _username, limit=100):
        if self.raise_on_list:
            raise RuntimeError("db down")
        if self.list_tasks is None:
            return None
        return self.list_tasks[:limit]


class _Queue:
    def __init__(self, *, task=None, tasks=None):
        self.task = task
        self.tasks = tasks or []

    async def get_task(self, _task_id):
        return self.task

    async def get_user_tasks(self, _username, limit=100, status=None):
        rows = self.tasks
        if status:
            rows = [task for task in rows if task.status.value == status]
        return rows[:limit]


def _queue_task(task_id="task_redis", status="processing"):
    return SimpleNamespace(
        task_id=task_id,
        task_type="image",
        status=SimpleNamespace(value=status),
        progress=42,
        node_id="node-1",
        result={"image": "ok"},
        error=None,
        created_at="created",
        started_at="started",
        completed_at=None,
        data={"prompt": "hi"},
        user_id="u1",
    )


@pytest.mark.asyncio
async def test_get_task_status_prefers_queue_task():
    result = await svc.get_task_status_response(
        task_id="task_1",
        task_queue=_Queue(task=_queue_task()),
        task_dao=_TaskDAO(status_task={"task_id": "task_db"}),
        logger=_Logger(),
    )

    assert result["task_id"] == "task_redis"
    assert result["status"] == "processing"
    assert result["task_type"] == "image"
    assert result["data"] == {"prompt": "hi"}
    assert "source" not in result


@pytest.mark.asyncio
async def test_get_task_status_falls_back_to_database():
    db_row = {
        "task_id": "task_db",
        "task_type": "minimax_i2v",
        "status": "completed",
        "result_data": '{"url": "/storage/out.png"}',
        "task_data": '{"model": "MINI"}',
        "error_message": None,
        "created_at": datetime(2026, 1, 1, 1, 2, 3),
        "started_at": None,
        "completed_at": datetime(2026, 1, 1, 1, 3, 4),
    }
    result = await svc.get_task_status_response(
        task_id="task_db",
        task_queue=_Queue(task=None),
        task_dao=_TaskDAO(status_task=db_row),
        logger=_Logger(),
    )

    assert result["task_id"] == "task_db"
    assert result["status"] == "completed"
    assert result["progress"] == 100
    assert result["result"] == {"url": "/storage/out.png"}
    assert result["task_type"] == "minimax_i2v"
    assert result["data"] == {"model": "MINI"}
    assert result["source"] == "database"


@pytest.mark.asyncio
async def test_get_task_status_does_not_invent_zero_progress_for_active_database_task():
    result = await svc.get_task_status_response(
        task_id="task_db",
        task_queue=_Queue(task=None),
        task_dao=_TaskDAO(status_task={
            "task_id": "task_db",
            "status": "processing",
            "metadata": {},
            "task_data": {},
        }),
        logger=_Logger(),
    )

    assert result["status"] == "processing"
    assert result["progress"] is None


@pytest.mark.asyncio
async def test_get_task_status_uses_persisted_progress_metadata():
    result = await svc.get_task_status_response(
        task_id="task_db",
        task_queue=_Queue(task=None),
        task_dao=_TaskDAO(status_task={
            "task_id": "task_db",
            "status": "processing",
            "metadata": '{"progress": 37}',
        }),
        logger=_Logger(),
    )

    assert result["progress"] == 37


@pytest.mark.asyncio
async def test_get_task_status_hides_queue_task_from_another_user():
    result = await svc.get_task_status_response(
        task_id="task_1",
        task_queue=_Queue(task=_queue_task()),
        task_dao=_TaskDAO(),
        logger=_Logger(),
        username="u2",
    )

    assert result is None


@pytest.mark.asyncio
async def test_get_task_status_hides_database_task_from_another_user():
    result = await svc.get_task_status_response(
        task_id="task_db",
        task_queue=_Queue(task=None),
        task_dao=_TaskDAO(status_task={
            "task_id": "task_db",
            "user_id": "u1",
            "status": "processing",
        }),
        logger=_Logger(),
        username="u2",
    )

    assert result is None


@pytest.mark.asyncio
async def test_list_user_tasks_formats_database_rows():
    db_row = {
        "task_id": "task_db",
        "task_type": "video",
        "status": "completed",
        "progress": 100,
        "result_data": '{"videos": []}',
        "task_data": '{"prompt": "scene"}',
        "error_message": None,
        "created_at": datetime(2026, 1, 1, 1, 2, 3),
        "completed_at": datetime(2026, 1, 1, 1, 3, 4),
    }
    result = await svc.list_user_tasks_response(
        username="u1",
        limit=10,
        status=None,
        task_queue=_Queue(tasks=[]),
        task_dao=_TaskDAO(list_tasks=[db_row]),
        logger=_Logger(),
    )

    assert result["success"] is True
    assert result["tasks"] == [
        {
            "task_id": "task_db",
            "task_type": "video",
            "status": "completed",
            "refund_status": None,
            "progress": 100,
            "result": {"videos": []},
            "error": None,
            "created_at": "2026-01-01T01:02:03",
            "completed_at": "2026-01-01T01:03:04",
            "data": {"prompt": "scene"},
        }
    ]


def test_image_upscale_summary_hides_processing_internals_and_reports_refund():
    result = svc.format_db_task_summary({
        "task_id": "upscale_failed",
        "task_type": "image_upscale",
        "status": "failed",
        "task_data": '{"target_long_edge": 50000, "dpi": 300}',
        "error_message": 'HTTP 400: {"type":"missing_node_type","message":"Node INT Constant not found"}',
        "credit_freeze_status": "released",
    })

    assert result["error"] == "处理节点缺少图片放大所需组件，本次未生成结果。"
    assert result["refund_status"] == "completed"
    assert "INT Constant" not in result["error"]


@pytest.mark.parametrize("formatter", [svc.format_queue_task_status, svc.format_queue_task_summary])
def test_local_task_errors_never_expose_workflow_stack_or_windows_paths(formatter):
    task = _queue_task(task_id="task-angle", status="failed")
    task.task_type = "i2i_fj"
    task.error = (
        'execution_error {"prompt_id":"secret","node_type":"KSampler"} '
        'File "E:\\MECHA\\processing\\execution.py", line 542, in execute'
    )

    result = formatter(task)

    assert result["error"].startswith("角度调整失败")
    assert "KSampler" not in result["error"]
    assert "prompt_id" not in result["error"]
    assert "E:\\" not in result["error"]


def test_database_local_task_error_is_sanitized_too():
    result = svc.format_db_task_summary({
        "task_id": "task-angle",
        "task_type": "i2i_fj",
        "status": "failed",
        "task_data": "{}",
        "error_message": "Traceback KSampler execution.py line 542",
    })
    assert result["error"].startswith("角度调整失败")
    assert "KSampler" not in result["error"]


@pytest.mark.asyncio
async def test_list_user_tasks_merges_live_queue_state_over_database_history():
    db_rows = [
        {
            "task_id": "task_redis",
            "task_type": "image",
            "status": "pending",
            "task_data": '{"project_id": "proj_1", "db_only": true}',
            "created_at": datetime(2026, 1, 1, 1, 2, 3),
        },
        {
            "task_id": "task_done",
            "task_type": "video",
            "status": "completed",
            "result_data": '{"url": "done.mp4"}',
            "created_at": datetime(2026, 1, 1, 1, 1, 3),
        },
    ]
    result = await svc.list_user_tasks_response(
        username="u1",
        limit=10,
        status=None,
        task_queue=_Queue(tasks=[_queue_task(task_id="task_redis", status="processing")]),
        task_dao=_TaskDAO(list_tasks=db_rows),
        logger=_Logger(),
    )

    assert [task["task_id"] for task in result["tasks"]] == ["task_redis", "task_done"]
    live = result["tasks"][0]
    assert live["status"] == "processing"
    assert live["progress"] == 42
    assert live["data"] == {"project_id": "proj_1", "db_only": True, "prompt": "hi"}


@pytest.mark.asyncio
async def test_list_user_tasks_filters_comma_separated_active_statuses_after_merge():
    result = await svc.list_user_tasks_response(
        username="u1",
        limit=10,
        status="processing,queued",
        task_queue=_Queue(tasks=[
            _queue_task("running", "processing"),
            _queue_task("queued", "queued"),
            _queue_task("done", "completed"),
        ]),
        task_dao=_TaskDAO(list_tasks=[]),
        logger=_Logger(),
    )

    assert [task["task_id"] for task in result["tasks"]] == ["running", "queued"]


@pytest.mark.asyncio
async def test_list_user_tasks_falls_back_to_queue_when_database_fails():
    result = await svc.list_user_tasks_response(
        username="u1",
        limit=10,
        status="processing",
        task_queue=_Queue(tasks=[_queue_task(status="processing"), _queue_task("done", "completed")]),
        task_dao=_TaskDAO(raise_on_list=True),
        logger=_Logger(),
    )

    assert result["success"] is True
    assert [task["task_id"] for task in result["tasks"]] == ["task_redis"]


@pytest.mark.asyncio
async def test_list_user_tasks_uses_queue_when_database_missing():
    result = await svc.list_user_tasks_response(
        username="u1",
        limit=10,
        status=None,
        task_queue=_Queue(tasks=[_queue_task()]),
        task_dao=_TaskDAO(list_tasks=None),
        logger=_Logger(),
    )

    assert result["success"] is True
    assert result["tasks"][0]["task_id"] == "task_redis"
