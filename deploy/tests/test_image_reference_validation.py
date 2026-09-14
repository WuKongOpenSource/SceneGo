"""Reference preflight must not generate, charge, or disclose source paths."""
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from routers.ai_proxy import create_ai_proxy_router
from schemas.generation import ImageReferenceValidationRequest
from services.generation_access_service import GenerationAccessDenied


def endpoint(checker):
    router = create_ai_proxy_router(
        require_auth_dependency=AsyncMock(return_value="user_1"),
        get_main_event_loop=lambda: None,
        get_redis_client=lambda: None,
        file_dao=Mock(),
        generation_access_checker=checker,
    )
    route = next(r for r in router.routes if r.path == "/api/ai/image-references/validate")
    assert route.dependant.dependencies
    return route.endpoint


async def test_reports_only_invalid_indexes_without_generation(monkeypatch):
    provider = AsyncMock()
    task = AsyncMock()
    monkeypatch.setattr("routers.ai_proxy.proxy_generate_doubao_images", provider)
    monkeypatch.setattr("routers.ai_proxy.start_ai_proxy_task", task)
    monkeypatch.setattr("routers.ai_proxy.resolve_registered_reference_paths", AsyncMock(return_value={}))

    async def check(request, identity, refs, **kwargs):
        if refs == ["/storage/deleted.png"]:
            raise GenerationAccessDenied("private server detail")

    result = await endpoint(check)(ImageReferenceValidationRequest(
        references=["/storage/valid.png", "/storage/deleted.png"],
        project_id="proj_1", entity_type="storyboard_item", entity_id="shot_1",
    ), username="user_1")
    assert result == {"invalid_indexes": [1]}
    provider.assert_not_called()
    task.assert_not_called()


async def test_denied_scope_stops_before_inspecting_sources():
    checker = AsyncMock(side_effect=GenerationAccessDenied("secret path"))
    with pytest.raises(HTTPException) as error:
        await endpoint(checker)(ImageReferenceValidationRequest(references=["/storage/x.png"]), username="user_1")
    assert error.value.status_code == 404
    assert "secret" not in error.value.detail
    assert "重新选择参考图" in error.value.detail
    assert checker.await_count == 1
    assert checker.call_args.args[2] == []


async def test_missing_physical_file_is_invalid(monkeypatch):
    from services.ai_proxy_reference_service import ReferenceImageError
    monkeypatch.setattr("routers.ai_proxy.resolve_registered_reference_paths", AsyncMock(side_effect=ReferenceImageError("unreadable")))
    result = await endpoint(AsyncMock())(ImageReferenceValidationRequest(references=["/storage/missing.png", ""]), username="user_1")
    assert result == {"invalid_indexes": [0, 1]}


async def test_database_failure_is_not_misreported_as_deleted():
    checker = AsyncMock(side_effect=RuntimeError("database unavailable"))
    with pytest.raises(RuntimeError):
        await endpoint(checker)(ImageReferenceValidationRequest(references=["/storage/x.png"]), username="user_1")


def test_limits_preflight_batch():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ImageReferenceValidationRequest(references=["x"] * 17)


def test_http_preflight_requires_authentication():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    async def deny_auth():
        raise HTTPException(status_code=401, detail="Login required")

    checker = AsyncMock()
    app = FastAPI()
    app.include_router(create_ai_proxy_router(
        require_auth_dependency=deny_auth,
        get_main_event_loop=lambda: None,
        get_redis_client=lambda: None,
        file_dao=Mock(),
        generation_access_checker=checker,
    ))
    with TestClient(app) as client:
        response = client.post('/api/ai/image-references/validate', json={'references': ['/storage/x.png']})
    assert response.status_code == 401
    checker.assert_not_called()
