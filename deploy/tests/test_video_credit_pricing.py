import pytest

from services import credit_service
from services.video_credit_pricing import (
    CREDITS_PER_CNY,
    quote_video_credits,
    validate_seedance_generation_options,
)


@pytest.mark.parametrize(
    "model",
    ["Wan2", "LTXNode1", "WanNode2", "一阶", "七阶", "MiniMaxH3", "MiniMaxH3Fast"],
)
def test_local_video_models_use_product_minimum(model):
    assert quote_video_credits({"model": model, "duration_seconds": 15})["credits"] == 10


def test_local_h3_mini_uses_half_standard_credits():
    quote = quote_video_credits({"model": "MiniMaxH3Mini", "duration_seconds": 15})
    assert quote["credits"] == 5
    assert quote["base_credits"] == 5


@pytest.mark.parametrize(
    ("model", "expected_credits"),
    [("MiniMaxH3", 15), ("MiniMaxH3Fast", 15), ("MiniMaxH3Mini", 10)],
)
def test_local_h3_720p_upscale_adds_five_credits(model, expected_credits):
    quote = quote_video_credits({
        "model": model,
        "duration_seconds": 5,
        "h3_upscale_720p": True,
    })
    assert quote["credits"] == expected_credits
    assert quote["profile"] == "local-720p-upscale"
    assert quote["upscale_credits"] == 5


def test_local_h3_false_upscale_flag_keeps_product_minimum():
    assert quote_video_credits({
        "model": "MiniMaxH3",
        "h3_upscale_720p": False,
    })["credits"] == 10


def test_external_conversion_is_twenty_credits_per_cny():
    assert CREDITS_PER_CNY == 20
    quote = quote_video_credits({
        "task_type": "wan26_i2v",
        "duration_seconds": 5,
        "resolution": "1080P",
    })
    assert quote["provider_cost_cny"] == "5"
    assert quote["credits"] == 100


def test_happyhorse_1080p_uses_twenty_credits_per_cny_and_default():
    explicit = quote_video_credits({
        "task_type": "happyhorse_r2v",
        "duration_seconds": 5,
        "hh_resolution": "1080P",
    })
    defaulted = quote_video_credits({"model": "HappyHorse", "duration_seconds": 5})
    assert explicit["credits"] == 160
    assert defaulted["credits"] == 160


@pytest.mark.parametrize(
    ("params", "credits"),
    [
        ({"model": "HappyHorse", "duration_seconds": 5, "hh_resolution": "720P"}, 90),
        ({"model": "Kling", "duration_seconds": 5, "resolution": "720P"}, 60),
        ({"model": "Kling", "duration_seconds": 5, "resolution": "1080P", "audio": True}, 120),
        ({"model": "Vidu", "duration_seconds": 5, "sub_model": "q3", "vidu_resolution": "720P"}, 63),
        ({"model": "MINI", "minimax_model": "MiniMax-Hailuo-2.3", "minimax_resolution": "768P", "duration_seconds": 6}, 40),
        ({"model": "MINI", "minimax_model": "MiniMax-Hailuo-2.3-Fast", "minimax_resolution": "1080P", "duration_seconds": 6}, 46),
        ({"model": "Seedance2Mini", "sub_model": "mini", "resolution": "720P", "duration_seconds": 5}, 50),
        ({"model": "Seedance2Fast", "sub_model": "fast", "resolution": "720P", "duration_seconds": 5}, 85),
        ({"model": "Seedance15", "sub_model": "standard", "resolution": "720P", "duration_seconds": 5}, 32),
        ({"model": "Seedance15", "sub_model": "standard", "resolution": "1080P", "duration_seconds": 5}, 45),
        ({"model": "Seedance2", "sub_model": "standard", "resolution": "720P", "duration_seconds": 5}, 105),
        ({"model": "Seedance2", "sub_model": "standard", "resolution": "1080P", "duration_seconds": 5}, 260),
        ({"model": "Seedance2", "sub_model": "standard", "resolution": "4K", "duration_seconds": 5}, 520),
        ({"model": "Sora2"}, 120),
        ({"model": "Veo"}, 110),
    ],
)
def test_model_and_spec_specific_prices(params, credits):
    assert quote_video_credits(params)["credits"] == credits


def test_caller_supplied_credit_amount_is_ignored():
    quote = quote_video_credits({
        "model": "HappyHorse",
        "duration_seconds": 5,
        "hh_resolution": "1080P",
        "credits": 1,
        "price": 0,
    })
    assert quote["credits"] == 160


@pytest.mark.parametrize(
    ("tier", "reference_seconds", "expected_credits"),
    [
        ("mini", 4, 55),
        ("mini", 15, 125),
        ("fast", 4, 90),
        ("fast", 15, 195),
        ("standard", 4, 110),
        ("standard", 15, 245),
    ],
)
def test_seedance_720p_reference_video_cost_scales_with_total_duration(
    tier,
    reference_seconds,
    expected_credits,
):
    quote = quote_video_credits({
        "model": f"Seedance2{tier.title() if tier != 'standard' else ''}",
        "sub_model": tier,
        "resolution": "720P",
        "duration_seconds": 5,
        "reference_video_count": 1,
        "reference_video_durations": [reference_seconds],
    })
    assert quote["credits"] == expected_credits
    assert quote["reference_video_seconds"] == str(reference_seconds)
    assert quote["reference_video_duration_defaulted"] is False


def test_seedance_unknown_reference_video_duration_uses_safe_fifteen_second_estimate():
    quote = quote_video_credits({
        "model": "Seedance2",
        "sub_model": "standard",
        "resolution": "720P",
        "duration_seconds": 5,
        "reference_video_count": 1,
        "reference_video_durations": [None],
    })
    assert quote["credits"] == 245
    assert quote["reference_video_seconds"] == "15"
    assert quote["reference_video_duration_defaulted"] is True


def test_seedance_reference_video_applies_four_second_minimum_per_clip():
    quote = quote_video_credits({
        "model": "Seedance2",
        "sub_model": "standard",
        "resolution": "720P",
        "duration_seconds": 5,
        "reference_video_count": 2,
        "reference_video_durations": [1, 2],
    })
    assert quote["credits"] == 160
    assert quote["reference_video_seconds"] == "8"


@pytest.mark.parametrize("tier", ["fast", "mini"])
def test_seedance_fast_and_mini_reject_1080p(tier):
    with pytest.raises(ValueError, match="仅支持 480P 和 720P"):
        validate_seedance_generation_options({
            "model": f"Seedance2{tier.title()}",
            "task_type": "seedance_i2v",
            "sub_model": tier,
            "resolution": "1080P",
        })


def test_credit_service_uses_server_owned_video_quote():
    rule = {
        "feature_key": "video_generation",
        "base_cost": 999,
        "min_cost": 999,
        "max_cost": 999,
        "factors": [],
    }
    assert credit_service.compute_cost(rule, {"model": "MiniMaxH3"}) == 10
    assert credit_service.compute_cost(rule, {"model": "MiniMaxH3Fast"}) == 10
    assert credit_service.compute_cost(rule, {"model": "MiniMaxH3Mini"}) == 5
    assert credit_service.compute_cost(rule, {
        "model": "MiniMaxH3Mini",
        "h3_upscale_720p": True,
    }) == 10
    assert credit_service.compute_cost(rule, {"model": "HappyHorse", "duration_seconds": 5}) == 160
