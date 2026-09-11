"""A provider task must be queried with its creation account, never a default."""
import os

import pytest

from external_api.video import seedance
from services.api_provider_registry import get_endpoint_env_key


@pytest.fixture
def channels(monkeypatch):
    for key in list(os.environ):
        if key.startswith(('SEEDANCE_', 'ARK_')):
            monkeypatch.delenv(key)
    monkeypatch.setenv('SEEDANCE_API_KEY', 'test-plan-key')
    monkeypatch.setenv('SEEDANCE_ENDPOINT', 'https://plan.example.test/tasks')
    for model in ('standard', 'fast', 'mini'):
        prefix = 'SEEDANCE_' + model.upper() + '_API_KEY'
        monkeypatch.setenv(prefix, 'test-' + model + '-key')
        monkeypatch.setenv(get_endpoint_env_key(prefix), 'https://' + model + '.example.test/tasks')
    calls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        if method == 'POST':
            return {'id': 'task-' + kwargs['json']['model']}
        return {'status': 'succeeded', 'content': {'video_url': 'https://media.example.test/output.mp4'}}

    monkeypatch.setattr(seedance, 'request_json', request)
    return calls


@pytest.mark.parametrize('model', ['standard', 'fast', 'mini'])
def test_poll_retains_creation_channel_after_environment_change(channels, monkeypatch, model):
    client = seedance.SeedanceClient()
    task_id = client.create_video_task(model, [{'type': 'text', 'text': 'test'}], usage_scope='workflow')
    submitted = channels[-1]
    assert submitted[2]['headers']['Authorization'] == 'Bearer test-' + model + '-key'
    monkeypatch.setenv('SEEDANCE_' + model.upper() + '_API_KEY', 'rotated-key')
    monkeypatch.setenv('SEEDANCE_API_KEY', 'other-plan-key')

    result = client.query_task(task_id)

    assert result['status'] == 'succeeded'
    queried = channels[-1]
    assert queried[1] == submitted[1] + '/' + task_id
    assert queried[2]['headers'] == submitted[2]['headers']
    assert queried[2]['request_kwargs'] == submitted[2]['request_kwargs']


def test_interleaved_models_keep_distinct_task_contexts(channels):
    client = seedance.SeedanceClient()
    accepted = []
    for model in ('mini', 'fast', 'standard'):
        task_id = client.create_video_task(model, [{'type': 'text', 'text': 'test'}])
        accepted.append((task_id, channels[-1]))
    for task_id, submitted in reversed(accepted):
        client.query_task(task_id)
        assert channels[-1][1] == submitted[1] + '/' + task_id
        assert channels[-1][2]['headers'] == submitted[2]['headers']


def test_unknown_task_never_uses_generic_credentials(channels):
    with pytest.raises(ValueError, match='创建渠道'):
        seedance.SeedanceClient().query_task('unknown-task')
    assert channels == []


def test_each_worker_gets_its_own_client(channels):
    assert seedance.get_seedance_client() is not seedance.get_seedance_client()


def test_download_uses_accepted_task_transport_without_auth_header(channels, monkeypatch):
    client = seedance.SeedanceClient()
    monkeypatch.setenv('SEEDANCE_MINI_PROXY_MODE', 'custom')
    monkeypatch.setenv('SEEDANCE_MINI_CUSTOM_PROXY', 'http://proxy.example.test:8080')
    task_id = client.create_video_task('mini', [{'type': 'text', 'text': 'test'}])
    submitted = channels[-1]
    client.create_video_task('fast', [{'type': 'text', 'text': 'test'}])
    captured = {}

    def download(url, **kwargs):
        captured.update(kwargs)
        return b'video'

    monkeypatch.setattr(seedance, 'download_streaming_video', download)
    assert client.download_video('https://media.example.test/video.mp4', task_id=task_id) == b'video'
    assert captured['request_kwargs'] == submitted[2]['request_kwargs']
    assert 'headers' not in captured


def test_later_creation_still_picks_up_new_configuration(channels, monkeypatch):
    client = seedance.SeedanceClient()
    client.create_video_task('mini', [{'type': 'text', 'text': 'test'}])
    monkeypatch.setenv('SEEDANCE_MINI_API_KEY', 'new-test-key')
    client.create_video_task('mini', [{'type': 'text', 'text': 'test'}])
    assert channels[-1][2]['headers']['Authorization'] == 'Bearer new-test-key'
