
from unittest.mock import AsyncMock, patch

import pytest


class _FakeRequest:
    headers = {}
    client = None


async def test_import_presets_passes_category_for_video_preset():

    import admin_api_config_routes
    from services import api_config_import_service


    fake_db = object()
    with patch.object(admin_api_config_routes, "get_db_manager", lambda: fake_db), \
         patch.object(admin_api_config_routes, "_record_api_config_audit", AsyncMock()), \
         patch.object(api_config_import_service, "reload_api_env_after_config_change", AsyncMock(return_value=True)), \
         patch.object(api_config_import_service.ApiConfigDAO, "list_all", AsyncMock(return_value=[])), \
         patch.object(api_config_import_service.ApiConfigDAO, "create", AsyncMock(return_value={"config_id": "x"})) as mock_create:

        result = await admin_api_config_routes.admin_import_preset_configs(_FakeRequest())

    assert result["success"] is True

    calls_with_video_category = [
        c for c in mock_create.await_args_list
        if c.kwargs.get("category") == "video"
    ]
    assert len(calls_with_video_category) >= 1, (
        f"应至少有一个 video preset (飞升/渡劫/Wan2.6/...) 把 category='video' 传给 DAO.create。"
        f" 实际 calls: {[c.kwargs for c in mock_create.await_args_list]}"
    )


async def test_import_presets_keeps_minimax_speech_bindings():

    import admin_api_config_routes
    from services import api_config_import_service

    fake_db = object()
    with patch.object(admin_api_config_routes, "get_db_manager", lambda: fake_db), \
         patch.object(admin_api_config_routes, "_record_api_config_audit", AsyncMock()), \
         patch.object(api_config_import_service, "reload_api_env_after_config_change", AsyncMock(return_value=True)), \
         patch.object(api_config_import_service.ApiConfigDAO, "list_all", AsyncMock(return_value=[])), \
         patch.object(api_config_import_service.ApiConfigDAO, "create", AsyncMock(return_value={"config_id": "x"})) as mock_create:
        await admin_api_config_routes.admin_import_preset_configs(_FakeRequest())

    minimax_call = next(
        c for c in mock_create.await_args_list
        if c.kwargs.get("provider") == "minimax"
    )
    operations = {
        item["operation"] for item in minimax_call.kwargs["model_bindings"]
    }
    assert {"speech-hd", "speech-turbo"}.issubset(operations)


async def test_create_api_config_body_accepts_category():

    import admin_api_config_routes
    body = admin_api_config_routes.ApiConfigCreateBody(
        name="t", provider="seedance", endpoint="https://x", api_key="k",
        category="video",
    )
    assert body.category == "video"


async def test_create_api_config_body_defaults_category_empty():
    import admin_api_config_routes
    body = admin_api_config_routes.ApiConfigCreateBody(
        name="t", provider="x", endpoint="y", api_key="k",
    )
    assert body.category == ""


async def test_create_api_config_body_accepts_template_and_headers():
    """ApiConfigCreateBody must accept advanced request_template/headers fields."""
    import admin_api_config_routes
    body = admin_api_config_routes.ApiConfigCreateBody(
        name="minimax",
        provider="minimax",
        endpoint="https://api.minimaxi.com/v1",
        api_key="k",
        request_template={"group_id": "g"},
        headers={"X-Test": "yes"},
    )
    assert body.request_template == {"group_id": "g"}
    assert body.headers == {"X-Test": "yes"}


async def test_create_api_config_body_accepts_multiple_model_bindings():
    import admin_api_config_routes

    body = admin_api_config_routes.ApiConfigCreateBody(
        name="Seedance API",
        provider="seedance",
        endpoint="https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
        api_key="k",
        model_bindings=[
            {"operation": "standard", "label": "飞升", "model_name": "seedance-standard"},
            {"operation": "fast", "label": "渡劫", "model_name": "seedance-fast"},
        ],
    )

    assert [item["operation"] for item in body.model_bindings] == ["standard", "fast"]


def test_api_config_audit_update_details_redacts_sensitive_values():
    import admin_api_config_routes

    details = admin_api_config_routes._audit_update_details(
        {
            "api_key": "sk-real-secret",
            "custom_proxy": "http://user:pass@example.test:7890",
            "headers": {"Authorization": "Bearer header-secret"},
            "request_template": {"group_id": "group-1", "secret": "template-secret"},
            "endpoint": "https://provider.example.test/v1",
            "enabled": False,
        }
    )
    rendered = repr(details)

    assert details["changes"]["api_key_changed"] is True
    assert details["changes"]["custom_proxy_changed"] is True
    assert details["changes"]["headers"] == {"changed": True, "fields": ["Authorization"]}
    assert details["changes"]["request_template"] == {
        "changed": True,
        "fields": ["group_id", "secret"],
    }
    assert details["changes"]["enabled"] is False
    assert "sk-real-secret" not in rendered
    assert "user:pass" not in rendered
    assert "header-secret" not in rendered
    assert "template-secret" not in rendered


def test_api_config_audit_result_summary_masks_key_storage():
    import admin_api_config_routes

    summary = admin_api_config_routes._audit_result_summary(
        {
            "success": True,
            "env_refreshed": True,
            "api_config": {
                "config_id": "apicfg_1",
                "provider": "deepseek",
                "model_name": "deepseek-chat",
                "endpoint": "https://provider.example.test",
                "api_key_encrypted": "***",
            },
        }
    )

    assert summary["api_config"]["has_key"] is True
    assert "api_key_encrypted" not in summary["api_config"]
