import pytest
from pydantic import ValidationError

from external_api.video import seedance
from schemas.generation import GenerateRequest
from services.seedance_output_contract import seedance_output_resolution


@pytest.mark.parametrize('model', ['standard', 'fast', 'mini', 'agent_plan'])
@pytest.mark.parametrize('output', [{}, {'resolution': None}, {'resolution': ''}, {'resolution': ' 720P '}])
def test_request_default_is_model_specific(model, output):
    request = GenerateRequest(task_type='seedance_multi', sub_model=model, duration=15, **output)
    assert request.resolution == '720p'
    assert request.duration == 15


@pytest.mark.parametrize('model', ['fast', 'mini'])
@pytest.mark.parametrize('resolution', ['1080p', '1080P', ' 1080P '])
def test_invalid_request_is_rejected_before_task_creation(model, resolution):
    with pytest.raises(ValidationError, match='480P 或 720P'):
        GenerateRequest(task_type='seedance_multi', sub_model=model, resolution=resolution)


def test_other_models_keep_their_own_defaults():
    assert GenerateRequest(task_type='wan26_i2v').resolution == '1080P'
    assert GenerateRequest(task_type='seedance_multi', sub_model='standard', resolution='1080P').resolution == '1080p'
    with pytest.raises(ValueError, match='清晰度无效'):
        seedance_output_resolution('4K')


@pytest.mark.parametrize('resolution,expected', [(None, '720p'), ('720P', '720p'), ('480P', '480p')])
def test_adapter_validates_final_model_and_preserves_references(monkeypatch, resolution, expected):
    class Config:
        api_key = 'test-key'
        endpoint = 'https://example.test/api/v3/contents/generations/tasks'
        def requests_kwargs(self): return {}
    monkeypatch.setattr(seedance, 'resolve_provider', lambda *args, **kwargs: Config())
    monkeypatch.setattr(seedance, 'resolve_seedance_model_name', lambda *args, **kwargs: 'doubao-seedance-2-0-mini-260615')
    submitted = []
    monkeypatch.setattr(seedance, 'request_json', lambda *args, **kwargs: (submitted.append(kwargs['json']) or {'id': 'test-task'}))
    content = [{'type': 'image_url', 'image_url': {'url': 'https://example.test/reference.png'}, 'role': 'reference_image'}]
    client = seedance.SeedanceClient()
    assert client.create_video_task('mini', content, resolution=resolution, duration=15) == 'test-task'
    assert submitted[0]['resolution'] == expected
    assert submitted[0]['duration'] == 15 and submitted[0]['content'] == content
    with pytest.raises(ValueError, match='480P 或 720P'):
        client.create_video_task('mini', content, resolution='1080P')
    assert len(submitted) == 1
