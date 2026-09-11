"""Prompt template business logic."""
from __future__ import annotations

from typing import Any, Dict

from dao_content import PromptTemplateDAO


DEFAULT_PROMPTS: Dict[str, str] = {
    "rewrite": """你是一位专业的中文动画编剧。请将以下小说/文本内容改写成符合行业标准的动画剧本格式。
要求：
1. 准确识别场景、角色、对白和动作。
2. 使用标准剧本格式，场景标题清晰，角色名和对白易于后续分镜处理。
3. 增加适合动画制作的视觉描述和画面感。
4. 保持原著语气和情节，但适配视听语言。
5. 必须使用中文输出剧本内容。

输入文本：
{text}""",
    "storyboard": """请分析以下中文动画剧本，将其拆解为一系列关键镜头，并返回 JSON。
JSON 结构必须为：{"items": [ ... ]}
每个 item 需要包含以下字段：
- originalText: 对应的原文段落，从剧本中直接复制，用于高亮匹配。
- scriptSegment: 提炼后的场景描述，用于说明镜头内容。
- imagePrompt: 图像生成提示词，英文，适合图像模型。
- videoPrompt: 视频生成提示词，中文，描述镜头运动和画面。
- dialogue: 人物台词，如果没有则为空字符串。
- characters: 出现的角色列表，数组。
- scene: 场景位置，字符串。

重要：originalText 必须是剧本中的原始文本段落，scriptSegment 是你提炼后的场景描述。

剧本：
{scriptText}""",
}


async def get_prompt_template(
    username: str,
    template_type: str,
    *,
    prompt_template_dao: Any = PromptTemplateDAO,
) -> Dict[str, Any]:
    """Load a user's prompt template, falling back to bundled defaults."""
    custom_content = await prompt_template_dao.load_template(username, template_type)
    if custom_content:
        return {
            "success": True,
            "template_type": template_type,
            "content": custom_content,
            "is_custom": True,
        }

    return {
        "success": True,
        "template_type": template_type,
        "content": DEFAULT_PROMPTS.get(template_type, ""),
        "is_custom": False,
    }


async def save_prompt_template(
    username: str,
    template_type: str,
    content: str,
    *,
    prompt_template_dao: Any = PromptTemplateDAO,
) -> Dict[str, Any]:
    """Save a user's custom prompt template."""
    await prompt_template_dao.save_template(username, template_type, content)
    return {
        "success": True,
        "message": "提示词模板已保存",
        "template_type": template_type,
    }


async def delete_prompt_template(
    username: str,
    template_type: str,
    *,
    prompt_template_dao: Any = PromptTemplateDAO,
) -> Dict[str, Any]:
    """Remove a user's custom template so default content is used again."""
    existing_content = await prompt_template_dao.load_template(username, template_type)
    if existing_content:
        await prompt_template_dao.delete_template(username, template_type)
        return {
            "success": True,
            "message": "提示词模板已删除，已恢复为默认模板",
        }

    return {
        "success": True,
        "message": "提示词模板不存在，当前已是默认模板",
    }
