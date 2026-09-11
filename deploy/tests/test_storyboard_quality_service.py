from types import SimpleNamespace

import pytest

from services.storyboard_quality_service import review_storyboard_image


DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"


@pytest.mark.asyncio
async def test_review_storyboard_image_passes_strict_thresholds():
    async def generate(**kwargs):
        content = kwargs["messages"][0]["content"]
        assert any(item.get("type") == "image_url" for item in content)
        return SimpleNamespace(content='''{
          "characters": [{"name": "女1", "score": 91, "issues": []}],
          "script_compliance_score": 86,
          "visual_quality_score": 82,
          "issues": [],
          "retry_prompt": ""
        }''')

    result = await review_storyboard_image(
        image_url=DATA_URL,
        prompt="女1坐在沙发上",
        script_segment="女1翻阅文件",
        scene="客厅",
        characters=[{"name": "女1", "description": "黑色齐肩发"}],
        reference_images=[{"name": "女1", "url": DATA_URL}],
        generation_callable=generate,
    )

    assert result["status"] == "passed"
    assert result["character_consistency_score"] == 91
    assert result["script_compliance_score"] == 86


@pytest.mark.asyncio
async def test_review_storyboard_image_returns_retry_feedback_when_failed():
    async def generate(**_kwargs):
        return SimpleNamespace(content='''```json
        {
          "characters": [{"name": "女1", "score": 52, "issues": ["发型不一致"]}],
          "script_compliance_score": 80,
          "visual_quality_score": 70,
          "issues": ["人物身份漂移"],
          "retry_prompt": "严格匹配女1参考图的短发与脸型"
        }
        ```''')

    result = await review_storyboard_image(
        image_url=DATA_URL,
        prompt="prompt",
        script_segment="script",
        characters=[{"name": "女1"}],
        generation_callable=generate,
    )

    assert result["status"] == "failed"
    assert "严格匹配" in result["retry_prompt"]


@pytest.mark.asyncio
async def test_review_storyboard_image_degrades_to_unverified():
    async def generate(**_kwargs):
        raise RuntimeError("checker offline")

    result = await review_storyboard_image(
        image_url=DATA_URL,
        prompt="prompt",
        script_segment="script",
        characters=[],
        generation_callable=generate,
    )

    assert result["status"] == "unverified"
    assert "checker offline" in result["issues"][0]
