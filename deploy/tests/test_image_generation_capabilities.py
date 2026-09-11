from types import SimpleNamespace

from services import image_generation_capability_service as capabilities
from services.api_provider_registry import DOUBAO_IMAGE_DEFAULT_MODEL
from services.seedance_image_provenance import SEEDREAM_PRO_MODEL


def _config(model, *, key="key", endpoint="https://ark.cn-beijing.volces.com/api/v3/images/generations"):
    return SimpleNamespace(api_key=key, endpoint=endpoint, model_name=model, extra={})


def test_unconfigured_pro_and_gpt_tiers_are_reported_before_submission(monkeypatch):
    def resolve(_provider, model, **_kwargs):
        return _config(DOUBAO_IMAGE_DEFAULT_MODEL if model == SEEDREAM_PRO_MODEL else model)

    monkeypatch.setattr(capabilities, "resolve_provider", resolve)
    monkeypatch.setattr(capabilities, "gpt_image_tier_capability", lambda tier: {
        "available": False,
        "reason": f"{tier} disabled",
    })
    monkeypatch.setattr(capabilities, "validate_portrait_generation", lambda *_args, **_kwargs: "")

    result = capabilities.build_image_generation_capabilities()

    assert result["models"]["doubao"]["available"] is True
    assert result["models"]["doubao_pro"]["available"] is False
    assert result["models"]["gpt_image_vip"] == {"available": False, "reason": "vip disabled"}
    assert result["models"]["gpt_image_official"] == {"available": False, "reason": "official disabled"}


def test_portrait_preflight_reason_is_returned_without_provider_generation(monkeypatch):
    monkeypatch.setattr(capabilities, "resolve_provider", lambda *_args, **_kwargs: _config(DOUBAO_IMAGE_DEFAULT_MODEL))
    monkeypatch.setattr(capabilities, "gpt_image_tier_capability", lambda _tier: {"available": True, "reason": ""})

    def reject(*_args, **_kwargs):
        from services.seedance_image_provenance import SeedanceInputProvenanceError
        raise SeedanceInputProvenanceError("账号绑定标识不一致")

    monkeypatch.setattr(capabilities, "validate_portrait_generation", reject)
    result = capabilities.build_image_generation_capabilities()
    assert result["seedance_portrait"] == {"available": False, "reason": "账号绑定标识不一致"}
