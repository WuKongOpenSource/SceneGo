from types import SimpleNamespace

import pytest

from services import text_model_catalog_service


@pytest.mark.asyncio
async def test_catalog_returns_runtime_model_names_without_secret_metadata(monkeypatch):
    def fake_resolve_provider(provider, model=None, usage_scope="workflow"):
        assert usage_scope == "studio"
        runtime_models = {
            ("minimax", "minimax-m3"): "MiniMax-M3",
            ("deepseek", "deepseek-chat"): "deepseek-v4-flash",
            ("deepseek", "deepseek-reasoner"): "deepseek-v4-pro",
        }
        return SimpleNamespace(model_name=runtime_models[(provider, model)])

    async def fake_resolve_ai_proxy_provider(provider, model=None, usage_scope="workflow"):
        assert provider == "gemini-text"
        assert model is None
        assert usage_scope == "studio"
        return (
            SimpleNamespace(provider="deepseek", model_name="fallback-v4"),
            {"active": True},
        )

    monkeypatch.setattr(
        text_model_catalog_service,
        "resolve_ai_proxy_provider",
        fake_resolve_ai_proxy_provider,
    )
    monkeypatch.setattr(text_model_catalog_service, "resolve_provider", fake_resolve_provider)

    models = await text_model_catalog_service.build_text_model_catalog("studio")

    assert [item["value"] for item in models] == [
        "minimax-m3",
        "deepseek-chat",
        "deepseek",
        "gemini",
    ]
    assert [item["label"] for item in models] == [
        "MiniMax-M3 · 连续写作模型",
        "deepseek-v4-flash · 快速写作模型",
        "deepseek-v4-pro · 推理写作模型",
        "fallback-v4 · 全能写作模型",
    ]
    assert [item["hint"] for item in models] == [
        "适合持续",
        "速度优先",
        "推理优先",
        "综合全能",
    ]
    assert [item["billing_model"] for item in models] == [
        "script_tier_1",
        "script_tier_2",
        "script_tier_3",
        "script_tier_4",
    ]
    assert models[3]["failover_active"] is True
    assert {item["model_scope"] for item in models} == {"studio"}
    assert all("provider" not in item for item in models)
    assert all("requested_provider" not in item for item in models)
    assert all("runtime_model_name" not in item for item in models)
    assert all("operation" not in item for item in models)
    assert all("api_key" not in item and "endpoint" not in item for item in models)
