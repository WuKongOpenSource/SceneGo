import json
import pytest
from services.ai_proxy_gpt_image_service import _gpt_image_upstream_detail, _gpt_image_upstream_status
from services.sensitive_data_redaction import redact_sensitive_text


@pytest.mark.parametrize('status', [400, 403, 429])
@pytest.mark.parametrize('code', ['insufficient_user_quota', 'insufficient_quota', 'insufficient_token_quota', 'insufficient_balance'])
def test_quota_error_is_not_reported_as_invalid_credentials(status, code):
    upstream = redact_sensitive_text(json.dumps({'error': {
        'code': code, 'message': 'private-provider-detail', 'api_key': 'test-secret-placeholder',
    }}))
    detail = _gpt_image_upstream_detail(upstream, status)
    assert '不是本站积分不足' in detail
    assert '供应商余额' in detail
    assert 'private-provider-detail' not in detail and 'test-secret-placeholder' not in detail
    assert _gpt_image_upstream_status(upstream, status) == 402


def test_legacy_preconsumption_message_is_classified():
    body = json.dumps({'error': {'message': 'quota preConsumedQuota is not enough'}})
    assert '供应商余额' in _gpt_image_upstream_detail(body, 403)


@pytest.mark.parametrize('body', ['', '<html>forbidden</html>', '[]', '{"error":[]}', '{"error":"invalid"}'])
def test_unstructured_auth_failure_remains_safe(body):
    assert '鉴权或模型权限失败' in _gpt_image_upstream_detail(body, 403)
    assert '供应商余额' not in _gpt_image_upstream_detail(body, 403)
    assert _gpt_image_upstream_status(body, 403) == 502
