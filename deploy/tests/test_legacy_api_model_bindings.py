"""Legacy model IDs must survive normalization and DB-to-runtime projection."""
from __future__ import annotations

from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from services import api_provider_registry as registry


@pytest.mark.parametrize(
    ("provider", "model", "operation"),
    [
        ("seedance", "doubao-seedance-standard-runtime", "standard"),
        ("seedance", "doubao-seedance-fast-runtime", "fast"),
        ("seedance", "doubao-seedance-mini-runtime", "mini"),
        ("doubao", "custom-image-deployment", "generate"),
        ("dashscope", "wan2.6-runtime-i2v", "wan26"),
        ("dashscope", "custom/kling-v3-video-generation", "kling-standard"),
        ("dashscope", "custom/kling-v3-omni-video-generation", "kling-omni"),
        ("deepseek", "custom-text-deployment", "default"),
        ("gemini-image", "custom-image-deployment", "default"),
        ("minimax", "MiniMax-Hailuo-02", "default"),
    ],
)
def test_legacy_model_id_is_not_replaced_by_operation_default(provider, model, operation):
    options = registry.get_provider_model_binding_options(provider, include_scopes=True)
    bindings = registry.normalize_model_bindings(provider, [], f"  {model}  ")

    assert bindings[0]["scope"] == "workflow"
    assert bindings[0]["operation"] == operation
    assert bindings[0]["model_name"] == model
    assert registry.primary_model_name_for_bindings(bindings) == model
    assert len({(item["scope"], item["operation"]) for item in bindings}) == len(bindings)
    assert registry.normalize_model_bindings(provider, bindings)[0]["model_name"] == model
    assert registry.get_provider_model_binding_options(provider, include_scopes=True) == options


@pytest.mark.parametrize("raw_bindings", [None, "", "{", "{}", {}, [None, {}, {"model_name": " "}]])
def test_unusable_bindings_fall_back_to_the_stored_model_id(raw_bindings):
    bindings = registry.normalize_model_bindings("seedance", raw_bindings, "custom-fast-runtime")

    assert bindings[0]["operation"] == "fast"
    assert bindings[0]["model_name"] == "custom-fast-runtime"


@pytest.mark.parametrize(
    ("provider", "alias", "operation", "expected_model"),
    [
        ("seedance", "standard", "standard", registry.SEEDANCE_DEFAULT_MODEL_MAP["standard"]),
        ("seedance", "FAST", "fast", registry.SEEDANCE_DEFAULT_MODEL_MAP["fast"]),
        ("seedance", "mini", "mini", registry.SEEDANCE_DEFAULT_MODEL_MAP["mini"]),
        ("seedance", "agent_plan", "agent_plan", registry.SEEDANCE_AGENT_PLAN_MODEL_MAP["agent_plan"]),
        ("deepseek", "deepseek-reasoner", "deepseek-reasoner", "deepseek-v4-pro"),
        ("gemini-image", "gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"),
    ],
)
def test_legacy_operation_aliases_keep_their_supported_model_mapping(provider, alias, operation, expected_model):
    binding = registry.normalize_model_bindings(provider, [], alias)[0]

    assert binding["operation"] == operation
    assert binding["model_name"] == expected_model


def test_explicit_binding_keeps_precedence_and_public_metadata_over_legacy_model():
    raw = [{
        "scope": "workflow",
        "operation": "fast",
        "model_name": "custom-fast-explicit",
        "display_name": "Fast preview",
        "description": "Preview only",
        "published": False,
    }]
    original = deepcopy(raw)

    bindings = registry.normalize_model_bindings("seedance", raw, "ignored-fast-legacy")

    assert bindings[0]["model_name"] == "custom-fast-explicit"
    assert bindings[0]["display_name"] == "Fast preview"
    assert bindings[0]["description"] == "Preview only"
    assert bindings[0]["published"] is False
    assert raw == original


@pytest.mark.parametrize("scope", [None, "", "  "])
def test_unscoped_binding_keeps_the_same_model_in_workflow_and_studio(scope):
    raw = [{"scope": scope, "operation": "fast", "model_name": "custom-fast-runtime"}]
    bindings = registry.normalize_model_bindings("seedance", raw)

    assert {
        (item["scope"], item["model_name"])
        for item in bindings if item["operation"] == "fast"
    } == {("workflow", "custom-fast-runtime"), ("studio", "custom-fast-runtime")}


def test_explicit_scopes_can_keep_different_model_ids():
    raw = [
        {"scope": scope, "operation": "fast", "model_name": f"custom-fast-{scope}"}
        for scope in registry.MODEL_USAGE_SCOPES
    ]
    bindings = registry.normalize_model_bindings("seedance", raw)

    assert {
        (item["scope"], item["model_name"])
        for item in bindings if item["operation"] == "fast"
    } == {("workflow", "custom-fast-workflow"), ("studio", "custom-fast-studio")}


@pytest.mark.asyncio
@pytest.mark.parametrize("reverse_rows", [False, True])
@pytest.mark.parametrize("binding_format", ["legacy", "unscoped"])
async def test_legacy_cards_resolve_separate_models_and_restore_runtime_on_reload(monkeypatch, reverse_rows, binding_format):
    from services import api_config_runtime_loader as loader
    from services.api_provider_runtime import resolve_provider, resolve_seedance_model_name

    # Isolate all process overrides, including dynamically named operation keys.
    monkeypatch.setattr(loader.os, "environ", {})
    baseline = {key: None for key in loader.managed_api_env_keys()}
    baseline["SEEDANCE_API_KEY"] = "test-placeholder-baseline"
    monkeypatch.setattr(loader, "_BASE_API_ENV_VALUES", baseline)
    monkeypatch.setattr(loader, "_DYNAMIC_OPERATION_ENV_KEYS", set())
    rows = [
        {
            "provider": "seedance",
            "model_name": f"custom-{operation}-runtime",
            "api_key_encrypted": f"enc:test-placeholder-{operation}",
            "endpoint": f"https://{operation}.example.test/tasks",
        }
        for operation in ("standard", "fast", "mini")
    ]
    if binding_format == "unscoped":
        for row in rows:
            row["model_bindings"] = [{"model_name": row["model_name"]}]
    if reverse_rows:
        rows.reverse()
    fake_dao = type("FakeDAO", (), {
        "list_enabled": AsyncMock(return_value=rows),
        "decrypt_key": staticmethod(lambda value: value.removeprefix("enc:")),
    })
    monkeypatch.setattr(loader, "ApiConfigDAO", fake_dao)

    result = await loader.load_api_configs_to_env()

    assert result["success"] is True
    assert result["loaded"] == 3
    for operation in ("standard", "fast", "mini"):
        for scope in registry.MODEL_USAGE_SCOPES:
            model = resolve_seedance_model_name(operation, usage_scope=scope)
            assert model == f"custom-{operation}-runtime"
            resolved = resolve_provider("seedance", model, usage_scope=scope)
            assert resolved.model_name == model
            assert resolved.api_key == f"test-placeholder-{operation}"
            assert resolved.endpoint == f"https://{operation}.example.test/tasks"
    assert "SEEDANCE_AGENT_PLAN_API_KEY" not in loader.os.environ
    assert "SEEDANCE_MODEL_AGENT_PLAN" not in loader.os.environ

    before_failure = dict(loader.os.environ)
    fake_dao.list_enabled.side_effect = RuntimeError("test-only database failure")
    failed = await loader.load_api_configs_to_env()
    assert failed["success"] is False
    assert dict(loader.os.environ) == before_failure

    fake_dao.list_enabled.side_effect = None
    fake_dao.list_enabled.return_value = []
    empty = await loader.load_api_configs_to_env()
    assert empty["success"] is True
    assert empty["loaded"] == 0
    assert dict(loader.os.environ) == {"SEEDANCE_API_KEY": "test-placeholder-baseline"}
