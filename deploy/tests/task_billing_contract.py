"""Billing and online quota behavior shared by both submission services."""
from unittest.mock import AsyncMock
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from services import credit_service, task_credit_billing_service


class RecordingQueue:
    def __init__(self, result=True):
        self.result = result
        self.tasks = []

    async def enqueue(self, task):
        self.tasks.append(task)
        return self.result

    async def reserve_daily_quota(self, *_args, **_kwargs):
        return True

    async def release_daily_quota(self, *_args, **_kwargs):
        return None


class TaskBillingContract:
    @pytest.mark.asyncio
    async def test_jimeng_ordinary_user_is_denied_before_credit_reservation(self, monkeypatch):
        from services.jimeng_access_service import UserDAO
        from services import jimeng_preflight_service
        monkeypatch.setattr(UserDAO, 'get_session_identity', AsyncMock(return_value={
            'user_id': 'user-1', 'username': 'admin', 'role': 'user', 'status': 'active', 'is_active': True}))
        reserve, refund, provider_status = AsyncMock(), AsyncMock(), AsyncMock()
        monkeypatch.setattr(task_credit_billing_service, 'reserve_task_credits', reserve)
        monkeypatch.setattr(task_credit_billing_service, 'release_task_credits', refund)
        monkeypatch.setattr(jimeng_preflight_service, 'JimengCli', provider_status)
        service = self.service_type(None, model_access_checker=AsyncMock(return_value={}))
        service.queue = self.queue_type()
        with pytest.raises(HTTPException) as error:
            await service.submit('jimeng_multimodal', {'model': 'JimengSeedance2', 'role': 'super_admin'},
                                 'user-1', prepare=False, task_id='new')
        assert error.value.status_code == 403
        reserve.assert_not_awaited()
        refund.assert_not_awaited()
        provider_status.assert_not_called()
        assert not service.queue.tasks

    @pytest.mark.asyncio
    @pytest.mark.parametrize('managed', [False, True])
    async def test_jimeng_uncertain_delivery_refund_is_owned_by_durable_job(self, monkeypatch, managed):
        from services import jimeng_preflight_service, jimeng_submission_service
        monkeypatch.setattr(jimeng_preflight_service, 'preflight_jimeng', AsyncMock())
        monkeypatch.setattr(task_credit_billing_service, 'reserve_task_credits', AsyncMock(return_value={'amount': 100}))
        refund = AsyncMock()
        monkeypatch.setattr(task_credit_billing_service, 'release_task_credits', refund)
        async def enqueue(_queue, task):
            if managed:
                task.data[jimeng_submission_service.ENQUEUE_MANAGED_KEY] = True
            raise RuntimeError('simulated enqueue failure')
        monkeypatch.setattr(jimeng_submission_service, 'enqueue_jimeng_task', enqueue)
        service = self.service_type(None, model_access_checker=AsyncMock(return_value={}))
        service.queue = self.queue_type()
        with pytest.raises(RuntimeError):
            await service.submit('jimeng_multimodal', {}, 'user-1', prepare=False, task_id='new')
        if managed:
            refund.assert_not_awaited()
        else:
            refund.assert_awaited_once()

    def assert_enqueued_data(self, enqueued, original):
        assert enqueued == original

    def quota_submission(self, monkeypatch):
        from dao_task import TaskDAO

        events = []

        def recorded(name, result):
            async def call(*_args, **_kwargs):
                events.append(name)
                return result
            return AsyncMock(side_effect=call)

        seeds = recorded("load_seeds", ["previous"])
        credits = recorded("credits", True)
        refund = recorded("refund", None)
        monkeypatch.setattr(TaskDAO, "get_task_ids_created_between", seeds)
        monkeypatch.setattr(task_credit_billing_service, "reserve_task_credits", credits)
        monkeypatch.setattr(task_credit_billing_service, "release_task_credits", refund)
        service = self.service_type(object(), model_access_checker=AsyncMock(return_value={}))
        service.queue = self.queue_type()
        service.queue.reserve_daily_quota = recorded("quota", True)
        service.queue.release_daily_quota = recorded("release_quota", None)
        service.queue.enqueue = recorded("enqueue", True)
        return SimpleNamespace(service=service, queue=service.queue, events=events,
                               seeds=seeds, credits=credits, refund=refund)

    @pytest.mark.asyncio
    @pytest.mark.parametrize("task_type", ["minimax_i2v", "minimax_morph"])
    async def test_hailuo_reserves_quota_before_billing_and_keeps_successful_slot(self, monkeypatch, task_type):
        state = self.quota_submission(monkeypatch)
        assert await state.service.submit(task_type, {}, "user-1", prepare=False, task_id="new") == "new"
        assert state.events == ["load_seeds", "quota", "credits", "enqueue"]
        seed_call = state.seeds.await_args
        assert seed_call.args[0] == ["minimax_i2v", "minimax_morph"]
        assert seed_call.kwargs == {"limit": 10}
        assert (seed_call.args[2] - seed_call.args[1]).total_seconds() == 86400
        assert seed_call.args[1].tzinfo is seed_call.args[2].tzinfo is None
        quota_call = state.queue.reserve_daily_quota.await_args
        assert quota_call.args[0].startswith("ostory:quota:minimax_hailuo_23:")
        assert quota_call.args[1:] == ("new", ["previous"])
        assert quota_call.kwargs["limit"] == 3
        assert 3600 <= quota_call.kwargs["ttl_seconds"] <= 90000
        state.refund.assert_not_awaited()
        state.queue.release_daily_quota.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_seed_query_failure_never_reserves_or_releases_quota(self, monkeypatch):
        state = self.quota_submission(monkeypatch)
        failure = RuntimeError("Persistence unavailable")
        state.seeds.side_effect = failure
        with pytest.raises(RuntimeError) as error:
            await state.service.submit("minimax_i2v", {}, "user-1", prepare=False, task_id="new")
        assert error.value is failure
        state.queue.reserve_daily_quota.assert_not_awaited()
        state.queue.release_daily_quota.assert_not_awaited()
        state.credits.assert_not_awaited()
        state.refund.assert_not_awaited()
        state.queue.enqueue.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_credit_rejection_releases_quota_without_refunding_unreserved_credits(self, monkeypatch):
        state = self.quota_submission(monkeypatch)
        state.credits.side_effect = credit_service.InsufficientCreditsError("available=0 required=50")
        with pytest.raises(HTTPException) as error:
            await state.service.submit("minimax_i2v", {}, "user-1", prepare=False, task_id="new")
        assert error.value.status_code == 402
        state.queue.release_daily_quota.assert_awaited_once_with(
            state.queue.reserve_daily_quota.await_args.args[0], "new",
        )
        state.refund.assert_not_awaited()
        state.queue.enqueue.assert_not_awaited()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("failure_mode", ["false", "raise", "refund_error", "quota_release_error"])
    async def test_enqueue_failure_releases_both_reservations_and_preserves_original_error(self, monkeypatch, failure_mode):
        state = self.quota_submission(monkeypatch)
        failure = RuntimeError("Queue unavailable")
        if failure_mode == "false":
            state.queue.enqueue.side_effect = None
            state.queue.enqueue.return_value = False
            expected = HTTPException
        else:
            state.queue.enqueue.side_effect = failure
            expected = RuntimeError
        if failure_mode == "refund_error":
            state.refund.side_effect = RuntimeError("Refund unavailable")
        elif failure_mode == "quota_release_error":
            state.queue.release_daily_quota.side_effect = RuntimeError("Quota unavailable")
        with pytest.raises(expected) as error:
            await state.service.submit("minimax_i2v", {}, "user-1", prepare=False, task_id="new")
        if failure_mode == "false":
            assert error.value.status_code == 500
        else:
            assert error.value is failure
        state.refund.assert_awaited_once()
        assert state.refund.await_args.kwargs["task_id"] == "new"
        assert state.refund.await_args.kwargs["reason"] == "enqueue_failed"
        state.queue.release_daily_quota.assert_awaited_once_with(
            state.queue.reserve_daily_quota.await_args.args[0], "new",
        )

    @pytest.mark.asyncio
    async def test_other_online_models_do_not_use_hailuo_quota(self, monkeypatch):
        state = self.quota_submission(monkeypatch)
        assert await state.service.submit("sora2_i2v", {}, "user-1", prepare=False, task_id="new") == "new"
        assert state.events == ["credits", "enqueue"]
        state.seeds.assert_not_awaited()
        state.queue.reserve_daily_quota.assert_not_awaited()
        state.queue.release_daily_quota.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_submit_reserves_before_enqueue_and_persists_metadata(self, monkeypatch):
        events = []

        async def reserve(**kwargs):
            events.append("reserve")
            kwargs["task_data"][task_credit_billing_service.BILLING_METADATA_KEY] = {
                "feature_key": "video_generation",
                "owner_id": kwargs["user_id"],
            }
            return kwargs["task_data"][task_credit_billing_service.BILLING_METADATA_KEY]

        async def release(**_kwargs):
            events.append("release")

        monkeypatch.setattr(task_credit_billing_service, "reserve_task_credits", reserve)
        monkeypatch.setattr(task_credit_billing_service, "release_task_credits", release)

        service = self.service_type(None, model_access_checker=AsyncMock(return_value={}))
        service.queue = self.queue_type()
        task_data = {"duration": 5}
        task_id = await service.submit(
            task_type=self.task_type,
            task_data=task_data,
            user_id="user-1",
            prepare=False,
            task_id="task-1",
        )

        assert task_id == "task-1"
        assert events == ["reserve"]
        self.assert_enqueued_data(service.queue.tasks[0].data, task_data)
        assert task_credit_billing_service.BILLING_METADATA_KEY in service.queue.tasks[0].data


    @pytest.mark.asyncio
    async def test_submit_releases_reservation_when_enqueue_fails(self, monkeypatch):
        releases = []

        async def reserve(**kwargs):
            kwargs["task_data"][task_credit_billing_service.BILLING_METADATA_KEY] = {
                "feature_key": "video_generation",
                "owner_id": kwargs["user_id"],
            }
            return kwargs["task_data"][task_credit_billing_service.BILLING_METADATA_KEY]

        async def release(**kwargs):
            releases.append(kwargs)

        monkeypatch.setattr(task_credit_billing_service, "reserve_task_credits", reserve)
        monkeypatch.setattr(task_credit_billing_service, "release_task_credits", release)

        service = self.service_type(None, model_access_checker=AsyncMock(return_value={}))
        service.queue = self.queue_type(result=False)
        with pytest.raises(HTTPException) as exc_info:
            await service.submit(
                task_type=self.task_type,
                task_data={"duration": 5},
                user_id="user-1",
                prepare=False,
                task_id="task-2",
            )

        assert exc_info.value.status_code == 500
        assert releases[0]["task_id"] == "task-2"
        assert releases[0]["reason"] == "enqueue_failed"


    @pytest.mark.asyncio
    async def test_submit_maps_insufficient_credits_to_payment_required(self, monkeypatch):
        async def reserve(**_kwargs):
            raise credit_service.InsufficientCreditsError("available=1 required=50")

        async def release(**_kwargs):
            raise AssertionError("no reservation exists")

        monkeypatch.setattr(task_credit_billing_service, "reserve_task_credits", reserve)
        monkeypatch.setattr(task_credit_billing_service, "release_task_credits", release)

        service = self.service_type(None, model_access_checker=AsyncMock(return_value={}))
        service.queue = self.queue_type()
        with pytest.raises(HTTPException) as exc_info:
            await service.submit(
                task_type=self.task_type,
                task_data={"duration": 5},
                user_id="user-1",
                prepare=False,
                task_id="task-3",
            )

        assert exc_info.value.status_code == 402
        assert "创作点数不足" in str(exc_info.value.detail)
        assert service.queue.tasks == []


    @pytest.mark.asyncio
    async def test_submit_rejects_fourth_platform_hailuo_task_with_exact_message(self, monkeypatch):
        from dao_task import TaskDAO

        monkeypatch.setattr(
            TaskDAO,
            "get_task_ids_created_between",
            AsyncMock(return_value=["hailuo-1", "hailuo-2", "hailuo-3"]),
        )
        service = self.service_type(object(), model_access_checker=AsyncMock(return_value={}))
        service.queue = self.queue_type()
        service.queue.reserve_daily_quota = AsyncMock(return_value=False)
        reserve = AsyncMock(side_effect=AssertionError("No billing after quota rejection"))
        monkeypatch.setattr(task_credit_billing_service, "reserve_task_credits", reserve)

        with pytest.raises(HTTPException) as exc_info:
            await service.submit("minimax_i2v", {}, "user-1", prepare=False, task_id="hailuo-4")

        assert exc_info.value.status_code == 429
        assert exc_info.value.detail == {
            "code": "minimax_hailuo_daily_limit",
            "message": "今日已达限额",
        }
        reserve.assert_not_awaited()
        assert service.queue.tasks == []
