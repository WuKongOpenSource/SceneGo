import copy
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from core.online_provider_task_model import OnlineProviderTask
from services import jimeng_task_service as service


@pytest.fixture
def runtime(monkeypatch, tmp_path):
    config = SimpleNamespace(account_id="123", session_id="456", state_id="dedicated_state_1",
                             private_directory=Mock(return_value=tmp_path))
    data = {"task_type": "jimeng_multimodal", "model": "JimengSeedance2", "prompt": "test",
            "duration": 5, "media_inputs": [{"kind": "image", "file_id": "file_original"}],
            "_jimeng_input_trace": [{"kind": "image", "file_id": "file_original", "sha256": "abc"}],
            "_credit_billing": {"amount": 210}}
    task = OnlineProviderTask("task_123", "jimeng_multimodal", data, user_id="user_1")
    job = {"task_id": task.task_id, "user_id": task.user_id, "account_id": "123", "session_id": "456",
           "state_id": "dedicated_state_1", "stage": "waiting", "submit_id": None,
           "task_data": copy.deepcopy(data), "input_trace": [], "result_data": None}
    events = []

    @asynccontextmanager
    async def lock(*args):
        yield True

    async def update(task_id, *, stage, **kwargs):
        events.append(stage)
        job["stage"] = stage
        for k, v in kwargs.items():
            if k == "trace": job["input_trace"] = v
            elif k == "result": job["result_data"] = v
            elif k != "delay": job[k] = v

    async def mark(*args):
        await update(task.task_id, stage="submitting")
        return True

    dao = SimpleNamespace(account_lock=lock, get=AsyncMock(side_effect=lambda _: copy.deepcopy(job)),
                          update=AsyncMock(side_effect=update), mark_submitting=AsyncMock(side_effect=mark),
                          account_busy=AsyncMock(return_value=False))
    cli = SimpleNamespace(account_status=AsyncMock(return_value={"authorized": True}),
        submit=AsyncMock(return_value={"submit_id": "paid_123", "gen_status": "querying", "credit_count": 30}),
        query=AsyncMock(return_value={"submit_id": "paid_123", "gen_status": "querying"}))
    queue = SimpleNamespace(get_task=AsyncMock(return_value=task), update_progress=AsyncMock(),
        begin_submission=AsyncMock(return_value=True), complete_task=AsyncMock(return_value=True),
        fail_task=AsyncMock(return_value=True), restore_jimeng_task=AsyncMock())
    monkeypatch.setattr(service, "JimengJobDAO", dao)
    monkeypatch.setattr(service, "require_jimeng_admin", AsyncMock())
    monkeypatch.setattr(service, "JimengCli", lambda _: cli)
    monkeypatch.setattr(service, "inspect_inputs", AsyncMock(return_value=[{**data["_jimeng_input_trace"][0], "path": str(tmp_path / "input.png")}]))
    monkeypatch.setattr(service, "TaskDAO", SimpleNamespace(update_task_status=AsyncMock()))
    monkeypatch.setattr(service, "settle_task_credits", AsyncMock())
    monkeypatch.setattr(service, "release_task_credits", AsyncMock())
    return SimpleNamespace(config=config, task=task, job=job, cli=cli, dao=dao, queue=queue, events=events)


@pytest.mark.asyncio
@pytest.mark.parametrize('during_media_check', [False, True])
async def test_demoted_admin_never_submits_and_refunds_reservation(runtime, during_media_check):
    from services.jimeng_access_service import JimengAccessDenied
    r = runtime
    denied = JimengAccessDenied('only administrators')
    service.require_jimeng_admin.side_effect = [None, denied] if during_media_check else denied
    await service.advance(r.queue, r.task, r.config)
    assert r.job['stage'] == 'refund_pending'
    assert '仅限管理员' in r.job['message']
    r.cli.submit.assert_not_awaited()
    r.queue.begin_submission.assert_not_awaited()
    if not during_media_check:
        r.cli.account_status.assert_not_awaited()
        service.inspect_inputs.assert_not_awaited()
    await service.advance(r.queue, r.task, r.config)
    service.release_task_credits.assert_awaited_once()
    assert r.job['stage'] == 'failed'


@pytest.mark.asyncio
async def test_unknown_role_pauses_without_paid_submission_or_refund(runtime):
    r = runtime
    service.require_jimeng_admin.side_effect = RuntimeError('database unavailable')
    with pytest.raises(RuntimeError):
        await service.advance(r.queue, r.task, r.config)
    assert r.job['stage'] == 'waiting'
    r.cli.account_status.assert_not_awaited()
    r.cli.submit.assert_not_awaited()
    service.release_task_credits.assert_not_awaited()


@pytest.mark.asyncio
async def test_demoted_admin_can_recover_existing_paid_result(runtime, monkeypatch):
    r = runtime
    r.job.update(stage='submitted', submit_id='paid_123')
    service.require_jimeng_admin.side_effect = AssertionError('do not reauthorize paid recovery')
    r.cli.query.return_value = {'submit_id': 'paid_123', 'gen_status': 'success'}
    result = {'videos': [{'file_id': 'saved-video'}]}
    monkeypatch.setattr(service, 'inspect_result', Mock(return_value=('video.mp4', {'duration_seconds': 5})))
    monkeypatch.setattr(service, 'persist_result', AsyncMock(return_value=result))
    await service.advance(r.queue, r.task, r.config)
    await service.advance(r.queue, r.task, r.config)
    assert r.job['stage'] == 'completed'
    r.cli.query.assert_awaited_once_with('paid_123', r.config.private_directory.return_value)
    r.cli.submit.assert_not_awaited()
    service.require_jimeng_admin.assert_not_awaited()
    service.release_task_credits.assert_not_awaited()
    r.queue.complete_task.assert_awaited_once_with(r.task.task_id, result)


@pytest.mark.asyncio
async def test_intent_committed_before_paid_command_and_id_persisted_immediately(runtime):
    r = runtime
    async def submit(*args):
        assert r.job["stage"] == "submitting"
        assert r.job["input_trace"] == r.task.data["_jimeng_input_trace"]
        return {"submit_id": "paid_123", "credit_count": 30}
    r.cli.submit.side_effect = submit
    await service.advance(r.queue, r.task, r.config)
    assert r.job["stage"] == "submitted" and r.job["submit_id"] == "paid_123"
    await service.advance(r.queue, r.task, r.config)
    r.cli.submit.assert_awaited_once()
    r.cli.query.assert_awaited_once_with("paid_123", r.config.private_directory.return_value)


@pytest.mark.asyncio
@pytest.mark.parametrize("response", [{}, {"gen_status": "fail"}, {"submit_id": "../bad"}])
async def test_submit_without_trustworthy_id_requires_review_never_retry_or_refund(runtime, response):
    r = runtime
    r.cli.submit.return_value = response
    await service.advance(r.queue, r.task, r.config)
    await service.advance(r.queue, r.task, r.config)
    assert r.job["stage"] == "review_required"
    r.cli.submit.assert_awaited_once()
    service.release_task_credits.assert_not_awaited()
    r.queue.fail_task.assert_not_awaited()


@pytest.mark.asyncio
async def test_crash_during_submit_has_no_automatic_paid_retry(runtime):
    r = runtime
    r.job["stage"] = "submitting"
    await service.advance(r.queue, r.task, r.config)
    assert r.job["stage"] == "review_required"
    r.cli.submit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("key", ["account_id", "session_id", "state_id"])
async def test_wrong_account_or_recreated_state_never_runs_cli(runtime, key):
    r = runtime
    r.job[key] = "different"
    await service.advance(r.queue, r.task, r.config)
    assert r.job["stage"] == "review_required"
    r.cli.account_status.assert_not_awaited()
    r.cli.submit.assert_not_awaited()


@pytest.mark.asyncio
async def test_waiting_account_remains_cancellable_before_submission(runtime):
    r = runtime
    r.dao.account_busy.return_value = True
    await service.advance(r.queue, r.task, r.config)
    assert r.job["stage"] == "waiting"
    r.queue.begin_submission.assert_not_awaited()
    r.cli.submit.assert_not_awaited()


@pytest.mark.asyncio
async def test_input_bytes_changed_never_submits(runtime):
    r = runtime
    r.job["task_data"]["_jimeng_input_trace"][0]["sha256"] = "changed"
    await service.advance(r.queue, r.task, r.config)
    assert r.job["stage"] == "refund_pending"
    r.cli.submit.assert_not_awaited()


@pytest.mark.asyncio
async def test_known_provider_failure_releases_only_after_final_query(runtime):
    r = runtime
    r.job.update(stage="submitted", submit_id="paid_123")
    r.cli.query.return_value = {"submit_id": "paid_123", "gen_status": "fail", "fail_reason": "/private/path secret"}
    await service.advance(r.queue, r.task, r.config)
    assert r.job["stage"] == "refund_pending"
    assert "/private" not in r.job["message"]
    await service.advance(r.queue, r.task, r.config)
    service.release_task_credits.assert_awaited_once()
    assert r.job["stage"] == "failed"
    r.cli.submit.assert_not_awaited()


@pytest.mark.asyncio
async def test_download_or_probe_failure_keeps_original_paid_task(runtime, monkeypatch):
    r = runtime
    r.job.update(stage="submitted", submit_id="paid_123")
    r.cli.query.return_value = {"submit_id": "paid_123", "gen_status": "success"}
    monkeypatch.setattr(service, "inspect_result", Mock(side_effect=ValueError("invalid file")))
    for _ in range(2):
        with pytest.raises(ValueError):
            await service.advance(r.queue, r.task, r.config)
    assert r.job["stage"] == "persisting"
    assert r.cli.query.await_count == 2
    r.cli.submit.assert_not_awaited()
    service.release_task_credits.assert_not_awaited()
    r.queue.complete_task.assert_not_awaited()


@pytest.mark.asyncio
async def test_result_persistence_and_settlement_before_completion(runtime, monkeypatch):
    r = runtime
    r.job.update(stage="submitted", submit_id="paid_123")
    r.cli.query.return_value = {"submit_id": "paid_123", "gen_status": "success"}
    monkeypatch.setattr(service, "inspect_result", Mock(return_value=("video.mp4", {"duration_seconds": 5.08})))
    result = {"videos": [{"file_id": "file_result", "duration_seconds": 5.08}], "images": []}
    monkeypatch.setattr(service, "persist_result", AsyncMock(return_value=result))
    await service.advance(r.queue, r.task, r.config)
    assert r.job["stage"] == "settling"
    r.queue.complete_task.assert_not_awaited()
    service.settle_task_credits.side_effect = RuntimeError("database unavailable")
    with pytest.raises(RuntimeError):
        await service.advance(r.queue, r.task, r.config)
    r.queue.complete_task.assert_not_awaited()
    assert r.job["stage"] == "settling"
    service.settle_task_credits.side_effect = None
    await service.advance(r.queue, r.task, r.config)
    assert r.job["stage"] == "completed"
    r.queue.complete_task.assert_awaited_once_with(r.task.task_id, result)
    r.cli.submit.assert_not_awaited()
    assert r.cli.query.await_count == 1


@pytest.mark.asyncio
async def test_os_lock_contention_proves_not_submitted_and_restores_cancellation(runtime):
    r = runtime
    r.task.data['_jimeng_paid_intent'] = True
    r.cli.submit.side_effect = service.CliNotStarted('busy before process start')
    await service.advance(r.queue, r.task, r.config)
    assert r.job['stage'] == 'waiting' and r.job['submit_id'] is None
    r.queue.restore_jimeng_task.assert_awaited_once_with(r.task)
    assert '_jimeng_paid_intent' not in r.task.data
    service.release_task_credits.assert_not_awaited()


@pytest.mark.asyncio
async def test_duplicate_completed_dispatch_never_changes_sql_or_resubmits(runtime, monkeypatch):
    r = runtime
    result = {'videos': [{'file_id': 'saved_file'}]}
    monkeypatch.setattr(service.CliConfig, 'load', lambda: r.config)
    service.TaskDAO.get_task = AsyncMock(return_value={'user_id': r.task.user_id,
        'task_type': r.task.task_type, 'status': 'completed', 'result_data': result})
    await service.process_jimeng(r.queue, r.task)
    r.queue.complete_task.assert_awaited_once_with(r.task.task_id, result)
    service.TaskDAO.update_task_status.assert_not_awaited()
    r.cli.submit.assert_not_awaited()
    r.dao.get.assert_not_awaited()


@pytest.mark.asyncio
async def test_execution_uses_sql_request_not_mutable_queue_data(runtime, monkeypatch):
    r = runtime
    binding = {'account_id': r.config.account_id, 'session_id': r.config.session_id, 'state_id': r.config.state_id}
    canonical = {**r.job['task_data'], '_jimeng_binding': binding, 'prompt': 'original database request'}
    r.job['task_data'] = copy.deepcopy(canonical)
    r.task.data['prompt'] = 'modified queue value'
    monkeypatch.setattr(service.CliConfig, 'load', lambda: r.config)
    service.TaskDAO.get_task = AsyncMock(return_value={'user_id': r.task.user_id,
        'task_type': r.task.task_type, 'status': 'pending', 'task_data': canonical})
    r.dao.mark_processing = AsyncMock(return_value=True)
    await service.process_jimeng(r.queue, r.task)
    assert r.cli.submit.await_args.args[0]['prompt'] == 'original database request'


@pytest.mark.asyncio
async def test_revoked_source_access_before_submit_is_refundable(runtime, monkeypatch):
    r = runtime
    monkeypatch.setattr(service, 'inspect_inputs', AsyncMock(side_effect=service.GenerationAccessDenied('private detail')))
    await service.advance(r.queue, r.task, r.config)
    assert r.job['stage'] == 'refund_pending'
    assert 'private detail' not in r.job['message']
    r.cli.submit.assert_not_awaited()
