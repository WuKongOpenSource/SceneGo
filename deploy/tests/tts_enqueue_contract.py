"""Shared audio HTTP assertions with composition-specific service adapters."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, create_autospec

from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
import pytest


@pytest.fixture
def public_tts_backend(monkeypatch):
    import public_main
    from routers import audio, public_application
    from services.online_provider_task_service import OnlineProviderTaskService

    assert not public_main.app.dependency_overrides
    # A strict signature catches adapter errors without invoking the queue.
    service = create_autospec(OnlineProviderTaskService, instance=True)
    service.submit.return_value = "task-public-tts"
    provider = SimpleNamespace(api_key="test-only")
    resolve_provider = Mock(return_value=provider)
    monkeypatch.setattr(public_main, "online_task_service", service)
    monkeypatch.setattr(public_application, "get_minimax_audio_client", resolve_provider)
    monkeypatch.setattr(audio, "require_generation_request_access",
                        AsyncMock(return_value={"project_id": ""}))
    monkeypatch.setattr(audio, "require_character_voice_access",
                        AsyncMock(return_value={"project_id": "project-fixture"}))
    user_id = "user-public-tts"
    monkeypatch.setattr(public_main.app, "dependency_overrides", {
        public_application.get_current_user: lambda: user_id,
    })
    return SimpleNamespace(app=public_main.app, service=service, provider=provider,
                           resolve_provider=resolve_provider, user_id=user_id)


@pytest.fixture
async def tts_client(tts_backend):
    transport = ASGITransport(app=tts_backend.app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        yield client


class TtsEnqueueContract:
    @pytest.mark.asyncio
    async def test_post_minimax_tts_returns_task_id_immediately(self, client, tts_backend):
        svc = tts_backend.service
        svc.submit.return_value = "uuid-task-1"
        resp = await client.post("/api/minimax/tts", json={
            "text": "你好", "voice_id": "female-shaonv",
            "entity_type": "storyboard_item", "entity_id": "shot_1",
            "episode_id": "ep_1", "storyboard_lineage_id": "line_1",
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["success"] is True
        assert body["task_id"] == "uuid-task-1"
        svc.submit.assert_awaited_once()
        call_kwargs = svc.submit.call_args.kwargs
        assert call_kwargs["task_type"] == "minimax_tts"
        assert call_kwargs["task_data"]["text"] == "你好"
        assert call_kwargs["task_data"]["voice_id"] == "female-shaonv"
        assert call_kwargs["task_data"]["storyboard_lineage_id"] == "line_1"
        assert call_kwargs["prepare"] is False
        assert call_kwargs["user_id"] == tts_backend.user_id

    @pytest.mark.asyncio
    async def test_post_minimax_tts_passes_bind_to_character_voice_id(self, client, tts_backend):
        svc = tts_backend.service
        svc.submit.return_value = "uuid-task-2"
        resp = await client.post("/api/minimax/tts", json={
            "text": "试听文本", "voice_id": "female-shaonv",
            "bind_to_character_voice_id": "00000000-0000-4000-8000-000000000001",
        })
        assert resp.status_code == 200, resp.text
        call_kwargs = svc.submit.call_args.kwargs
        assert call_kwargs["task_data"]["bind_to_character_voice_id"] == "00000000-0000-4000-8000-000000000001"

    @pytest.mark.asyncio
    async def test_post_minimax_tts_503_when_minimax_not_configured(self, client, tts_backend):
        tts_backend.resolve_provider.side_effect = HTTPException(
            status_code=503, detail="MiniMax 未配置 — 请先在 admin 加 MINIMAX_API_KEY",
        )
        resp = await client.post("/api/minimax/tts", json={"text": "x", "voice_id": "v"})
        assert resp.status_code == 503
        tts_backend.service.submit.assert_not_awaited()
