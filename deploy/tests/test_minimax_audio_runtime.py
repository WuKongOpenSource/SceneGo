"""Runtime wiring tests for MiniMax audio client."""
import os
from dataclasses import dataclass, field
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import minimax_audio
from services.api_provider_registry import (
    MINIMAX_DEFAULT_PROVIDER_MODEL,
    MINIMAX_MUSIC_MODEL,
    MINIMAX_MUSIC_OPERATION,
)


@dataclass
class FakeConfig:
    api_key: str = "runtime-minimax-key"
    endpoint: str = "https://minimax-runtime.example.test/v1"
    model_name: str = "MiniMax-Hailuo-02"
    proxy: str = "http://runtime-proxy.example.test:8080"
    extra: dict[str, str] = field(default_factory=lambda: {"group_id": "runtime-group"})

    def aiohttp_proxy(self) -> str:
        return self.proxy

    def url_for_operation(self, operation: str, **path_params) -> str:
        from services.api_provider_registry import get_provider_api_path

        path = get_provider_api_path("minimax", operation, **path_params).strip("/")
        return f"{self.endpoint.rstrip('/')}/{path}" if path else self.endpoint.rstrip("/")


def _fake_response(payload: dict, status: int = 200):
    resp = MagicMock()
    resp.status = status
    resp.json = AsyncMock(return_value=payload)
    resp.__aenter__ = AsyncMock(return_value=resp)
    resp.__aexit__ = AsyncMock(return_value=False)
    return resp


def _fake_session(get_response):
    session = MagicMock()
    session.get = MagicMock(return_value=get_response)
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    return session


def _fake_post_session(post_response):
    session = MagicMock()
    session.post = MagicMock(return_value=post_response)
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    return session


def test_minimax_audio_client_uses_runtime_endpoint_proxy_and_group(monkeypatch):
    calls: list[tuple[str, str]] = []

    def fake_resolve_provider(provider: str, model_name: str | None = None) -> FakeConfig:
        calls.append((provider, model_name or ""))
        return FakeConfig()

    monkeypatch.setattr(minimax_audio, "resolve_provider", fake_resolve_provider)

    client = minimax_audio.MinimaxAudioClient()

    assert calls == [("minimax", MINIMAX_DEFAULT_PROVIDER_MODEL)]
    assert client.api_key == "runtime-minimax-key"
    assert client.base_url == "https://minimax-runtime.example.test/v1"
    assert client._aiohttp_proxy == "http://runtime-proxy.example.test:8080"
    assert client.group_id == "runtime-group"
    assert client._group_params({"task_id": "task-1"}) == {
        "task_id": "task-1",
        "GroupId": "runtime-group",
    }


def test_minimax_audio_explicit_group_id_overrides_runtime_extra(monkeypatch):
    monkeypatch.setattr(minimax_audio, "resolve_provider", lambda *_args, **_kwargs: FakeConfig())

    client = minimax_audio.MinimaxAudioClient(group_id="explicit-group")

    assert client.group_id == "explicit-group"
    assert client._group_params() == {"GroupId": "explicit-group"}


def test_minimax_audio_token_plan_key_omits_legacy_group_id(monkeypatch):
    config = FakeConfig(api_key="sk-cp-test-placeholder-token")
    monkeypatch.setattr(minimax_audio, "resolve_provider", lambda *_args, **_kwargs: config)

    client = minimax_audio.MinimaxAudioClient()

    assert client.group_id == "runtime-group"
    assert client._group_params({"task_id": "task-1"}) == {"task_id": "task-1"}


def test_minimax_audio_token_plan_access_mode_omits_group_id(monkeypatch):
    config = FakeConfig(
        api_key="test-placeholder-credential",
        extra={"group_id": "runtime-group", "provider_access_mode": "token_plan"},
    )
    monkeypatch.setattr(minimax_audio, "resolve_provider", lambda *_args, **_kwargs: config)

    client = minimax_audio.MinimaxAudioClient()

    assert client.provider_access_mode == "token_plan"
    assert client._group_params() == {}


@pytest.mark.asyncio
async def test_minimax_audio_query_sends_group_id_param(monkeypatch):
    monkeypatch.setattr(minimax_audio, "resolve_provider", lambda *_args, **_kwargs: FakeConfig())
    fake_resp = _fake_response({"status": "Success", "base_resp": {"status_code": 0}})
    fake_session_ctx = _fake_session(fake_resp)
    client = minimax_audio.MinimaxAudioClient()

    with patch("aiohttp.ClientSession", return_value=fake_session_ctx):
        result = await client.tts_query("task-1")

    assert result["status"] == "Success"
    _, kwargs = fake_session_ctx.get.call_args
    assert kwargs["params"] == {"task_id": "task-1", "GroupId": "runtime-group"}
    assert kwargs["headers"]["Authorization"] == "Bearer runtime-minimax-key"


@pytest.mark.asyncio
async def test_minimax_audio_voice_clone_sends_runtime_group_proxy(monkeypatch):
    monkeypatch.setattr(minimax_audio, "resolve_provider", lambda *_args, **_kwargs: FakeConfig())
    fake_resp = _fake_response({"base_resp": {"status_code": 0}})
    fake_session_ctx = _fake_post_session(fake_resp)
    client = minimax_audio.MinimaxAudioClient()

    with patch("aiohttp.ClientSession", return_value=fake_session_ctx):
        result = await client.voice_clone("123", demo_text=None, voice_id_prefix="clone")

    assert result["voice_id"].startswith("clone_")
    args, kwargs = fake_session_ctx.post.call_args
    assert args[0] == "https://minimax-runtime.example.test/v1/voice_clone"
    assert kwargs["params"] == {"GroupId": "runtime-group"}
    assert kwargs["headers"]["Authorization"] == "Bearer runtime-minimax-key"
    assert kwargs["proxy"] == "http://runtime-proxy.example.test:8080"
    assert kwargs["json"]["file_id"] == 123
    assert kwargs["json"]["voice_id"].startswith("clone_")
    assert "text" not in kwargs["json"]
    assert "model" not in kwargs["json"]


@pytest.mark.asyncio
async def test_minimax_audio_music_uses_music_2_6_contract(monkeypatch):
    def fake_resolve_provider(provider: str, model_name: str | None = None) -> FakeConfig:
        if model_name == MINIMAX_MUSIC_OPERATION:
            return FakeConfig(model_name=MINIMAX_MUSIC_MODEL)
        return FakeConfig()

    monkeypatch.setattr(minimax_audio, "resolve_provider", fake_resolve_provider)
    fake_resp = _fake_response({"base_resp": {"status_code": 0}, "data": {"audio": ""}})
    fake_session_ctx = _fake_post_session(fake_resp)
    client = minimax_audio.MinimaxAudioClient()

    with patch("aiohttp.ClientSession", return_value=fake_session_ctx):
        await client.music_generate(
            lyrics="[Verse]\nhello",
            prompt="cinematic orchestral",
            refer_voice="legacy-voice",
            refer_instrumental="legacy-instrumental",
        )

    args, kwargs = fake_session_ctx.post.call_args
    assert args[0] == "https://minimax-runtime.example.test/v1/music_generation"
    assert kwargs["json"]["model"] == "music-2.6"
    assert kwargs["json"]["prompt"] == "cinematic orchestral"
    assert kwargs["json"]["lyrics"] == "[Verse]\nhello"
    assert "refer_voice" not in kwargs["json"]
    assert "refer_instrumental" not in kwargs["json"]


@pytest.mark.asyncio
async def test_minimax_audio_music_preserves_explicit_music_01_contract(monkeypatch):
    monkeypatch.setattr(minimax_audio, "resolve_provider", lambda *_args, **_kwargs: FakeConfig())
    fake_resp = _fake_response({"base_resp": {"status_code": 0}, "data": {"audio": ""}})
    fake_session_ctx = _fake_post_session(fake_resp)
    client = minimax_audio.MinimaxAudioClient()

    with patch("aiohttp.ClientSession", return_value=fake_session_ctx):
        await client.music_generate(
            prompt="legacy description",
            refer_voice="legacy-voice",
            refer_instrumental="legacy-instrumental",
            model="music-01",
            is_instrumental=True,
        )

    _, kwargs = fake_session_ctx.post.call_args
    assert kwargs["json"] == {
        "model": "music-01",
        "audio_setting": {"format": "mp3", "sample_rate": 44100, "bitrate": 256000},
        "lyrics": "legacy description",
        "refer_voice": "legacy-voice",
        "refer_instrumental": "legacy-instrumental",
    }


@pytest.mark.asyncio
async def test_minimax_audio_file_upload_sends_runtime_group_proxy(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(minimax_audio, "resolve_provider", lambda *_args, **_kwargs: FakeConfig())
    fake_resp = _fake_response({"base_resp": {"status_code": 0}, "file": {"file_id": "file-1"}})
    fake_session_ctx = _fake_post_session(fake_resp)
    upload_path = tmp_path / "voice.mp3"
    upload_path.write_bytes(b"ID3")
    client = minimax_audio.MinimaxAudioClient()

    with patch("aiohttp.ClientSession", return_value=fake_session_ctx):
        result = await client.file_upload(str(upload_path), purpose="voice_clone")

    assert result["file"]["file_id"] == "file-1"
    args, kwargs = fake_session_ctx.post.call_args
    assert args[0] == "https://minimax-runtime.example.test/v1/files/upload"
    assert kwargs["params"] == {"GroupId": "runtime-group"}
    assert kwargs["headers"] == {"Authorization": "Bearer runtime-minimax-key"}
    assert kwargs["proxy"] == "http://runtime-proxy.example.test:8080"


@pytest.mark.asyncio
async def test_minimax_audio_voice_clone_error_has_diagnostics(monkeypatch):
    monkeypatch.setattr(minimax_audio, "resolve_provider", lambda *_args, **_kwargs: FakeConfig())
    fake_resp = _fake_response(
        {
            "base_resp": {"status_code": 1004, "status_msg": "auth failed"},
            "trace_id": "trace-voice-clone",
        },
        status=401,
    )
    fake_session_ctx = _fake_post_session(fake_resp)
    client = minimax_audio.MinimaxAudioClient()

    with patch("aiohttp.ClientSession", return_value=fake_session_ctx):
        with pytest.raises(RuntimeError) as exc:
            await client.voice_clone("file-1")

    message = str(exc.value)
    assert "voice_clone failed" in message
    assert "http_status=401" in message
    assert "status_code=1004" in message
    assert "status_msg=auth failed" in message
    assert "trace_id=trace-voice-clone" in message


@pytest.mark.asyncio
async def test_runtime_loader_projects_minimax_group_id_from_request_template(monkeypatch):
    from services import api_config_runtime_loader as loader
    from services.api_provider_registry import (
        get_endpoint_env_key,
        get_provider_env_key,
    )
    from services.api_provider_runtime import resolve_provider

    managed_keys = loader.managed_api_env_keys()
    saved_dynamic_keys = set(loader._DYNAMIC_OPERATION_ENV_KEYS)
    saved_base = dict(loader._BASE_API_ENV_VALUES)
    saved_env = {key: os.environ.get(key) for key in managed_keys}
    env_key = get_provider_env_key("minimax")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)

    async def fake_list_enabled():
        return [
            {
                "provider": "minimax",
                "api_key_encrypted": "encrypted",
                "endpoint": "https://minimax-db.example.test/v1",
                "proxy_mode": "direct",
                "custom_proxy": "",
                "model_name": "MiniMax-Hailuo-02",
                "request_template": {
                    "group_id": "db-group",
                    "provider_access_mode": "token_plan",
                },
            }
        ]

    try:
        for key in managed_keys:
            os.environ.pop(key, None)
            loader._BASE_API_ENV_VALUES[key] = None
        monkeypatch.setattr(loader.ApiConfigDAO, "list_enabled", staticmethod(fake_list_enabled))
        monkeypatch.setattr(loader.ApiConfigDAO, "decrypt_key", staticmethod(lambda _enc: "db-key"))

        result = await loader.load_api_configs_to_env()
        config = resolve_provider("minimax", "MiniMax-Hailuo-02")

        assert result["success"] is True
        assert os.environ[env_key] == "db-key"
        assert os.environ[endpoint_env] == "https://minimax-db.example.test/v1"
        assert os.environ["MINIMAX_GROUP_ID"] == "db-group"
        assert os.environ["MINIMAX_PROVIDER_ACCESS_MODE"] == "token_plan"
        assert config.extra["group_id"] == "db-group"
        assert config.extra["provider_access_mode"] == "token_plan"
    finally:
        cleanup_keys = (
            loader.managed_api_env_keys()
            | set(loader._DYNAMIC_OPERATION_ENV_KEYS)
            | managed_keys
        )
        loader._BASE_API_ENV_VALUES.clear()
        loader._BASE_API_ENV_VALUES.update(saved_base)
        loader._DYNAMIC_OPERATION_ENV_KEYS.clear()
        loader._DYNAMIC_OPERATION_ENV_KEYS.update(saved_dynamic_keys)
        for key in cleanup_keys:
            value = saved_env.get(key)
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
