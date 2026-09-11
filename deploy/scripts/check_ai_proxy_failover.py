#!/usr/bin/env python3
"""Verify AI proxy call-level provider failover without real HTTP."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Any, Callable


def deploy_root() -> Path:
    return Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


class FakeResponse:
    def __init__(self, payload: dict[str, Any], status_code: int = 200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            import requests

            raise requests.HTTPError(response=self)

    def json(self) -> dict[str, Any]:
        return self._payload


class EnvGuard:
    def __init__(self, keys: set[str]):
        self.keys = keys
        self.saved = {key: os.environ.get(key) for key in keys}

    def __enter__(self):
        for key in self.keys:
            os.environ.pop(key, None)
        return self

    def __exit__(self, exc_type, exc, tb):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


async def run_case(
    proxy,
    chat_service,
    http_client,
    *,
    env: dict[str, str],
    health_rows: list[dict[str, Any]],
    request_model: str | None = None,
    expected_health_scope: list[str],
    expected_url: str,
    expected_provider: str,
    expected_model: str,
    expected_auth: str,
    expected_failover_active: bool,
) -> None:
    calls: list[dict[str, Any]] = []
    health_scope_calls: list[list[str]] = []

    async def fake_health(providers=None, *args, **kwargs):
        health_scope_calls.append(list(providers or []))
        return health_rows

    def fake_post(url: str, **kwargs):
        calls.append({"url": url, **kwargs})
        return FakeResponse({"choices": [{"message": {"content": "ok"}}]})

    original_health = chat_service.list_cached_provider_health
    original_post = http_client.requests.post
    chat_service.list_cached_provider_health = fake_health
    http_client.requests.post = fake_post
    try:
        for key, value in env.items():
            os.environ[key] = value
        result = await proxy.generate_gemini_text_result(
            prompt="hello",
            system_prompt="system",
            temperature=0.3,
            model=request_model,
        )
    finally:
        chat_service.list_cached_provider_health = original_health
        http_client.requests.post = original_post

    if result.content != "ok":
        fail(f"Unexpected generated text: {result.content}")
    if result.provider != expected_provider:
        fail(f"Unexpected provider metadata: {result.provider} != {expected_provider}")
    if result.model_name != expected_model:
        fail(f"Unexpected model metadata: {result.model_name} != {expected_model}")
    if bool(result.failover.get("active")) is not expected_failover_active:
        fail(f"Unexpected failover metadata: {result.failover}")
    if result.failover.get("selected_provider") != expected_provider:
        fail(f"Unexpected selected_provider metadata: {result.failover}")
    if len(calls) != 1:
        fail(f"Expected one HTTP call, got {len(calls)}")
    if health_scope_calls != [expected_health_scope]:
        fail(f"Unexpected health scope: {health_scope_calls} != {[expected_health_scope]}")
    call = calls[0]
    if call["url"] != expected_url:
        fail(f"Unexpected URL: {call['url']} != {expected_url}")
    payload = call.get("json") or {}
    if payload.get("model") != expected_model:
        fail(f"Unexpected model: {payload.get('model')} != {expected_model}")
    headers = call.get("headers") or {}
    if headers.get("Authorization") != expected_auth:
        fail(f"Unexpected Authorization header: {headers.get('Authorization')} != {expected_auth}")


async def main() -> int:
    root = deploy_root()
    os.chdir(root)
    sys.path.insert(0, str(root))

    from services import api_provider_registry as registry  # noqa: PLC0415
    from services import ai_proxy_chat_service as chat_service  # noqa: PLC0415
    from services import ai_proxy_http_client as http_client  # noqa: PLC0415
    from services import ai_proxy_service as proxy  # noqa: PLC0415

    if proxy.provider_health_scope_for_failover("gemini-text") != ["gemini-text", "deepseek"]:
        fail(f"Gemini text failover health scope changed: {proxy.provider_health_scope_for_failover('gemini-text')}")
    if proxy.provider_health_scope_for_failover("deepseek") != ["deepseek"]:
        fail(f"DeepSeek health scope should not include unrelated providers: {proxy.provider_health_scope_for_failover('deepseek')}")

    managed_env = set()
    for env_key in registry.PROVIDER_ENV_MAP.values():
        managed_env.add(env_key)
        managed_env.add(registry.get_endpoint_env_key(env_key))
        managed_env.add(registry.get_proxy_mode_env_key(env_key))
        managed_env.add(registry.get_custom_proxy_env_key(env_key))
        managed_env.add(registry.get_model_env_key(env_key))

    with EnvGuard(managed_env):
        await run_case(
            proxy,
            chat_service,
            http_client,
            env={"DEEPSEEK_API_KEY": "deepseek-key"},
            health_rows=[
                {"provider": "gemini-text", "status": "error"},
                {"provider": "deepseek", "status": "ok"},
            ],
            expected_health_scope=["gemini-text", "deepseek"],
            expected_url="https://api.deepseek.com/chat/completions",
            expected_provider="deepseek",
            expected_model="deepseek-v4-pro",
            expected_auth="Bearer deepseek-key",
            expected_failover_active=True,
        )

    with EnvGuard(managed_env):
        await run_case(
            proxy,
            chat_service,
            http_client,
            env={
                "GEMINI_TEXT_API_KEY": "gemini-key",
                "DEEPSEEK_API_KEY": "deepseek-key",
            },
            health_rows=[
                {"provider": "gemini-text", "status": "ok"},
                {"provider": "deepseek", "status": "ok"},
            ],
            expected_health_scope=["gemini-text", "deepseek"],
            expected_url="https://api.laozhang.ai/v1/chat/completions",
            expected_provider="gemini-text",
            expected_model="gemini-2.5-flash",
            expected_auth="Bearer gemini-key",
            expected_failover_active=False,
        )

    with EnvGuard(managed_env):
        await run_case(
            proxy,
            chat_service,
            http_client,
            env={
                "GEMINI_TEXT_API_KEY": "gemini-key",
                "DEEPSEEK_API_KEY": "deepseek-key",
            },
            health_rows=[
                {"provider": "gemini-text", "status": "ok"},
                {"provider": "gemini-text", "model_name": "gemini-2.5-flash", "status": "error"},
                {"provider": "deepseek", "status": "ok"},
            ],
            expected_health_scope=["gemini-text", "deepseek"],
            expected_url="https://api.deepseek.com/chat/completions",
            expected_provider="deepseek",
            expected_model="deepseek-v4-pro",
            expected_auth="Bearer deepseek-key",
            expected_failover_active=True,
        )

    print("AI proxy failover contract OK")
    print("  failover_health_scope_from_registry=1")
    print("  gemini_text_failover_to_deepseek=1")
    print("  gemini_text_primary_stays_when_healthy=1")
    print("  gemini_text_model_health_failover=1")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
