from __future__ import annotations

from services.prompt_service import (
    DEFAULT_PROMPTS,
    delete_prompt_template,
    get_prompt_template,
    save_prompt_template,
)


class FakePromptTemplateDAO:
    values: dict[tuple[str, str], str] = {}
    deleted: list[tuple[str, str]] = []

    @classmethod
    async def load_template(cls, username: str, template_type: str):
        return cls.values.get((username, template_type))

    @classmethod
    async def save_template(cls, username: str, template_type: str, content: str):
        cls.values[(username, template_type)] = content

    @classmethod
    async def delete_template(cls, username: str, template_type: str):
        cls.deleted.append((username, template_type))
        cls.values.pop((username, template_type), None)


def setup_function():
    FakePromptTemplateDAO.values = {}
    FakePromptTemplateDAO.deleted = []


async def test_get_prompt_template_returns_default_when_custom_missing():
    result = await get_prompt_template(
        "user_1",
        "rewrite",
        prompt_template_dao=FakePromptTemplateDAO,
    )

    assert result["success"] is True
    assert result["is_custom"] is False
    assert result["content"] == DEFAULT_PROMPTS["rewrite"]
    assert "{text}" in result["content"]


async def test_get_prompt_template_returns_custom_content():
    FakePromptTemplateDAO.values[("user_1", "rewrite")] = "custom prompt"

    result = await get_prompt_template(
        "user_1",
        "rewrite",
        prompt_template_dao=FakePromptTemplateDAO,
    )

    assert result["is_custom"] is True
    assert result["content"] == "custom prompt"


async def test_save_prompt_template_persists_content():
    result = await save_prompt_template(
        "user_1",
        "storyboard",
        "custom storyboard",
        prompt_template_dao=FakePromptTemplateDAO,
    )

    assert result == {
        "success": True,
        "message": "提示词模板已保存",
        "template_type": "storyboard",
    }
    assert FakePromptTemplateDAO.values[("user_1", "storyboard")] == "custom storyboard"


async def test_delete_prompt_template_deletes_existing_custom_content():
    FakePromptTemplateDAO.values[("user_1", "rewrite")] = "custom prompt"

    result = await delete_prompt_template(
        "user_1",
        "rewrite",
        prompt_template_dao=FakePromptTemplateDAO,
    )

    assert result == {
        "success": True,
        "message": "提示词模板已删除，已恢复为默认模板",
    }
    assert FakePromptTemplateDAO.deleted == [("user_1", "rewrite")]


async def test_delete_prompt_template_is_idempotent_when_custom_missing():
    result = await delete_prompt_template(
        "user_1",
        "rewrite",
        prompt_template_dao=FakePromptTemplateDAO,
    )

    assert result == {
        "success": True,
        "message": "提示词模板不存在，当前已是默认模板",
    }
    assert FakePromptTemplateDAO.deleted == []
