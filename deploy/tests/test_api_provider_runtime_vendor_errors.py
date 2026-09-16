














from __future__ import annotations

import pytest
import requests

from services.api_provider_runtime import (
    seedance_error_is_non_retryable,
    seedance_user_facing_error,
    vendor_error_is_non_retryable,
    vendor_user_facing_error,
    _VENDOR_ERROR_PROFILES,
)





def _http_error(status_code: int, body: str = "") -> requests.HTTPError:

    response = requests.Response()
    response.status_code = status_code
    response._content = body.encode("utf-8")
    err = requests.HTTPError(f"{status_code} Client Error: {body[:50]}")
    err.response = response
    return err





@pytest.mark.parametrize(
    "vendor",
    ["sora2", "veo", "wan26", "minimax", "minimax_tts"],
)
def test_http_401_marks_non_retryable(vendor):



    body_map = {
        "sora2": '{"error": "unauthorized"}',
        "veo": '{"error": "unauthorized"}',
        "wan26": '{"error": "unauthorized"}',
        "minimax": '{"error": "unauthorized"}',
        "minimax_tts": '{"error": "authorization failed"}',
    }
    exc = _http_error(401, body_map[vendor])
    assert vendor_error_is_non_retryable(exc, vendor) is True


@pytest.mark.parametrize("vendor", ["sora2", "veo", "wan26", "minimax"])
def test_http_403_marks_non_retryable(vendor):
    exc = _http_error(403, "Forbidden")
    assert vendor_error_is_non_retryable(exc, vendor) is True


@pytest.mark.parametrize("vendor", ["sora2", "veo"])
def test_http_404_marks_non_retryable_for_laozhang(vendor):

    exc = _http_error(404, '{"error": "model_not_found"}')
    assert vendor_error_is_non_retryable(exc, vendor) is True


def test_minimax_tts_http_401_does_not_match_pure_status():



    exc = _http_error(401, "")
    assert vendor_error_is_non_retryable(exc, "minimax_tts") is False





def test_minimax_tts_runtime_error_with_business_code():

    exc = RuntimeError("tts_sync 失败: http_status=400 status_code=1004 msg=insufficient balance")
    assert vendor_error_is_non_retryable(exc, "minimax_tts") is True


def test_minimax_runtime_error_with_business_code():
    exc = RuntimeError("MiniMax 任务失败: base_resp.status_msg=insufficient balance, status_code=1004")
    assert vendor_error_is_non_retryable(exc, "minimax") is True


def test_sora2_runtime_error_with_invalid_api_key():
    exc = RuntimeError("Sora2 失败: Incorrect API key provided")
    assert vendor_error_is_non_retryable(exc, "sora2") is True


def test_wan26_runtime_error_with_missing_api_key():
    exc = RuntimeError("Wan2.6 失败: code=MissingApiKey, message=API key not configured")
    assert vendor_error_is_non_retryable(exc, "wan26") is True


def test_veo_runtime_error_with_model_not_found():
    exc = RuntimeError("Veo 失败: model_not_found - the model does not exist")
    assert vendor_error_is_non_retryable(exc, "veo") is True


def test_minimax_tts_local_message_unconfigured():

    exc = RuntimeError("MiniMax 未配置 — 请在 admin 加 MINIMAX_API_KEY")
    assert vendor_error_is_non_retryable(exc, "minimax_tts") is True


def test_minimax_local_message_unconfigured():
    exc = RuntimeError("MINIMAX_API_KEY 未设置")
    assert vendor_error_is_non_retryable(exc, "minimax") is True





def test_content_review_error_is_retryable_for_minimax():

    exc = RuntimeError("MiniMax 任务失败: 内容审核不通过，请调整 prompt")
    assert vendor_error_is_non_retryable(exc, "minimax") is False


def test_network_error_is_retryable_for_minimax_tts():

    exc = RuntimeError("tts_sync 失败: consecutive 3 network errors last_err=ConnectionTimeout")
    assert vendor_error_is_non_retryable(exc, "minimax_tts") is False


def test_unrelated_runtime_error_is_retryable():
    exc = RuntimeError("Wan2.6 任务失败: 视频处理超时")
    assert vendor_error_is_non_retryable(exc, "wan26") is False


def test_unknown_vendor_falls_back_to_no_match():

    exc = _http_error(401, "unauthorized")
    assert vendor_error_is_non_retryable(exc, "unknown_vendor_xyz") is False





def test_user_facing_error_invalid_api_key_message():
    exc = _http_error(401, '{"error": "InvalidApiKey"}')
    msg = vendor_user_facing_error(exc, "sora2")
    assert "Sora2" in msg
    assert "API Key" in msg or "Key" in msg
    assert "后台" in msg


def test_user_facing_error_balance_message():
    exc = RuntimeError("MiniMax 任务失败: balance insufficient, status_code=1004")
    msg = vendor_user_facing_error(exc, "minimax")
    assert "MiniMax" in msg
    assert "余额" in msg or "额度" in msg


def test_user_facing_error_local_config_message():
    exc = RuntimeError("MiniMax 未配置 — 请在 admin 加 MINIMAX_API_KEY")
    msg = vendor_user_facing_error(exc, "minimax_tts")
    assert "MiniMax" in msg
    assert "未配置" in msg or "配置" in msg


def test_user_facing_error_fallback_to_response_text():
    exc = _http_error(500, "internal error from server")
    msg = vendor_user_facing_error(exc, "sora2")

    assert "Sora2" in msg
    assert "请求失败" in msg or "internal error" in msg





def test_seedance_thin_shell_equivalent_for_401():






    exc = _http_error(401, '{"error": "Unauthorized"}')
    assert seedance_error_is_non_retryable(exc) is True


def test_seedance_thin_shell_equivalent_for_invalid_api_key_marker():

    exc = RuntimeError("Seedance 任务失败: InvalidApiKey - 当前 API Key 无效")
    assert seedance_error_is_non_retryable(exc) is True


def test_seedance_thin_shell_user_facing_preserves_message():

    exc = RuntimeError("Seedance 失败: ModelNotOpen")
    msg = seedance_user_facing_error(exc)
    assert msg.startswith("Seedance 模型未开通：")
    assert "火山方舟" in msg


def test_seedance_thin_shell_user_facing_for_invalid_key():
    exc = _http_error(401, '{"error": "InvalidApiKey"}')
    msg = seedance_user_facing_error(exc)
    assert "Seedance API Key 无效或无权限" in msg


@pytest.mark.parametrize('with_prompt', [True, False])
def test_seedance_rejected_image_maps_actual_content_index(with_prompt):
    contents = ([{'type': 'text', 'text': 'prompt'}] if with_prompt else []) + [
        {'type': 'image_url'}, {'type': 'audio_url'}, {'type': 'image_url'},
        {'type': 'video_url'}, {'type': 'image_url'},
    ]
    index = 5 if with_prompt else 4
    exc = _http_error(400, '{"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation",'
        f'"message":"The input image content[{index}] may contain real person."}}}}')
    msg = seedance_user_facing_error(exc, contents=contents)
    assert f'本次提交的图片3（上游位置 content[{index}]）' in msg
    assert '其他图片是否通过审核尚未确认' in msg
    assert '本站原图来源校验不等于上游审核通过' in msg
    assert '已停止自动重试' in msg


def test_seedance_poll_rejection_preserves_multiple_distinct_image_positions():
    exc = RuntimeError('InputImageSensitiveContentDetected.PrivacyInformation content[3] content[1] content[3]')
    contents = [{'type': 'text'}, {'type': 'image_url'}, {'type': 'audio_url'}, {'type': 'image_url'}]
    msg = seedance_user_facing_error(exc, contents=contents)
    assert msg.count('本次提交的图片1') == 1
    assert msg.count('本次提交的图片2') == 1
    assert '图片3' not in msg


@pytest.mark.parametrize('contents', [None, [], [{'type': 'text'}, {'type': 'audio_url'}]])
def test_seedance_rejection_does_not_guess_rank_without_matching_submitted_image(contents):
    exc = RuntimeError('InputImageSensitiveContentDetected.PrivacyInformation content[1]')
    msg = seedance_user_facing_error(exc, contents=contents)
    assert 'content[1]' in msg
    assert '无法可靠对应图片编号' in msg
    assert '本次提交的图片' not in msg


def test_seedance_rejection_without_index_does_not_mark_all_inputs():
    exc = RuntimeError('InputImageSensitiveContentDetected.PrivacyInformation Request id: 12345')
    msg = seedance_user_facing_error(exc, contents=[{'type': 'image_url'}] * 5)
    assert '上游未返回具体图片编号' in msg
    assert '不会将全部参考图判为不合格' in msg
    assert '本次提交的图片' not in msg


def test_seedance_non_portrait_image_rejection_also_identifies_submitted_image():
    exc = RuntimeError('InputImageSensitiveContentDetected content[1]')
    msg = seedance_user_facing_error(exc, contents=[{'type': 'text'}, {'type': 'image_url'}])
    assert '本次提交的图片1' in msg
    assert '人像' not in msg





def test_all_five_vendor_profiles_registered():
    expected = {"sora2", "veo", "wan26", "minimax", "minimax_tts"}
    assert set(_VENDOR_ERROR_PROFILES.keys()) == expected


def test_each_profile_has_vendor_label():

    for vendor, profile in _VENDOR_ERROR_PROFILES.items():
        assert profile.vendor_label, f"vendor={vendor} missing vendor_label"
        assert profile.vendor_label != vendor
def test_minimax_rate_limit_code_1002_remains_retryable():
    exc = RuntimeError("MiniMax task failed: status_code=1002 msg=rate limit")
    assert vendor_error_is_non_retryable(exc, "minimax") is False


def test_minimax_tts_system_error_code_1033_remains_retryable():
    exc = RuntimeError("tts_sync failed: status_code=1033 msg=system error")
    assert vendor_error_is_non_retryable(exc, "minimax_tts") is False


def test_minimax_code_only_auth_and_balance_are_non_retryable():
    assert vendor_error_is_non_retryable(RuntimeError("status_code=1004"), "minimax") is True
    assert vendor_error_is_non_retryable(RuntimeError("status_code=1008"), "minimax_tts") is True


def test_minimax_code_only_messages_are_actionable():
    auth_msg = vendor_user_facing_error(RuntimeError("status_code=1004"), "minimax")
    balance_msg = vendor_user_facing_error(RuntimeError("status_code=1008"), "minimax_tts")
    assert "MiniMax" in auth_msg and "Key" in auth_msg
    assert "MiniMax" in balance_msg and ("余额" in balance_msg or "额度" in balance_msg)
