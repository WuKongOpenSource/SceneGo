"""Provider errors describe the actual request's owning channel."""
import pytest
import requests
from external_api.video import seedance
from services.api_provider_registry import SEEDANCE_STANDARD_ENDPOINT, SEEDANCE_AGENT_PLAN_ENDPOINT
from services.api_provider_runtime import seedance_user_facing_error, seedance_error_is_non_retryable


@pytest.mark.parametrize('default_plan,request_plan', [(True, False), (False, True)])
def test_error_uses_actual_channel(monkeypatch, default_plan, request_plan):
    monkeypatch.setenv('SEEDANCE_ENDPOINT', SEEDANCE_AGENT_PLAN_ENDPOINT if default_plan else SEEDANCE_STANDARD_ENDPOINT)
    error = RuntimeError('ModelNotOpen')
    error.seedance_endpoint = SEEDANCE_AGENT_PLAN_ENDPOINT if request_plan else SEEDANCE_STANDARD_ENDPOINT
    assert ('Agent Plan' in seedance_user_facing_error(error)) is request_plan


def test_unknown_channel_does_not_guess_plan(monkeypatch):
    monkeypatch.setenv('SEEDANCE_ENDPOINT', SEEDANCE_AGENT_PLAN_ENDPOINT)
    assert 'Agent Plan' not in seedance_user_facing_error(RuntimeError('ModelNotOpen'))


def test_missing_model_response_is_preserved(monkeypatch):
    monkeypatch.setenv('SEEDANCE_API_KEY', 'test-plan-key')
    monkeypatch.setenv('SEEDANCE_ENDPOINT', SEEDANCE_AGENT_PLAN_ENDPOINT)
    monkeypatch.setenv('SEEDANCE_MINI_API_KEY', 'test-payg-key')
    monkeypatch.setenv('SEEDANCE_MINI_ENDPOINT', SEEDANCE_STANDARD_ENDPOINT)
    response = requests.Response()
    response.status_code = 404
    response._content = b'{"error":{"code":"InvalidEndpointOrModel.NotFound","message":"The model or endpoint does not exist or you do not have access to it"}}'
    error = requests.HTTPError('404 Client Error', response=response)
    def fail(*args, **kwargs): raise error
    monkeypatch.setattr(seedance, 'request_json', fail)
    with pytest.raises(RuntimeError, match='ModelNotOpen') as caught:
        seedance.SeedanceClient().create_video_task('mini', [], duration=5)
    assert caught.value.response is response
    assert caught.value.seedance_endpoint == SEEDANCE_STANDARD_ENDPOINT
    assert seedance_error_is_non_retryable(caught.value)
    message = seedance_user_facing_error(caught.value)
    assert '模型 ID 不存在或当前 API Key 无访问权限' in message
    assert 'Agent Plan' not in message
