#!/usr/bin/env python3
"""Verify admin API config health-check service without real external calls."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Any


def deploy_root() -> Path:
    return Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


class FakeResponse:
    def __init__(self, status: int, body: str = ""):
        self.status = status
        self._body = body

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def text(self) -> str:
        return self._body


class FakeSession:
    def __init__(self, owner: "FakeSessionFactory"):
        self.owner = owner

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def get(self, url: str, *, headers=None, proxy=None, allow_redirects=True):
        self.owner.calls.append(
            {
                "url": url,
                "headers": dict(headers or {}),
                "proxy": proxy,
                "allow_redirects": allow_redirects,
            }
        )
        index = len(self.owner.calls) - 1
        status, body = self.owner.responses[index] if index < len(self.owner.responses) else (500, "missing fake response")
        return FakeResponse(status, body)


class FakeSessionFactory:
    def __init__(self, responses: list[tuple[int, str]]):
        self.responses = responses
        self.calls: list[dict[str, Any]] = []
        self.timeout = None

    def __call__(self, *, timeout=None):
        self.timeout = timeout
        return FakeSession(self)


async def main() -> int:
    root = deploy_root()
    os.chdir(root)
    sys.path.insert(0, str(root))

    from services.api_config_health_service import (  # noqa: PLC0415
        api_config_health_urls,
        check_provider_health,
        resolve_proxy_for_request,
        test_api_config_health,
    )
    import admin_api_config_routes  # noqa: PLC0415
    from services.api_config_service import summarize_config_test_results  # noqa: PLC0415
    from services.api_provider_endpoints import derive_models_health_urls  # noqa: PLC0415
    from services import api_provider_registry as registry  # noqa: PLC0415

    managed_keys: set[str] = set()
    for env_key in registry.PROVIDER_ENV_MAP.values():
        managed_keys.add(env_key)
        managed_keys.add(registry.get_endpoint_env_key(env_key))
        managed_keys.add(registry.get_proxy_mode_env_key(env_key))
        managed_keys.add(registry.get_custom_proxy_env_key(env_key))
        managed_keys.add(registry.get_model_env_key(env_key))
    saved_env = {key: os.environ.get(key) for key in managed_keys}
    for key in managed_keys:
        os.environ.pop(key, None)

    dashscope_row = {
        "provider": "dashscope",
        "model_name": "wan2.6-i2v",
        "endpoint": "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
        "proxy_mode": "direct",
        "custom_proxy": "",
    }
    urls = api_config_health_urls(dashscope_row)
    if urls != [
        "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
    ]:
        fail(f"Unexpected DashScope health URLs: {urls}")

    health_url_cases = [
        (
            "https://api.deepseek.com",
            "deepseek",
            ["https://api.deepseek.com/models", "https://api.deepseek.com"],
        ),
        (
            "https://api.laozhang.ai/v1/chat/completions",
            "gemini-text",
            ["https://api.laozhang.ai/v1/models", "https://api.laozhang.ai/v1/chat/completions"],
        ),
        (
            "https://ark.cn-beijing.volces.com/api/v3/images/generations",
            "doubao",
            [
                "https://ark.cn-beijing.volces.com/api/v3/models",
                "https://ark.cn-beijing.volces.com/api/v3/images/generations",
            ],
        ),
        (
            "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
            "seedance",
            [
                "https://ark.cn-beijing.volces.com/api/v3/models",
                "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
            ],
        ),
        (
            "https://self-hosted.example.test/openai/v1",
            "custom",
            ["https://self-hosted.example.test/openai/v1/models"],
        ),
    ]
    for endpoint, provider, expected in health_url_cases:
        got = derive_models_health_urls(endpoint, provider)
        if got != expected:
            fail(f"Unexpected health URLs for {provider}: {got} != {expected}")

    no_key = await test_api_config_health(dashscope_row, "")
    test = no_key.get("test") or {}
    if test.get("ok") is not False or test.get("error") != "No API key configured":
        fail(f"No-key health result changed: {test}")
    if test.get("status") != "no_key":
        fail(f"No-key health status changed: {test}")
    if test.get("urls_tried") != urls:
        fail("No-key health result did not report derived URLs")

    laozhang_row = {
        "provider": "laozhang-gpt-image",
        "model_name": "gpt-image-2-vip",
        "endpoint": "https://api.laozhang.ai/v1",
        "proxy_mode": "direct",
        "custom_proxy": "",
    }
    laozhang_factory = FakeSessionFactory([(200, '{"data": []}')])
    laozhang_health = await test_api_config_health(laozhang_row, "laozhang-secret", session_factory=laozhang_factory)
    laozhang_test = laozhang_health.get("test") or {}
    if laozhang_test.get("ok") is not False or laozhang_test.get("status") != "connectivity_ok":
        fail(f"Laozhang metadata-only health should not report ok: {laozhang_test}")
    if not laozhang_test.get("reachable") or not laozhang_test.get("auth_ok"):
        fail(f"Laozhang connectivity result lost reachability/auth: {laozhang_test}")

    doubao_row = {
        "provider": "doubao",
        "model_name": "doubao-seedream-5-0-pro-260628",
        "endpoint": "https://ark.cn-beijing.volces.com/api/v3/images/generations",
        "proxy_mode": "direct",
        "custom_proxy": "",
    }
    doubao_factory = FakeSessionFactory([(200, '{"data": []}')])
    doubao_health = await test_api_config_health(
        doubao_row,
        "doubao-secret",
        session_factory=doubao_factory,
    )
    doubao_test = doubao_health.get("test") or {}
    if doubao_test.get("ok") is not False or doubao_test.get("status") != "connectivity_ok":
        fail(f"Doubao metadata-only health should not report generation ok: {doubao_test}")
    if registry.get_provider_api_path("doubao", "image_generations") != "images/generations":
        fail("Doubao image generation operation path is missing")
    doubao_urls = registry.build_provider_operation_url_templates(
        "doubao",
        doubao_row["endpoint"],
    )
    if doubao_urls.get("image_generations") != doubao_row["endpoint"]:
        fail(f"Unexpected Doubao image generation URL: {doubao_urls}")

    batch_summary = summarize_config_test_results(
        [
            {"test": {"ok": True, "auth_ok": True}},
            {"test": {"ok": False, "auth_ok": False}},
            {"test": {"ok": False, "error": "No API key configured"}},
            {"test": {"ok": False, "auth_ok": True, "status": "connectivity_ok"}},
            {"test": {"ok": False, "auth_ok": True, "error": "HTTP 500"}},
        ]
    )
    if batch_summary != {"total": 5, "ok": 1, "no_key": 1, "auth_error": 1, "connectivity_ok": 1, "error": 1}:
        fail(f"Batch config test summary changed: {batch_summary}")

    provider_health = admin_api_config_routes._provider_health_from_real_generation_test(
        {
            "test": {
                "ok": True,
                "provider": "minimax",
                "model_name": "speech-2.8-hd",
                "status_code": 200,
                "reachable": True,
                "auth_ok": True,
                "latency_ms": 321,
                "checked_at": "2026-07-10T00:00:00Z",
                "method": "POST",
                "output_type": "audio",
                "billable": True,
            }
        }
    )
    if not provider_health or provider_health.get("status") != "ok":
        fail(f"Real generation result was not converted to ok provider health: {provider_health}")
    health_detail = provider_health.get("health") or {}
    if health_detail.get("real_generation") is not True or health_detail.get("output_type") != "audio":
        fail(f"Real generation provider health lost verification detail: {provider_health}")

    async def proxy_loader():
        return {"proxy_https": "http://proxy.example.test:7890"}

    proxy = await resolve_proxy_for_request("system", "", proxy_settings_loader=proxy_loader)
    if proxy != "http://proxy.example.test:7890":
        fail(f"System proxy resolution changed: {proxy}")

    deepseek_row = {
        "provider": "deepseek",
        "model_name": "deepseek-reasoner",
        "endpoint": "https://first.example.test/v1",
        "proxy_mode": "custom",
        "custom_proxy": "http://custom-proxy.example.test:8080",
        "headers": {"X-Test": "yes"},
    }
    factory = FakeSessionFactory([(401, "bad token"), (200, '{"data": []}')])
    result = await test_api_config_health(deepseek_row, "secret-key", session_factory=factory)
    test = result.get("test") or {}
    if test.get("ok") is not False or test.get("status_code") != 401:
        fail(f"Configured endpoint auth failure should not fall back to provider default: {test}")
    if len(factory.calls) != 1:
        fail(f"Expected only the configured endpoint health call, got {len(factory.calls)}")
    first_call = factory.calls[0]
    if first_call["headers"].get("Authorization") != "Bearer secret-key":
        fail("Health check did not add bearer Authorization header")
    if first_call["headers"].get("X-Test") != "yes":
        fail("Health check did not preserve custom headers")
    if first_call["proxy"] != "http://custom-proxy.example.test:8080":
        fail(f"Health check did not use custom proxy: {first_call['proxy']}")

    try:
        runtime_no_key = await check_provider_health("deepseek", session_factory=FakeSessionFactory([(200, "{}")]))
        if runtime_no_key.get("status") != "no_key" or runtime_no_key.get("latency_ms") is not None:
            fail(f"Provider runtime no-key status changed: {runtime_no_key}")

        os.environ["DEEPSEEK_API_KEY"] = "runtime-secret"
        os.environ["DEEPSEEK_ENDPOINT"] = "https://runtime.deepseek.example.test"
        runtime_factory = FakeSessionFactory([(200, '{"data": []}')])
        runtime_ok = await check_provider_health("deepseek", session_factory=runtime_factory)
        if runtime_ok.get("status") != "ok" or not isinstance(runtime_ok.get("latency_ms"), int):
            fail(f"Provider runtime health did not succeed: {runtime_ok}")
        if runtime_factory.calls[0]["url"] != "https://runtime.deepseek.example.test/models":
            fail(f"Provider runtime health did not use runtime endpoint: {runtime_factory.calls[0]}")
        if runtime_factory.calls[0]["headers"].get("Authorization") != "Bearer runtime-secret":
            fail("Provider runtime health did not use runtime API key")

        runtime_model_factory = FakeSessionFactory([(200, '{"data": []}')])
        runtime_model_ok = await check_provider_health(
            "deepseek",
            model_name="deepseek-chat",
            session_factory=runtime_model_factory,
        )
        if runtime_model_ok.get("model_name") != "deepseek-v4-flash":
            fail(f"Provider runtime health did not normalize legacy model_name override: {runtime_model_ok}")

        os.environ["ARK_API_KEY"] = "runtime-doubao-secret"
        os.environ["ARK_ENDPOINT"] = "https://runtime.doubao.example.test/api/v3/images/generations"
        os.environ["ARK_MODEL"] = "doubao-seedream-5-0-pro-260628"
        runtime_doubao_factory = FakeSessionFactory([(200, '{"data": []}')])
        runtime_doubao = await check_provider_health(
            "doubao",
            session_factory=runtime_doubao_factory,
        )
        if runtime_doubao.get("status") != "connectivity_ok":
            fail(f"Doubao runtime metadata health should be connectivity_ok: {runtime_doubao}")
        if runtime_doubao.get("model_name") != "doubao-seedream-5-0-pro-260628":
            fail(f"Doubao provider-level health ignored runtime model: {runtime_doubao}")

        os.environ["GPT_IMAGE_API_KEY"] = "runtime-laozhang-secret"
        os.environ["GPT_IMAGE_ENDPOINT"] = "https://runtime.laozhang.example.test/v1"
        runtime_laozhang_factory = FakeSessionFactory([(200, '{"data": []}')])
        runtime_laozhang = await check_provider_health(
            "laozhang-gpt-image",
            session_factory=runtime_laozhang_factory,
        )
        if runtime_laozhang.get("status") != "connectivity_ok":
            fail(f"Laozhang runtime health should be connectivity_ok: {runtime_laozhang}")
    finally:
        for key, value in saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    print("Admin API config health contract OK")
    print(f"  dashscope_health_urls={len(urls)}")
    print(f"  derived_health_url_cases={len(health_url_cases)}")
    print("  no_key_result_ok=1")
    print("  batch_summary_ok=1")
    print("  real_generation_provider_health=1")
    print("  doubao_connectivity_only=1")
    print("  doubao_operation_paths=1")
    print("  doubao_runtime_model=1")
    print(f"  fake_http_calls={len(factory.calls)}")
    print("  laozhang_connectivity_only=2")
    print("  provider_runtime_health=3")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
