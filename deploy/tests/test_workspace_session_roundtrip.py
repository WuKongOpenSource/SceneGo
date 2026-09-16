import copy
import logging
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.workspace import create_workspace_router


def client_and_store():
    rows = {}
    dao = MagicMock()

    async def save(user, value, scope=''):
        rows[(user, scope)] = copy.deepcopy(value)

    async def load(user, scope=''):
        return copy.deepcopy(rows.get((user, scope)))

    dao.save_session = AsyncMock(side_effect=save)
    dao.load_session = AsyncMock(side_effect=load)
    app = FastAPI()
    app.include_router(create_workspace_router(
        require_auth_dependency=lambda: 'user-1', jwt_auth_module=MagicMock(),
        project_dao=MagicMock(), workspace_session_dao=dao, logger=logging.getLogger(__name__),
    ))
    return TestClient(app), dao


def payload():
    return {
        'scope': 'ep-1', 'task_groups': [{'uuid': 'manual', 'ids': ['blank']}],
        'uploaded_images': [], 'image_prompts': {'blank': 'manual prompt'}, 'tasks_status': {},
        'seedance_params': {'manual': {'sub_model': 'agent_plan', 'prompt': 'build a house',
            'media_inputs': [{'kind': 'image', 'url': '/first.png', 'role': 'first_frame'},
                             {'kind': 'image', 'url': '/last.png', 'role': 'last_frame'}],
            'duration': 12, 'resolution': '720p', 'generate_audio': True}},
        'dashscope_params': {'another': {'media_inputs': [{'url': '/original.png', 'file_id': 'original'}]}},
        'storyboard_meta': {'shot': {'audioDurationMs': 2500, 'plannedDurationMs': 3000}},
    }


def test_roundtrip_preserves_all_provider_fields_and_scope():
    client, _ = client_and_store()
    data = payload()
    assert client.post('/api/workspace/save-session', json=data).status_code == 200
    restored = client.get('/api/workspace/load-session?scope=ep-1').json()['session']
    assert restored == {key: value for key, value in data.items() if key != 'scope'}
    assert client.get('/api/workspace/load-session?scope=ep-other').json()['session'] is None


def test_older_client_preserves_omitted_params_but_explicit_clear_works():
    client, _ = client_and_store()
    data = payload()
    client.post('/api/workspace/save-session', json=data)
    old = {key: value for key, value in data.items() if key not in ('seedance_params', 'dashscope_params', 'storyboard_meta')}
    client.post('/api/workspace/save-session', json=old)
    assert client.get('/api/workspace/load-session?scope=ep-1').json()['session']['seedance_params'] == data['seedance_params']
    client.post('/api/workspace/save-session', json={**old, 'seedance_params': {}})
    assert client.get('/api/workspace/load-session?scope=ep-1').json()['session']['seedance_params'] == {}


def test_result_prompt_history_and_pair_snapshots_survive_roundtrip():
    client, _ = client_and_store()
    data = payload()
    data['task_groups'][0]['firstLastFrom'] = [
        {'uuid': 'child', 'ids': ['first'], 'prompt': 'original child action'}]
    data['tasks_status']['manual'] = {
        'result': '/old.mp4', 'videos': ['/old.mp4', '/new.mp4'],
        'videoPrompts': {'/old.mp4': 'old action', '/new.mp4': 'new action'},
        'taskId': 'pending', 'pendingVideoPrompt': 'submitted action',
    }
    assert client.post('/api/workspace/save-session', json=data).status_code == 200
    restored = client.get('/api/workspace/load-session?scope=ep-1').json()['session']
    assert restored['task_groups'] == data['task_groups']
    assert restored['tasks_status'] == data['tasks_status']


def test_failed_read_is_not_an_empty_workspace():
    client, dao = client_and_store()
    dao.load_session.side_effect = RuntimeError('temporary unavailable')
    assert client.get('/api/workspace/load-session?scope=ep-1').status_code == 503


def test_removed_and_refilled_card_sources_roundtrip_without_changing_originals():
    client, _ = client_and_store()
    data = payload()
    original = {'id': 'first', 'url': '/original.png', 'fileId': 'file_original'}
    replacement = {'id': 'last', 'url': '/replacement.png', 'fileId': 'file_replacement'}
    data['uploaded_images'] = [original]
    data['task_groups'][0].update({
        'ids': ['first', 'last'], 'sourceImageOverrides': {'first': None, 'last': replacement},
        'mergedFrom': [{'uuid': 'child', 'ids': ['first'], 'prompt': 'keep action',
                        'sourceImageOverrides': {'first': None}}],
    })
    assert client.post('/api/workspace/save-session', json=data).status_code == 200
    restored = client.get('/api/workspace/load-session?scope=ep-1').json()['session']
    assert restored['task_groups'] == data['task_groups']
    assert restored['uploaded_images'] == [original]
