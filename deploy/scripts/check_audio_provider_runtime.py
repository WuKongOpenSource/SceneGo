#!/usr/bin/env python3
"""Check audio provider runtime wiring without calling external APIs."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import sys


def deploy_root() -> Path:
    return Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


@dataclass
class FakeConfig:
    api_key: str
    endpoint: str
    model_name: str = ""
    proxy: str = ""
    extra: dict[str, str] = field(default_factory=dict)

    def aiohttp_proxy(self) -> str:
        return self.proxy

    def url_for_operation(self, operation: str, **path_params) -> str:
        from services.api_provider_registry import get_provider_api_path  # noqa: PLC0415

        path = get_provider_api_path("minimax", operation, **path_params).strip("/")
        return f"{self.endpoint.rstrip('/')}/{path}" if path else self.endpoint.rstrip("/")


def main() -> int:
    root = deploy_root()
    sys.path.insert(0, str(root))

    import external_api.audio.minimax_audio as minimax_audio  # noqa: PLC0415

    minimax_calls: list[tuple[str, str]] = []

    def fake_minimax_resolve_provider(provider: str, model_name: str | None = None) -> FakeConfig:
        minimax_calls.append((provider, model_name or ""))
        return FakeConfig(
            api_key="test-placeholder-credential",
            endpoint="https://runtime.example.test/minimax/v1",
            model_name="MiniMax-Hailuo-02",
            proxy="http://minimax-proxy.example.test:8080",
            extra={"group_id": "runtime-group"},
        )

    original_minimax = minimax_audio.resolve_provider
    minimax_audio.resolve_provider = fake_minimax_resolve_provider
    try:
        minimax_client = minimax_audio.MinimaxAudioClient()
        explicit_group_client = minimax_audio.MinimaxAudioClient(group_id="explicit-group")
    finally:
        minimax_audio.resolve_provider = original_minimax

    if minimax_calls != [
        ("minimax", minimax_audio.MINIMAX_DEFAULT_PROVIDER_MODEL),
        ("minimax", minimax_audio.MINIMAX_DEFAULT_PROVIDER_MODEL),
    ]:
        fail(f"MinimaxAudioClient did not resolve minimax runtime config: {minimax_calls}")
    if minimax_client.api_key != "test-placeholder-credential":
        fail("MinimaxAudioClient did not pick up resolved key")
    if minimax_client.base_url != "https://runtime.example.test/minimax/v1":
        fail("MinimaxAudioClient did not pick up resolved endpoint")
    if minimax_client._aiohttp_proxy != "http://minimax-proxy.example.test:8080":
        fail("MinimaxAudioClient did not pick up resolved proxy")
    if minimax_client.group_id != "runtime-group":
        fail(f"MinimaxAudioClient did not pick up runtime group_id: {minimax_client.group_id}")
    if minimax_client._group_params({"task_id": "task-1"}) != {
        "task_id": "task-1",
        "GroupId": "runtime-group",
    }:
        fail(f"MinimaxAudioClient did not include GroupId params: {minimax_client._group_params({'task_id': 'task-1'})}")
    if explicit_group_client.group_id != "explicit-group":
        fail("Explicit MiniMax group_id should override runtime extra config")

    print("Audio provider runtime OK")
    print("  minimax_audio_group_id_wired=1")
    print("  minimax_audio_proxy_wired=1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
