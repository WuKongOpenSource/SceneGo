import pytest

from services import credit_service
from services.task_credit_billing_service import (
    BILLING_METADATA_KEY,
    release_task_credits,
    reserve_task_credits,
    resolve_task_billing,
    settle_task_credits,
)


@pytest.mark.parametrize(
    ("task_type", "task_data", "feature_key"),
    [
        ("minimax_tts", {"text": "你好"}, "audio_generation_tts"),
        ("interpolate", {"duration": "5.8"}, "video_enhancement"),
        ("i2v", {"duration": 5}, "video_generation"),
        ("seedance_i2v", {"duration": 10}, "video_generation"),
        ("image_upscale", {"target_long_edge": 32000, "dpi": 300}, "image_upscale"),
        (
            "qwen_2",
            {"entity_type": "storyboard_item", "file_role": "generated_image"},
            "image_generation",
        ),
    ],
)
def test_resolve_task_billing_covers_requested_surfaces(task_type, task_data, feature_key):
    assert resolve_task_billing(task_type, task_data)["feature_key"] == feature_key


def test_resolve_task_billing_excludes_existing_multi_angle_contract():
    assert resolve_task_billing(
        "i2i_human",
        {"entity_type": "storyboard_item", "file_role": "generated_image"},
    ) is None


def test_resolve_task_billing_tolerates_invalid_duration():
    spec = resolve_task_billing("upscale", {"duration": "not-a-number"})
    assert spec["params"]["duration_seconds"] == 0


def test_resolve_task_billing_preserves_provider_pricing_fields():
    happyhorse = resolve_task_billing("happyhorse_r2v", {
        "model": "HappyHorse",
        "duration": 4,
        "hh_duration": 5,
        "hh_resolution": "1080P",
    })
    assert happyhorse["params"] == {
        "task_type": "happyhorse_r2v",
        "duration_seconds": 5,
        "resolution": "1080P",
        "model": "HappyHorse",
        "sub_model": None,
        "minimax_model": None,
        "minimax_resolution": None,
        "hh_resolution": "1080P",
        "vidu_resolution": None,
        "h3_upscale_720p": False,
        "audio": False,
        "has_reference_video": False,
        "reference_video_count": 0,
        "reference_video_durations": [],
    }

    vidu = resolve_task_billing("vidu_r2v", {
        "model": "Vidu",
        "duration": 5,
        "sub_model_vidu": "q3-turbo",
        "vidu_resolution": "720P",
        "vidu_audio": True,
        "media_inputs": [{"kind": "video", "url": "/reference.mp4", "duration_seconds": 8.5}],
    })
    assert vidu["params"]["sub_model"] == "q3-turbo"
    assert vidu["params"]["audio"] is True
    assert vidu["params"]["has_reference_video"] is True
    assert vidu["params"]["reference_video_count"] == 1
    assert vidu["params"]["reference_video_durations"] == [8.5]


def test_resolve_seedance_billing_keeps_unknown_video_duration_for_safe_fallback():
    spec = resolve_task_billing("seedance_multi", {
        "model": "Seedance2",
        "duration": 5,
        "resolution": "720P",
        "media_inputs": [{"kind": "video", "url": "/reference.mp4"}],
    })
    assert spec["params"]["reference_video_count"] == 1
    assert spec["params"]["reference_video_durations"] == [None]


def test_resolve_task_billing_preserves_local_h3_720p_upscale_flag():
    spec = resolve_task_billing("i2v", {
        "model": "MiniMaxH3",
        "duration": 5,
        "h3_upscale_720p": True,
    })
    assert spec["feature_key"] == "video_generation"
    assert spec["params"]["h3_upscale_720p"] is True


def test_resolve_image_upscale_billing_clamps_trusted_dimensions():
    spec = resolve_task_billing("image_upscale", {
        "target_long_edge": 99999,
        "dpi": 600,
        "text_clarity": True,
    })

    assert spec == {
        "feature_key": "image_upscale",
        "params": {
            "target_long_edge": 50000,
            "text_clarity": True,
            "dpi": 300,
        },
        "surface": "image_upscale",
    }


@pytest.mark.asyncio
async def test_reserve_settle_and_release_use_task_id_idempotency(monkeypatch):
    calls = []

    async def fake_estimate(feature_key, params, **kwargs):
        calls.append(("estimate", feature_key, params, kwargs))
        return {"enabled": True, "estimated_cost": 50, "rule_version": "v1"}

    async def fake_freeze(*args, **kwargs):
        calls.append(("freeze", args, kwargs))
        return {"freeze_id": "freeze-1"}

    async def fake_consume(*args, **kwargs):
        calls.append(("consume", args, kwargs))
        return {"charged_credits": 50, "idempotent": False}

    async def fake_release(*args, **kwargs):
        calls.append(("release", args, kwargs))
        return {"released": 50}

    monkeypatch.setattr(credit_service, "estimate", fake_estimate)
    monkeypatch.setattr(credit_service, "freeze", fake_freeze)
    monkeypatch.setattr(credit_service, "consume_usage", fake_consume)
    monkeypatch.setattr(credit_service, "release", fake_release)

    task_data = {"duration": 5, "project_id": "project-1"}
    metadata = await reserve_task_credits(
        task_id="task-1",
        task_type="i2v",
        task_data=task_data,
        user_id="user-1",
    )

    assert task_data[BILLING_METADATA_KEY] == metadata
    assert metadata["amount"] == 50
    freeze_call = next(call for call in calls if call[0] == "freeze")
    assert freeze_call[2]["task_id"] == "task-1"

    await settle_task_credits(task_id="task-1", task_data=task_data, user_id="user-1")
    consume_call = next(call for call in calls if call[0] == "consume")
    assert consume_call[2]["task_id"] == "task-1"

    await release_task_credits(
        task_id="task-1",
        task_data=task_data,
        user_id="user-1",
        reason="cancelled",
    )
    release_call = next(call for call in calls if call[0] == "release")
    assert release_call[1][0] == "task-1"
    assert release_call[2]["reason"] == "cancelled"


@pytest.mark.asyncio
async def test_unbilled_task_does_not_touch_ledger(monkeypatch):
    async def unexpected(*_args, **_kwargs):
        raise AssertionError("ledger must not be called")

    monkeypatch.setattr(credit_service, "estimate", unexpected)
    task_data = {"entity_type": "material", "file_role": "reference_image"}
    assert await reserve_task_credits(
        task_id="task-free",
        task_type="qwen_2",
        task_data=task_data,
        user_id="user-1",
    ) is None
