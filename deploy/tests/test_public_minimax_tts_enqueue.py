"""Exercise public audio submission through the actual application composition.

Identity, object access, provider configuration, and queue are replaced here.
Real access, database, billing, and queue behavior have account-isolation tests.
"""
from unittest.mock import Mock

from fastapi import HTTPException
import pytest

import public_main
from routers import audio, public_application
from services.online_provider_task_service import OnlineProviderTaskService
from tts_enqueue_contract import public_tts_backend as tts_backend, tts_client as client


async def test_public_tts_preserves_storyboard_fields_and_returns_queued_task(client, tts_backend):
    response = await client.post("/api/minimax/tts", json={
        "text": "你好", "voice_id": "female-shaonv",
        "entity_type": "storyboard_item", "entity_id": "shot-1",
        "episode_id": "episode-1", "storyboard_lineage_id": "lineage-1",
    })
    assert response.status_code == 200, response.text
    assert response.json() == {"success": True, "task_id": "task-public-tts"}
    tts_backend.service.submit.assert_awaited_once()
    call = tts_backend.service.submit.await_args.kwargs
    assert call["task_type"] == "minimax_tts"
    assert call["user_id"] == "user-public-tts"
    assert call["prepare"] is False
    assert call["priority"] == 2
    assert call["task_data"]["text"] == "你好"
    assert call["task_data"]["voice_id"] == "female-shaonv"
    assert call["task_data"]["entity_type"] == "storyboard_item"
    assert call["task_data"]["entity_id"] == "shot-1"
    assert call["task_data"]["episode_id"] == "episode-1"
    assert call["task_data"]["storyboard_lineage_id"] == "lineage-1"


@pytest.mark.parametrize("binding", [
    "00000000-0000-4000-8000-000000000001",
    "urn:uuid:00000000-0000-4000-8000-000000000001",
])
async def test_public_tts_preserves_character_voice_binding(client, tts_backend, binding):
    response = await client.post("/api/minimax/tts", json={
        "text": "试听文本", "voice_id": "female-shaonv",
        "bind_to_character_voice_id": binding,
    })
    assert response.status_code == 200, response.text
    assert tts_backend.service.submit.await_args.kwargs["task_data"][
        "bind_to_character_voice_id"
    ] == "00000000-0000-4000-8000-000000000001"
    assert audio.require_character_voice_access.await_args.args[0] == "00000000-0000-4000-8000-000000000001"


async def test_public_tts_without_queue_returns_service_unavailable(client, tts_backend, monkeypatch):
    monkeypatch.setattr(public_main, "online_task_service", None)
    response = await client.post("/api/minimax/tts", json={"text": "Hello", "voice_id": "voice-1"})
    assert response.status_code == 503, response.text
    tts_backend.service.submit.assert_not_awaited()


async def test_public_tts_without_provider_configuration_does_not_enqueue(client, tts_backend):
    tts_backend.provider.api_key = ""
    response = await client.post("/api/minimax/tts", json={"text": "Hello", "voice_id": "voice-1"})
    assert response.status_code == 503, response.text
    tts_backend.service.submit.assert_not_awaited()


async def test_public_tts_without_login_does_not_resolve_provider_or_enqueue(client, tts_backend):
    public_main.app.dependency_overrides.clear()
    response = await client.post("/api/minimax/tts", json={"text": "Hello", "voice_id": "voice-1"})
    assert response.status_code == 401, response.text
    tts_backend.resolve_provider.assert_not_called()
    tts_backend.service.submit.assert_not_awaited()


async def test_public_tts_preserves_task_service_access_denial(client, tts_backend):
    tts_backend.service.submit.side_effect = HTTPException(status_code=404, detail="Scope unavailable")
    response = await client.post("/api/minimax/tts", json={"text": "Hello", "voice_id": "voice-1"})
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "Scope unavailable"
    tts_backend.service.submit.assert_awaited_once()


def test_deferred_service_resolves_current_lifespan_owner(monkeypatch):
    facade = public_main.deferred_online_service
    first, second = object(), object()
    monkeypatch.setattr(public_main, "online_task_service", first)
    assert facade.get() is first
    monkeypatch.setattr(public_main, "online_task_service", second)
    assert facade.get() is second
    monkeypatch.setattr(public_main, "online_task_service", None)
    with pytest.raises(RuntimeError, match="has not started"):
        facade.get()


async def test_online_service_rejects_local_preparation_before_side_effects():
    service = OnlineProviderTaskService(Mock())
    with pytest.raises(HTTPException) as error:
        await service.submit("minimax_tts", {"text": "Hello"}, "user-1", prepare=True)
    assert error.value.status_code == 422
    assert service.redis.mock_calls == []
