"""Shared submission guards, independent of a private execution runtime."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from routers.online_provider_tasks import create_online_provider_task_router
from schemas.generation import GenerateRequest
from services.entity_access_service import EntityAccessDenied
from services.generation_access_service import GenerationAccessDenied, require_generation_request_access


def task_service():
    queue = SimpleNamespace(
        get_queue_length=AsyncMock(return_value=1), get_processing_count=AsyncMock(return_value=1),
        get_external_queue_length=AsyncMock(return_value=1), get_external_processing_count=AsyncMock(return_value=1),
    )
    return SimpleNamespace(submit=AsyncMock(return_value="task_verified"), get_queue=Mock(return_value=queue))


async def allow_scope(*_args, **_kwargs):
    return {"project_id": "", "episode_id": ""}


def public_generation_router(service, files, checker):
    return create_online_provider_task_router(
        require_auth_dependency=AsyncMock(return_value="owner"), task_service=service,
        task_dao=Mock(), file_dao=files, get_pubsub_redis_client=Mock(), logger=Mock(),
        generation_access_checker=checker,
    )


def generate_endpoint(router):
    return next(route.endpoint for route in router.routes if route.path == "/api/generate")


class GenerationOptionsContract:
    @pytest.mark.asyncio
    async def test_unauthorized_studio_scope_cannot_enqueue(self):
        service = task_service()
        checker = AsyncMock(side_effect=GenerationAccessDenied("denied"))
        endpoint = generate_endpoint(self.router(service, Mock(), checker))
        with pytest.raises(HTTPException) as error:
            await endpoint(GenerateRequest(
                task_type="seedance_i2v", entity_type="episode", entity_id="ep_other",
                episode_id="ep_other", project_id="proj_1", file_role="studio_video",
                media_inputs=[{"kind": "image", "url": "/storage/private.png", "role": "first_frame"}],
            ), username="owner")
        assert error.value.status_code == 404
        checker.assert_awaited_once()
        service.submit.assert_not_awaited()
        service.get_queue.assert_not_called()

    @pytest.mark.asyncio
    async def test_missing_hailuo_duration_uses_six_seconds(self):
        service = task_service()
        endpoint = generate_endpoint(self.router(service, Mock(), allow_scope))
        request = GenerateRequest(task_type="minimax_i2v", first_frame_image="/storage/frame.png")
        original = request.model_dump()
        await endpoint(request, username="owner")
        service.submit.assert_awaited_once()
        submitted = service.submit.await_args.args[1]
        assert submitted["duration"] == 6
        assert submitted["minimax_resolution"] == "768P"
        assert request.model_dump() == original

    @pytest.mark.asyncio
    async def test_invalid_hailuo_resolution_duration_cannot_enqueue(self):
        service = task_service()
        endpoint = generate_endpoint(self.router(service, Mock(), allow_scope))
        with pytest.raises(HTTPException) as error:
            await endpoint(GenerateRequest(task_type="minimax_i2v", first_frame_image="/storage/frame.png",
                                           duration=10, minimax_resolution="1080P"), username="owner")
        assert error.value.status_code == 400
        assert "1080P 仅支持 6 秒" in str(error.value.detail)
        service.submit.assert_not_awaited()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("sub_model", ["fast", "mini"])
    async def test_seedance_resolution_is_checked_at_http_and_internal_boundaries(self, sub_model):
        service = task_service()
        router = self.router(service, Mock(), allow_scope)
        payload = {"task_type": "seedance_i2v", "model": f"Seedance2{sub_model.title()}",
                   "sub_model": sub_model, "duration": 5, "resolution": "1080P"}
        app = FastAPI()
        app.include_router(router)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/generate", json=payload)
        assert response.status_code == 422
        assert "480P 或 720P" in response.text
        service.submit.assert_not_awaited()
        with pytest.raises(HTTPException) as error:
            await generate_endpoint(router)(GenerateRequest.model_construct(**payload), username="owner")
        assert error.value.status_code == 400
        assert "仅支持 480P 和 720P" in str(error.value.detail)
        service.submit.assert_not_awaited()


class MediaReferenceSubmissionContract:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("field", ["image_path", "first_frame_image", "last_frame_image", "media_url", "media_id"])
    @pytest.mark.parametrize("access", ["same_project", "other_project", "denied"])
    async def test_every_source_is_authorized_before_submission(self, field, access):
        records = {
            "file_first": {"file_id": "file_first", "project_id": "proj_1"},
            "file_last": {"file_id": "file_last", "project_id": "proj_other" if access == "other_project" else "proj_1"},
        }
        files = SimpleNamespace(get_file=AsyncMock(side_effect=lambda file_id: records.get(file_id)))
        checked = []

        async def entity_scope(entity_type, entity_id, identity, role):
            assert (entity_type, entity_id) in {("episode", "ep_1"), ("video_segment", "seg_1")}
            assert (identity, role) == ("owner", "member")
            return {"project_id": "proj_1", "episode_id": "ep_1"}

        async def owned_file(file_id, identity, role, *, file_dao):
            assert (identity, role) == ("owner", "readonly")
            checked.append(file_id)
            record = await file_dao.get_by_id(file_id)
            if not record or (file_id == "file_last" and access == "denied"):
                raise EntityAccessDenied("denied")
            return {**record, "_access_project_id": record["project_id"]}

        async def checker(request, identity, references, *, file_dao):
            return await require_generation_request_access(
                request, identity, references, file_dao=file_dao,
                entity_access_checker=entity_scope, file_access_checker=owned_file,
            )

        first, last = "/api/files/file_first/download?download=1", "/api/files/file_last/download"
        payload = {"task_type": "seedance_i2v", "entity_type": "video_segment", "entity_id": "seg_1",
                   "episode_id": "ep_1", "image_path": first}
        if field == "media_url":
            payload["media_inputs"] = [{"kind": "image", "url": last, "role": "reference_image"}]
        elif field == "media_id":
            # A permitted URL must not conceal a different, denied file id.
            payload["media_inputs"] = [{"kind": "image", "url": first, "file_id": "file_last", "role": "reference_image"}]
        else:
            payload[field] = last
        request = GenerateRequest(**payload)
        original = request.model_dump()
        service = task_service()
        endpoint = generate_endpoint(self.router(service, files, checker))
        if access != "same_project":
            with pytest.raises(HTTPException) as error:
                await endpoint(request, username="owner")
            assert error.value.status_code == 404
            service.submit.assert_not_awaited()
            service.get_queue.assert_not_called()
        else:
            result = await endpoint(request, username="owner")
            assert result["success"] is True and result["accepting_submissions"] is True
            service.submit.assert_awaited_once()
            args = service.submit.await_args.args
            assert (args[0], args[2]) == ("seedance_i2v", "owner")
            assert args[1] == original
        assert "file_last" in checked
        assert request.model_dump() == original
