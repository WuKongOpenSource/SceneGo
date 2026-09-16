import pytest

from services.jimeng_contract import EXECUTION_MODEL, MODEL_KEY, MODEL_LABEL, TASK_TYPE, JimengError, capability, normalize_jimeng_options
from services.video_credit_pricing import quote_video_credits
from services.task_credit_billing_service import resolve_task_billing


def payload(**kwargs):
    return {"task_type": TASK_TYPE, "model": MODEL_KEY, "resolution": "720p", "ratio": "16:9",
            "prompt": "两位成年虚构角色对话", "duration": 5,
            "media_inputs": [{"kind": "image", "file_id": "file-example"}], **kwargs}


def test_identity_and_minimum_duration_do_not_mutate_original():
    original = payload(duration=2.7)
    normalized = normalize_jimeng_options(original)
    assert original["duration"] == 2.7
    assert normalized["duration"] == 4 and normalized["requested_duration"] == 2.7
    assert normalized["display_name"] == MODEL_LABEL
    assert normalized["execution_model"] == EXECUTION_MODEL
    assert "Mini" not in MODEL_LABEL


@pytest.mark.parametrize("fields", [{"resolution": "1080p"}, {"model": "Seedance2"}, {"task_type": "seedance_multi"},
    {"ratio": "adaptive"}, {"duration": 0}, {"duration": 15.1}, {"duration": float("nan")}, {"generate_audio": False},
    {"seed": 123}, {"entity_type": "storyboard_item", "file_role": "generated_image"},
    {"reference_audio_policy": "trim_to_15"}, {"portrait_reference_mode": "character_background"},
    {"media_inputs": [{"kind": "audio", "file_id": "a"}]},
    {"media_inputs": [{"kind": "image", "file_id": "a"}] * 10}])
def test_reject_unsupported_without_fallback(fields):
    with pytest.raises(JimengError):
        normalize_jimeng_options(payload(**fields))


@pytest.mark.parametrize("duration", [4, 5, 9, 15])
@pytest.mark.parametrize("references", [[], [4], [5, 9], [None]])
def test_once_standard_same_dimensions(duration, references):
    params = {"duration_seconds": duration, "resolution": "720P", "reference_video_durations": references}
    standard = quote_video_credits({**params, "model": "Seedance2", "sub_model": "standard"})
    jimeng = quote_video_credits({**params, "model": MODEL_KEY, "sub_model": "mini"})
    assert jimeng["credits"] == standard["credits"]
    assert jimeng["multiplier"] == 1
    assert jimeng["basis"] == "seedance-standard-product-price"
    assert "provider_cost_cny" not in jimeng


def test_fifteen_seconds_720p_is_315_creation_credits():
    assert EXECUTION_MODEL == "seedance2.0mini"
    quote = quote_video_credits(payload(duration=15))
    assert quote["credits"] == 315
    assert quote["reference_credits"] == 315


def test_capability_and_quote_share_single_multiplier():
    assert capability()["pricing_multiplier"] == quote_video_credits(payload(duration=15))["multiplier"] == 1


def test_empty_portrait_flag_remains_a_normal_jimeng_request():
    assert normalize_jimeng_options(payload(portrait_reference_mode=None))["execution_model"] == EXECUTION_MODEL


def test_billing_is_video_and_preview_rounds_same_as_submission():
    normalized = normalize_jimeng_options(payload(duration=4.2))
    billing = resolve_task_billing(TASK_TYPE, normalized)
    assert billing["feature_key"] == "video_generation"
    assert quote_video_credits(billing["params"])["credits"] == quote_video_credits({"model": MODEL_KEY, "duration_seconds": 4.2})["credits"]
def test_independent_task_is_video_in_admin_statistics():
    from dao.admin.admin_stats import VIDEO_TASK_TYPES, VIDEO_LOG_TYPE_MATCHES, MODEL_NAME_BY_TASK_TYPE
    assert 'jimeng_multimodal' in VIDEO_TASK_TYPES
    assert 'jimeng_multimodal' in VIDEO_LOG_TYPE_MATCHES
    assert MODEL_NAME_BY_TASK_TYPE['jimeng_multimodal'] == 'JimengSeedance2'
