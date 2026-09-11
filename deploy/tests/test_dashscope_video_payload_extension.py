







import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import dashscope_video_api as ds
from services.api_provider_registry import DASHSCOPE_DEFAULT_MODEL_MAP, get_dashscope_sub_model_env_key





def _fake_response(status: int = 200):
    """Build an `async with session.post(...) as resp` compatible mock."""
    resp = MagicMock()
    resp.status = status
    resp.json = AsyncMock(return_value={
        "output": {"task_id": "ds-test-123", "task_status": "PENDING"},
        "request_id": "req-test",
    })
    resp.text = AsyncMock(return_value="")
    resp.__aenter__ = AsyncMock(return_value=resp)
    resp.__aexit__ = AsyncMock(return_value=False)
    return resp


def _fake_session(captured: dict, post_response):
    """Mock aiohttp.ClientSession() context manager + capture POST body."""
    session = MagicMock()

    def _capture(url, **kwargs):
        captured["url"] = url
        body = kwargs.get("json")
        if body is None and kwargs.get("data") is not None:
            data = kwargs["data"]
            if isinstance(data, (bytes, bytearray)):
                body = json.loads(data.decode("utf-8"))
            elif isinstance(data, str):
                body = json.loads(data)
        captured["payload"] = body
        return post_response

    session.post = MagicMock(side_effect=_capture)
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    return session


@pytest.fixture
def patch_http():

    captured: dict = {}
    resp = _fake_response()
    session_ctx = _fake_session(captured, resp)
    with patch("aiohttp.ClientSession", return_value=session_ctx):
        yield captured





async def test_kling_multi_shot_intelligence_serialized(patch_http):
    client = ds.DashScopeVideoClient(api_key="k")
    await client.submit(
        model_name="合体",
        params={
            "prompt": "雾岭镇",
            "kling_multi_shot": True,
            "kling_shot_type": "intelligence",
            "duration": 10,
            "aspect_ratio": "9:16",
        },
    )
    p = patch_http["payload"]
    assert p["input"].get("multi_shot") is True
    assert p["input"].get("shot_type") == "intelligence"
    assert p["parameters"].get("duration") == 10
    assert p["parameters"].get("aspect_ratio") == "9:16"


async def test_kling_multi_shot_customize_multi_prompt_serialized(patch_http):
    client = ds.DashScopeVideoClient(api_key="k")
    await client.submit(
        model_name="合体",
        params={
            "kling_multi_shot": True,
            "kling_shot_type": "customize",
            "kling_multi_prompt": [
                {"index": 1, "prompt": "雾岭镇黄昏", "duration": 5},
                {"index": 2, "prompt": "拨打电话", "duration": 5},
            ],
            "duration": 10,
        },
    )
    p = patch_http["payload"]
    assert p["input"].get("shot_type") == "customize"
    assert isinstance(p["input"].get("multi_prompt"), list)
    assert len(p["input"]["multi_prompt"]) == 2
    assert p["input"]["multi_prompt"][0]["prompt"] == "雾岭镇黄昏"


async def test_kling_standard_uses_runtime_sub_model_env(patch_http, monkeypatch):
    monkeypatch.setenv(get_dashscope_sub_model_env_key("kling-standard"), "kling/runtime-standard")

    client = ds.DashScopeVideoClient(api_key="k")
    await client.submit(
        model_name="\u5408\u4f53",
        params={
            "prompt": "runtime standard",
            "sub_model_kling": "standard",
        },
    )

    assert patch_http["payload"]["model"] == "kling/runtime-standard"


async def test_kling_omni_uses_runtime_sub_model_env(patch_http, monkeypatch):
    monkeypatch.setenv(get_dashscope_sub_model_env_key("kling-omni"), "kling/runtime-omni")

    client = ds.DashScopeVideoClient(api_key="k")
    await client.submit(
        model_name="\u5408\u4f53",
        params={
            "prompt": "runtime omni",
            "sub_model_kling": "omni",
        },
    )

    assert patch_http["payload"]["model"] == "kling/runtime-omni"


async def test_kling_submit_default_uses_runtime_sub_model_env(patch_http, monkeypatch):
    monkeypatch.setenv(get_dashscope_sub_model_env_key("kling-standard"), "kling/runtime-direct-standard")

    client = ds.DashScopeVideoClient(api_key="k")
    await client.kling_submit(
        "runtime direct standard",
        model=ds.DEFAULT_KLING_STANDARD_MODEL,
    )

    assert patch_http["payload"]["model"] == "kling/runtime-direct-standard"


async def test_vidu_resolution_size_seed_audio_serialized(patch_http):
    client = ds.DashScopeVideoClient(api_key="k")
    await client.submit(
        model_name="大乘",
        params={
            "prompt": "弹吉他",
            "media_inputs": [
                {"kind": "image", "url": "https://x/1.jpg", "role": "reference_image"}
            ],
            "vidu_resolution": "1080P",
            "vidu_size": "1920*1080",
            "vidu_seed": 12345,
            "vidu_audio": True,
            "duration": 8,
        },
    )
    p = patch_http["payload"]
    assert p["parameters"].get("resolution") == "1080P"
    assert p["parameters"].get("size") == "1920*1080"
    assert p["parameters"].get("seed") == 12345
    assert p["parameters"].get("audio") is True
    assert p["parameters"].get("duration") == 8


async def test_vidu_reference_uses_runtime_sub_model_env(patch_http, monkeypatch):
    monkeypatch.setenv(get_dashscope_sub_model_env_key("vidu-reference-q3"), "vidu/runtime-reference-q3")

    client = ds.DashScopeVideoClient(api_key="k")
    await client.submit(
        model_name="\u5927\u4e58",
        params={
            "prompt": "runtime vidu reference",
            "sub_model_vidu": "q3",
            "media_inputs": [
                {"kind": "image", "url": "https://x/ref.jpg", "role": "reference_image"}
            ],
        },
    )

    assert patch_http["payload"]["model"] == "vidu/runtime-reference-q3"


async def test_vidu_startend_uses_runtime_sub_model_env(patch_http, monkeypatch):
    monkeypatch.setenv(get_dashscope_sub_model_env_key("vidu-startend-q3-turbo"), "vidu/runtime-startend-q3-turbo")

    client = ds.DashScopeVideoClient(api_key="k")
    await client.submit(
        model_name="\u5927\u4e58",
        params={
            "prompt": "runtime vidu startend",
            "sub_model_vidu": "q3-turbo",
            "media_inputs": [
                {"kind": "image", "url": "https://x/first.jpg", "role": "first_frame"},
                {"kind": "image", "url": "https://x/last.jpg", "role": "last_frame"},
            ],
        },
    )

    assert patch_http["payload"]["model"] == "vidu/runtime-startend-q3-turbo"


async def test_vidu_direct_default_uses_runtime_sub_model_env(patch_http, monkeypatch):
    monkeypatch.setenv(get_dashscope_sub_model_env_key("vidu-reference-q3"), "vidu/runtime-direct-reference-q3")

    client = ds.DashScopeVideoClient(api_key="k")
    await client.vidu_reference_submit(
        "runtime direct vidu reference",
        model=DASHSCOPE_DEFAULT_MODEL_MAP["vidu-reference-q3"],
        reference_image_urls=["https://x/ref.jpg"],
    )

    assert patch_http["payload"]["model"] == "vidu/runtime-direct-reference-q3"


async def test_happyhorse_resolution_ratio_duration_watermark_seed_serialized(patch_http):
    client = ds.DashScopeVideoClient(api_key="k")
    await client.submit(
        model_name="炼虚",
        params={
            "prompt": "[Image 1] 红衣女子",
            "media_inputs": [
                {"kind": "image", "url": "https://x/g.jpg", "role": "reference_image"}
            ],
            "hh_resolution": "720P",
            "hh_ratio": "9:16",
            "hh_duration": 7,
            "hh_watermark": False,
            "hh_seed": 42,
        },
    )
    p = patch_http["payload"]
    assert p["parameters"].get("resolution") == "720P"
    assert p["parameters"].get("ratio") == "9:16"
    assert p["parameters"].get("duration") == 7
    assert p["parameters"].get("watermark") is False
    assert p["parameters"].get("seed") == 42


async def test_happyhorse_uses_runtime_sub_model_env(patch_http, monkeypatch):
    monkeypatch.setenv(get_dashscope_sub_model_env_key("happyhorse"), "happyhorse-runtime-r2v")

    client = ds.DashScopeVideoClient(api_key="k")
    await client.submit(
        model_name="\u70bc\u865a",
        params={
            "prompt": "runtime happyhorse",
            "media_inputs": [
                {"kind": "image", "url": "https://x/hh.jpg", "role": "reference_image"}
            ],
        },
    )

    assert patch_http["payload"]["model"] == "happyhorse-runtime-r2v"


async def test_happyhorse_direct_default_uses_runtime_sub_model_env(patch_http, monkeypatch):
    monkeypatch.setenv(get_dashscope_sub_model_env_key("happyhorse"), "happyhorse-runtime-direct-r2v")

    client = ds.DashScopeVideoClient(api_key="k")
    await client.happyhorse_submit(
        "runtime direct happyhorse",
        reference_image_urls=["https://x/hh.jpg"],
        model=DASHSCOPE_DEFAULT_MODEL_MAP["happyhorse"],
    )

    assert patch_http["payload"]["model"] == "happyhorse-runtime-direct-r2v"
