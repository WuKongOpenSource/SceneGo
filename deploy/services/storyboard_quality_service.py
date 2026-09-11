"""Visual acceptance review for generated storyboard images."""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Awaitable, Callable, Dict, List, Optional

from services.ai_proxy_gemini_text_service import generate_gemini_chat_result
from utils.image_reference import to_doubao_image_input

logger = logging.getLogger(__name__)

GenerationCallable = Callable[..., Awaitable[Any]]


def _clamp_score(value: Any, default: int = 0) -> int:
    try:
        return max(0, min(100, int(round(float(value)))))
    except (TypeError, ValueError):
        return default


def _extract_json(content: str) -> Dict[str, Any]:
    text = (content or "").strip()
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if fenced:
        text = fenced.group(1).strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("视觉验收模型没有返回有效 JSON")
        parsed = json.loads(text[start:end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("视觉验收结果不是 JSON 对象")
    return parsed


def _character_prompt(characters: List[Dict[str, Any]]) -> str:
    blocks = []
    for character in characters:
        anchor = character.get("anchor") if isinstance(character.get("anchor"), dict) else {}
        details = [
            character.get("description"),
            f"年龄感：{anchor.get('age')}" if anchor.get("age") else "",
            f"脸型五官：{anchor.get('face')}" if anchor.get("face") else "",
            f"发型发色：{anchor.get('hair')}" if anchor.get("hair") else "",
            f"固定服装：{anchor.get('outfit')}" if anchor.get("outfit") else "",
            f"识别特征：{anchor.get('distinguishing_features') or anchor.get('distinguishingFeatures')}"
            if anchor.get("distinguishing_features") or anchor.get("distinguishingFeatures") else "",
            f"禁止变化：{anchor.get('forbidden_changes') or anchor.get('forbiddenChanges')}"
            if anchor.get("forbidden_changes") or anchor.get("forbiddenChanges") else "",
        ]
        blocks.append(f"- {character.get('name') or '未命名角色'}：" + "；".join(str(item) for item in details if item))
    return "\n".join(blocks) or "- 本镜头没有指定角色"


def _normalize_result(raw: Dict[str, Any], characters: List[Dict[str, Any]]) -> Dict[str, Any]:
    raw_characters = raw.get("characters") if isinstance(raw.get("characters"), list) else []
    character_scores = []
    for index, character in enumerate(characters):
        matching = next(
            (item for item in raw_characters if isinstance(item, dict) and item.get("name") == character.get("name")),
            raw_characters[index] if index < len(raw_characters) and isinstance(raw_characters[index], dict) else {},
        )
        character_scores.append({
            "name": character.get("name") or f"角色{index + 1}",
            "score": _clamp_score(matching.get("score")),
            "issues": [str(item) for item in matching.get("issues", []) if str(item).strip()]
            if isinstance(matching.get("issues"), list) else [],
        })

    character_score = min((item["score"] for item in character_scores), default=100)
    script_score = _clamp_score(raw.get("script_compliance_score"), 0)
    visual_score = _clamp_score(raw.get("visual_quality_score"), 0)
    passed = character_score >= 80 and script_score >= 75 and visual_score >= 65
    issues = [str(item) for item in raw.get("issues", []) if str(item).strip()] if isinstance(raw.get("issues"), list) else []
    retry_prompt = str(raw.get("retry_prompt") or "").strip()
    if not passed and not retry_prompt:
        retry_prompt = "；".join(issues[:4]) or "严格匹配角色参考图，并准确执行脚本中的人物、动作、场景和构图。"

    return {
        "status": "passed" if passed else "failed",
        "character_consistency_score": character_score,
        "script_compliance_score": script_score,
        "visual_quality_score": visual_score,
        "characters": character_scores,
        "issues": issues,
        "retry_prompt": retry_prompt,
    }


async def review_storyboard_image(
    *,
    image_url: str,
    prompt: str,
    script_segment: str,
    characters: List[Dict[str, Any]],
    scene: str = "",
    reference_images: Optional[List[Dict[str, Any]]] = None,
    generation_callable: Optional[GenerationCallable] = None,
) -> Dict[str, Any]:
    """Review a candidate image without turning audit outages into generation failures."""
    try:
        candidate = to_doubao_image_input(image_url)
        if not candidate:
            raise ValueError("候选分镜图无法读取")

        content: List[Dict[str, Any]] = [{
            "type": "text",
            "text": (
                "你是严格的影视分镜视觉验收员。第一张图是待验收分镜，后续图片是角色固定参考图。\n"
                "重点检查：同名角色是否保持脸型、五官、年龄、发型、服装和识别特征；人物、场景、动作与脚本是否相符；画面是否存在多余人物、身份混合、肢体错误或明显质量问题。\n\n"
                f"生成提示词：{prompt}\n"
                f"脚本片段：{script_segment}\n"
                f"场景：{scene}\n"
                f"角色身份锚点：\n{_character_prompt(characters)}\n\n"
                "只输出 JSON，不要 Markdown。格式："
                '{"characters":[{"name":"角色名","score":0,"issues":["问题"]}],'
                '"script_compliance_score":0,"visual_quality_score":0,"issues":["总体问题"],'
                '"retry_prompt":"供下一次生成直接使用的具体修正指令"}'
            ),
        }]
        content.append({"type": "text", "text": "待验收分镜："})
        content.append({"type": "image_url", "image_url": {"url": candidate}})

        for reference in (reference_images or [])[:4]:
            converted = to_doubao_image_input(str(reference.get("url") or ""))
            if not converted:
                continue
            content.append({"type": "text", "text": f"角色参考图：{reference.get('name') or '未命名角色'}"})
            content.append({"type": "image_url", "image_url": {"url": converted}})

        generator = generation_callable or generate_gemini_chat_result
        result = await generator(
            messages=[{"role": "user", "content": content}],
            temperature=0.1,
            allow_failover=True,
            label="Storyboard visual acceptance",
        )
        raw = _extract_json(result.content if hasattr(result, "content") else str(result))
        return _normalize_result(raw, characters)
    except Exception as exc:
        logger.warning("Storyboard quality review unavailable: %s", exc)
        return {
            "status": "unverified",
            "character_consistency_score": 0,
            "script_compliance_score": 0,
            "visual_quality_score": 0,
            "characters": [],
            "issues": [f"自动验收暂不可用：{exc}"],
            "retry_prompt": "",
        }
