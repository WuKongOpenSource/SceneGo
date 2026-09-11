import logging
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.online_provider_tasks import create_online_provider_task_router


def _app():
    app = FastAPI()
    service = MagicMock()
    queue = MagicMock()
    queue.get_external_queue_length = AsyncMock(return_value=0)
    queue.get_external_processing_count = AsyncMock(return_value=0)
    service.get_queue.return_value = queue
    service.submit = AsyncMock(return_value="task-1")
    access_checker = AsyncMock()

    async def require_auth():
        return "user-1"

    app.include_router(
        create_online_provider_task_router(
            require_auth_dependency=require_auth,
            task_service=service,
            task_dao=MagicMock(),
            file_dao=MagicMock(),
            get_pubsub_redis_client=MagicMock(),
            logger=logging.getLogger("test.online-router"),
            generation_access_checker=access_checker,
        )
    )
    return app, service, access_checker


def test_rejects_local_task_without_submitting() -> None:
    app, service, access_checker = _app()

    response = TestClient(app).post(
        "/api/generate",
        json={"task_type": "i2v", "model": "private-local-model"},
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "online_provider_task_required"
    service.submit.assert_not_awaited()
    access_checker.assert_not_awaited()


def test_minimax_omitted_duration_is_normalized_to_six_seconds() -> None:
    app, service, _ = _app()

    response = TestClient(app).post(
        "/api/generate",
        json={"task_type": "minimax_i2v", "model": "MiniMax-Hailuo-2.3"},
    )

    assert response.status_code == 200
    submitted = service.submit.await_args.args[1]
    assert submitted["duration"] == 6
    assert submitted["minimax_resolution"] == "768P"


def test_create_task_returns_submission_cancel_deadline_immediately() -> None:
    app, service, _ = _app()

    async def submit_with_deadline(_task_type, task_data, _user_id, **_kwargs):
        task_data["cancel_deadline"] = 1_800_000_010.0
        return "task-1"

    service.submit = AsyncMock(side_effect=submit_with_deadline)
    response = TestClient(app).post(
        "/api/generate",
        json={"task_type": "minimax_i2v", "model": "MiniMax-Hailuo-2.3"},
    )

    assert response.status_code == 200
    assert response.json()["cancel_deadline"] == 1_800_000_010.0
    assert response.json()["can_cancel"] is True


def test_online_router_source_has_no_private_runtime_imports() -> None:
    from pathlib import Path

    source = Path(__file__).parents[1].joinpath("routers", "online_provider_tasks.py").read_text(
        encoding="utf-8"
    ).lower()
    for forbidden in (
        "cluster_manager",
        "comfyui",
        "workflow_handler",
        "services.task_service",
        "core.task_queue",
    ):
        assert forbidden not in source


def test_seedance_missing_resolution_is_720p_when_enqueued() -> None:
    app, service, _ = _app()
    response = TestClient(app).post('/api/generate', json={
        'task_type': 'seedance_multi', 'sub_model': 'mini', 'duration': 15,
    })
    assert response.status_code == 200
    submitted = service.submit.await_args.args[1]
    assert submitted['resolution'] == '720p' and submitted['duration'] == 15


def test_seedance_invalid_resolution_never_reaches_access_or_billing() -> None:
    app, service, access = _app()
    response = TestClient(app).post('/api/generate', json={
        'task_type': 'seedance_multi', 'sub_model': 'mini', 'resolution': '1080P',
    })
    assert response.status_code == 422
    service.submit.assert_not_awaited()
    access.assert_not_awaited()


def test_cancel_owned_task_returns_refund_state():
    from core.online_provider_task_model import OnlineProviderTask
    app, service, _ = _app()
    queue = service.get_queue()
    task = OnlineProviderTask("task-1", "seedance_i2v", {}, user_id="user-1")
    task.refund_status = "completed"
    queue.get_task = AsyncMock(return_value=task)
    queue.cancel_task = AsyncMock(return_value=True)
    response = TestClient(app).delete("/api/task/task-1")
    assert response.status_code == 200
    assert response.json()["refund_status"] == "completed"


def test_cancel_foreign_task_is_not_visible_and_never_refunds():
    from core.online_provider_task_model import OnlineProviderTask
    app, service, _ = _app()
    queue = service.get_queue()
    queue.get_task = AsyncMock(return_value=OnlineProviderTask("task-1", "seedance_i2v", {}, user_id="other-user"))
    queue.cancel_task = AsyncMock()
    response = TestClient(app).delete("/api/task/task-1")
    assert response.status_code == 404
    queue.cancel_task.assert_not_awaited()


def test_cancel_submitted_task_reports_conflict():
    from core.online_provider_task_model import OnlineProviderTask
    app, service, _ = _app()
    queue = service.get_queue()
    queue.get_task = AsyncMock(return_value=OnlineProviderTask("task-1", "seedance_i2v", {}, user_id="user-1"))
    queue.cancel_task = AsyncMock(return_value=False)
    response = TestClient(app).delete("/api/task/task-1")
    assert response.status_code == 409
    assert "无法取消" in response.json()["detail"]
