import pytest
from fastapi import HTTPException

from services.model_access_service import (
    LEGACY_DEFAULT_ALLOWED_MODELS,
    normalize_model_access_permissions,
    require_user_model_access,
    validate_model_access_permissions,
)


class FakeUserDAO:
    permissions = None

    @classmethod
    async def get_user_permissions(cls, _user_id):
        return cls.permissions


def test_empty_legacy_permissions_inherit_platform_models():
    assert normalize_model_access_permissions({"allowedModels": []})["accessMode"] == "inherit"
    assert normalize_model_access_permissions(None)["accessMode"] == "inherit"


def test_nonempty_legacy_permissions_keep_restricted_semantics():
    normalized = normalize_model_access_permissions({"allowedModels": ["gemini-2.5-flash"]})
    assert normalized["accessMode"] == "restricted"
    assert normalized["allowedModels"] == ["gemini-2.5-flash"]


def test_historical_platform_default_allowlist_inherits_new_models():
    normalized = normalize_model_access_permissions(
        {"allowedModels": list(LEGACY_DEFAULT_ALLOWED_MODELS)}
    )
    assert normalized["accessMode"] == "inherit"


def test_explicit_restricted_mode_preserves_historical_allowlist_as_restriction():
    normalized = normalize_model_access_permissions(
        {
            "accessMode": "restricted",
            "allowedModels": list(LEGACY_DEFAULT_ALLOWED_MODELS),
        }
    )
    assert normalized["accessMode"] == "restricted"


def test_restricted_policy_requires_at_least_one_model():
    with pytest.raises(ValueError, match="至少需要选择一个模型"):
        validate_model_access_permissions({"accessMode": "restricted", "allowedModels": []})


@pytest.mark.asyncio
async def test_inherit_allows_generation_and_blocked_denies_it():
    FakeUserDAO.permissions = {"accessMode": "inherit"}
    assert (await require_user_model_access("user_1", user_dao=FakeUserDAO, model="gemini"))["accessMode"] == "inherit"

    FakeUserDAO.permissions = {"accessMode": "blocked"}
    with pytest.raises(HTTPException) as exc:
        await require_user_model_access("user_1", user_dao=FakeUserDAO, model="gemini")
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_restricted_policy_matches_runtime_model_or_task_alias():
    FakeUserDAO.permissions = {"accessMode": "restricted", "allowedModels": ["gemini-2.5-flash"]}
    await require_user_model_access(
        "user_1",
        user_dao=FakeUserDAO,
        task_type="gemini_text",
        task_data={"model": "gemini-2.5-flash"},
    )
    with pytest.raises(HTTPException, match="无权使用当前模型"):
        await require_user_model_access(
            "user_1",
            user_dao=FakeUserDAO,
            task_type="minimax_video",
            task_data={"model": "MiniMax-H3"},
        )


@pytest.mark.asyncio
async def test_historical_platform_defaults_allow_doubao_image_generation():
    FakeUserDAO.permissions = {
        "allowedModels": list(LEGACY_DEFAULT_ALLOWED_MODELS),
    }

    permissions = await require_user_model_access(
        "user_1",
        user_dao=FakeUserDAO,
        task_type="doubao_image",
        task_data={"model": "doubao-seedream-5-0-lite-260128", "provider": "doubao"},
    )

    assert permissions["accessMode"] == "inherit"


@pytest.mark.asyncio
async def test_image_upscale_is_a_credit_feature_available_to_restricted_accounts():
    FakeUserDAO.permissions = {
        "accessMode": "restricted",
        "allowedModels": ["gemini-2.5-flash"],
    }

    permissions = await require_user_model_access(
        "user_1",
        user_dao=FakeUserDAO,
        task_type="image_upscale",
        task_data={"requested_workflow_type": "image_upscale"},
    )

    assert permissions["accessMode"] == "restricted"


@pytest.mark.asyncio
async def test_image_upscale_stays_blocked_for_suspended_accounts():
    FakeUserDAO.permissions = {"accessMode": "blocked"}

    with pytest.raises(HTTPException, match="禁止使用生成模型"):
        await require_user_model_access(
            "user_1",
            user_dao=FakeUserDAO,
            task_type="image_upscale",
            task_data={"requested_workflow_type": "image_upscale"},
        )
