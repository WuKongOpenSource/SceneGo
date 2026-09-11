import pytest

from services import public_video_capability_service


@pytest.mark.asyncio
async def test_public_manifest_exposes_online_models_and_no_local_routing(monkeypatch) -> None:
    async def no_catalog(_scope: str):
        return None

    async def no_health():
        return []

    monkeypatch.setattr(public_video_capability_service, "load_public_video_catalog", no_catalog)
    monkeypatch.setattr(public_video_capability_service, "list_cached_provider_health", no_health)
    monkeypatch.setattr(
        public_video_capability_service,
        "resolve_seedance_model_name",
        lambda operation, usage_scope: f"seedance-{operation}",
    )
    monkeypatch.setattr(
        public_video_capability_service,
        "_provider_runtime_state",
        lambda provider, model, provider_health, usage_scope: (
            False,
            str(model or f"{provider}-model"),
            "后台未配置该平台的 API 密钥",
        ),
    )
    monkeypatch.setattr(
        public_video_capability_service,
        "_dashscope_options",
        lambda sub_models, usage_scope: list(sub_models),
    )

    manifest = await public_video_capability_service.get_public_video_capabilities()

    keys = {model["key"] for model in manifest["models"]}
    assert keys == {
        "Seedance15",
        "Seedance2",
        "Seedance2Fast",
        "Seedance2Mini",
        "MINI",
        "Veo",
        "Sora2",
        "大能",
        "Kling",
        "Vidu",
        "HappyHorse",
    }
    assert manifest["comfyui_available"] is False
    assert all(model["available"] is False for model in manifest["models"])
    assert all(model["unavailable_reason"] for model in manifest["models"])
    assert all("preferred_agent_id" not in model for model in manifest["models"])
    assert all("preferred_node_id" not in model for model in manifest["models"])
