"""Source-edition reverse-video routes with real accounts, DAO, queue and billing.

The video bytes are inert and no worker is started here. Processing tests replace
only the media/provider edges, never authorization, task state or credit storage.
"""
from types import SimpleNamespace
import json
from unittest.mock import AsyncMock

import pytest

from dao_content import FileDAO
from dao_credit import CreditAccountDAO
from dao_video_reverse import VideoReverseTaskDAO, VideoReverseSegmentDAO
from core.online_provider_worker import OnlineProviderWorker
from test_public_account_isolation import accounts  # noqa: F401


@pytest.fixture
async def reverse_video(accounts):
    credit = await CreditAccountDAO.get_or_create('user', accounts.owner.user_id)
    await accounts.db.execute(
        'UPDATE credit_accounts SET available_credits=100, account_credits=100 WHERE account_id=$1',
        credit['account_id'],
    )
    path = accounts.root / 'storage' / 'fixture.mp4'
    path.write_bytes(b'inert video fixture; no decoder or provider is invoked')
    file = await FileDAO.create_file(
        version_id=None, user_id=accounts.owner.user_id, file_type='video',
        file_name=path.name, file_path=str(path), file_url='/storage/fixture.mp4',
        file_size_bytes=path.stat().st_size, mime_type='video/mp4',
        project_id=accounts.owner.project_id,
    )
    await accounts.db.execute('UPDATE files SET duration_seconds=15 WHERE file_id=$1', file['file_id'])
    return SimpleNamespace(file_id=file['file_id'], path=path, body={
        'video_file_id': file['file_id'], 'project_id': accounts.owner.project_id,
        'frames_per_segment': 3, 'language': 'en',
    })


async def test_public_video_reverse_estimate_and_list_are_available(accounts, reverse_video):
    result = await accounts.owner.client.post('/api/video-reverse/estimate', json={
        'video_file_id': reverse_video.file_id,
    })
    assert result.status_code == 200, result.text
    assert result.json()['estimated_cost'] == 20
    listed = await accounts.owner.client.get('/api/video-reverse/tasks')
    assert listed.status_code == 200 and listed.json()['tasks'] == []


async def test_public_video_reverse_create_cancel_retry_preserves_billing_and_options(accounts, reverse_video):
    response = await accounts.owner.client.post('/api/video-reverse/tasks', json=reverse_video.body)
    assert response.status_code == 200, response.text
    created = response.json()
    path = '/api/video-reverse/tasks/' + created['reverse_task_id']
    task = await accounts.queue.get_task(created['task_id'])
    assert task.task_type == 'video_reverse_prompt' and task.user_id == accounts.owner.user_id
    assert task.data['frames_per_segment'] == 3 and task.data['language'] == 'en'
    assert await accounts.queue.get_external_queue_length() == 1
    assert await accounts.db.fetchval('SELECT COUNT(*) FROM credit_freezes WHERE task_id=$1', task.task_id) == 1
    assert (await accounts.owner.client.get(path)).json()['task']['status'] == 'pending'
    assert (await accounts.other.client.get(path)).status_code == 403
    assert (await accounts.anonymous.get(path)).status_code == 401
    assert (await accounts.owner.client.post(path + '/cancel')).status_code == 200
    assert await accounts.queue.get_external_queue_length() == 0
    assert (await accounts.queue.get_task(task.task_id)).status.value == 'cancelled'
    retried = await accounts.owner.client.post(path + '/retry')
    assert retried.status_code == 200, retried.text
    retry = await accounts.queue.get_task(retried.json()['task_id'])
    assert retry.task_id != task.task_id and retry.data['frames_per_segment'] == 3
    assert retry.data['language'] == 'en' and retry.data['project_id'] == accounts.owner.project_id
    balance = await accounts.db.fetchrow(
        "SELECT available_credits, frozen_credits, total_used_credits FROM credit_accounts WHERE owner_type='user' AND owner_id=$1",
        accounts.owner.user_id,
    )
    assert dict(balance) == {'available_credits': 80, 'frozen_credits': 20, 'total_used_credits': 0}
    assert (await accounts.owner.client.post(path + '/retry')).status_code == 400


@pytest.mark.parametrize('target', ['foreign_project', 'foreign_episode', 'mismatched_episode'])
async def test_reverse_rejects_unauthorized_output_before_work(accounts, reverse_video, monkeypatch, target):
    import video_reverse_routes

    await accounts.db.execute(
        "INSERT INTO episodes (episode_id, project_id, episode_number, episode_name) "
        "VALUES ('reverse-other-episode', $1, 1, 'Other episode')", accounts.other.project_id,
    )
    body = dict(reverse_video.body)
    if target == 'foreign_project':
        body['project_id'] = accounts.other.project_id
    else:
        body['episode_id'] = 'reverse-other-episode'
        if target == 'foreign_episode':
            body.pop('project_id')
    validate = AsyncMock(side_effect=AssertionError('Permission denial must precede probing'))
    monkeypatch.setattr(video_reverse_routes.video_reverse_service, 'validate_video', validate)
    response = await accounts.owner.client.post('/api/video-reverse/tasks', json=body)
    assert response.status_code == 404, response.text
    validate.assert_not_awaited()
    assert await accounts.db.fetchval('SELECT COUNT(*) FROM video_reverse_tasks') == 0
    assert await accounts.db.fetchval('SELECT COUNT(*) FROM credit_freezes') == 0
    assert await accounts.queue.get_external_queue_length() == 0


async def test_reverse_episode_only_resolves_output_project(accounts, reverse_video):
    await accounts.db.execute(
        "INSERT INTO episodes (episode_id, project_id, episode_number, episode_name) "
        "VALUES ('reverse-owner-episode', $1, 1, 'Owner episode')", accounts.owner.project_id,
    )
    body = {**reverse_video.body, 'episode_id': 'reverse-owner-episode'}
    body.pop('project_id')
    created = await accounts.owner.client.post('/api/video-reverse/tasks', json=body)
    assert created.status_code == 200, created.text
    task = await accounts.queue.get_task(created.json()['task_id'])
    row = await VideoReverseTaskDAO.get(created.json()['reverse_task_id'])
    assert row['project_id'] == task.data['project_id'] == accounts.owner.project_id
    assert row['episode_id'] == task.data['episode_id'] == 'reverse-owner-episode'


@pytest.mark.parametrize('change', [{'frames_per_segment': 0}, {'frames_per_segment': 4}, {'frame_strategy': 'unknown'}])
async def test_reverse_rejects_unsupported_extraction_options(accounts, reverse_video, change):
    response = await accounts.owner.client.post('/api/video-reverse/tasks', json={**reverse_video.body, **change})
    assert response.status_code == 422
    assert await accounts.db.fetchval('SELECT COUNT(*) FROM credit_freezes') == 0


async def test_reverse_retry_rechecks_source_ownership(accounts, reverse_video):
    created = (await accounts.owner.client.post('/api/video-reverse/tasks', json=reverse_video.body)).json()
    path = '/api/video-reverse/tasks/' + created['reverse_task_id']
    assert (await accounts.owner.client.post(path + '/cancel')).status_code == 200
    await accounts.db.execute('UPDATE files SET user_id=$2, project_id=$3 WHERE file_id=$1',
                              reverse_video.file_id, accounts.other.user_id, accounts.other.project_id)
    response = await accounts.owner.client.post(path + '/retry')
    assert response.status_code == 404
    assert (await VideoReverseTaskDAO.get(created['reverse_task_id']))['status'] == 'cancelled'
    assert await accounts.queue.get_external_queue_length() == 0
    assert await accounts.db.fetchval('SELECT COUNT(*) FROM credit_freezes') == 1


async def test_stale_reverse_retry_creates_only_one_reservation(accounts, reverse_video, monkeypatch):
    created = (await accounts.owner.client.post('/api/video-reverse/tasks', json=reverse_video.body)).json()
    path = '/api/video-reverse/tasks/' + created['reverse_task_id']
    assert (await accounts.owner.client.post(path + '/cancel')).status_code == 200
    stale = await VideoReverseTaskDAO.get(created['reverse_task_id'])
    # Two requests can both read the cancelled attempt before either claims it.
    # Replay that read while retaining the real compare-and-swap and credit DAO.
    monkeypatch.setattr(VideoReverseTaskDAO, 'get', AsyncMock(return_value=stale))
    responses = [await accounts.owner.client.post(path + '/retry') for _ in range(2)]
    assert [response.status_code for response in responses] == [200, 409]
    assert await accounts.queue.get_external_queue_length() == 1
    assert await accounts.db.fetchval('SELECT COUNT(*) FROM credit_freezes') == 2


@pytest.mark.parametrize('outcome', ['success', 'provider_failure', 'no_frames', 'cancel_in_flight'])
async def test_reverse_processing_persists_results_or_refunds_without_automatic_retry(
    accounts, reverse_video, monkeypatch, outcome,
):
    from PIL import Image
    from services import file_service, video_reverse_service

    # Only decoding and the paid vision response are substitutes; routes,
    # worker dispatch, file/segment storage, cancellation and ledgers are real.
    frame = accounts.root / 'frame.jpg'
    Image.new('RGB', (8, 8), color='navy').save(frame)
    monkeypatch.setattr(file_service, 'STORAGE_ROOT', accounts.root / 'storage')

    async def extract(_path, segments, **_kwargs):
        return {index: [] if outcome == 'no_frames' else [str(frame)] for index in range(len(segments))}

    monkeypatch.setattr(video_reverse_service, 'extract_frames', extract)
    created = (await accounts.owner.client.post('/api/video-reverse/tasks', json=reverse_video.body)).json()
    path = '/api/video-reverse/tasks/' + created['reverse_task_id']
    cancellations = []

    async def vision(**_kwargs):
        if outcome == 'provider_failure':
            raise RuntimeError('Provider unavailable; authorization=private-test-secret')
        if outcome == 'cancel_in_flight' and not cancellations:
            cancelled = await accounts.owner.client.post(path + '/cancel')
            # An already-submitted provider request is not refundable merely
            # because its caller wants to cancel. Keep the real queue guard.
            assert cancelled.status_code == 409, cancelled.text
            cancellations.append(cancelled.status_code)
        return SimpleNamespace(content=json.dumps({'description': 'A blue test scene', 'shot_design': 'Wide shot'}))

    monkeypatch.setattr(video_reverse_service, 'generate_gemini_chat_result', vision)
    task = await accounts.queue.dequeue(timeout=1)
    assert task.task_id == created['task_id']
    worker = OnlineProviderWorker('reverse-test-worker', accounts.queue.redis, accounts.queue)
    assert await worker._process_task(task) is (outcome in ('success', 'cancel_in_flight'))
    row = await VideoReverseTaskDAO.get(created['reverse_task_id'])
    state = (await accounts.queue.get_task(task.task_id)).status.value
    balance = await accounts.db.fetchrow(
        "SELECT available_credits, frozen_credits, total_used_credits FROM credit_accounts WHERE owner_id=$1",
        accounts.owner.user_id,
    )
    if outcome in ('success', 'cancel_in_flight'):
        assert row['status'] == state == 'completed'
        result = (await accounts.owner.client.get(path)).json()
        assert len(result['segments']) == 3 and len(row['frame_file_ids']) == 3
        assert all(segment['keyframe_file_url'] and segment['description'] == 'A blue test scene'
                   for segment in result['segments'])
        assert await accounts.db.fetchval(
            'SELECT COUNT(*) FROM files WHERE file_id=ANY($1::text[]) AND project_id=$2',
            row['frame_file_ids'], accounts.owner.project_id,
        ) == 3
        assert dict(balance) == {'available_credits': 80, 'frozen_credits': 0, 'total_used_credits': 20}
        # Redelivery after result commit must reuse files, prompts and billing.
        monkeypatch.setattr(video_reverse_service, 'extract_frames', AsyncMock(side_effect=AssertionError('No replay decoding')))
        assert await worker._process_video_reverse_task(task) is True
        assert (await VideoReverseTaskDAO.get(created['reverse_task_id']))['status'] == 'completed'
        assert await accounts.db.fetchval('SELECT total_used_credits FROM credit_accounts WHERE owner_id=$1',
                                         accounts.owner.user_id) == 20
    else:
        assert row['status'] == state == 'failed' and 'private-test-secret' not in row['error_message']
        assert not row['overall_prompt_zh']
        assert dict(balance) == {'available_credits': 100, 'frozen_credits': 0, 'total_used_credits': 0}
    assert await accounts.queue.get_external_queue_length() == 0


async def test_delayed_cancelled_attempt_cannot_overwrite_or_refund_retry(accounts, reverse_video, monkeypatch):
    from services import video_reverse_service

    created = (await accounts.owner.client.post('/api/video-reverse/tasks', json=reverse_video.body)).json()
    old = await accounts.queue.get_task(created['task_id'])
    path = '/api/video-reverse/tasks/' + created['reverse_task_id']
    assert (await accounts.owner.client.post(path + '/cancel')).status_code == 200
    retried = await accounts.owner.client.post(path + '/retry')
    assert retried.status_code == 200
    extract = AsyncMock(side_effect=AssertionError('A stale attempt must never read the video'))
    monkeypatch.setattr(video_reverse_service, 'extract_frames', extract)
    worker = OnlineProviderWorker('delayed-worker', accounts.queue.redis, accounts.queue)
    assert await worker._process_video_reverse_task(old) is False
    extract.assert_not_awaited()
    row = await VideoReverseTaskDAO.get(created['reverse_task_id'])
    assert row['task_id'] == retried.json()['task_id'] and row['status'] == 'pending' and row['progress'] == 0
    assert not row['overall_prompt_zh']
    assert await accounts.db.fetchval('SELECT frozen_credits FROM credit_accounts WHERE owner_id=$1',
                                     accounts.owner.user_id) == 20
    assert await accounts.queue.get_external_queue_length() == 1


@pytest.mark.parametrize('recovery', ['owner_detail', 'worker_redelivery'])
@pytest.mark.parametrize('reply_lost_after_commit', [False, True])
async def test_completed_reverse_recovers_settlement_without_repeating_analysis(
    accounts, reverse_video, monkeypatch, recovery, reply_lost_after_commit,
):
    from PIL import Image
    import credit_service
    from services import file_service, video_reverse_service

    frame = accounts.root / 'settlement-frame.jpg'
    Image.new('RGB', (8, 8), color='navy').save(frame)
    monkeypatch.setattr(file_service, 'STORAGE_ROOT', accounts.root / 'storage')
    extract = AsyncMock(return_value={index: [str(frame)] for index in range(3)})
    vision = AsyncMock(return_value=SimpleNamespace(content='{"description":"Persist this scene"}'))
    monkeypatch.setattr(video_reverse_service, 'extract_frames', extract)
    monkeypatch.setattr(video_reverse_service, 'generate_gemini_chat_result', vision)
    created = (await accounts.owner.client.post('/api/video-reverse/tasks', json=reverse_video.body)).json()
    path = '/api/video-reverse/tasks/' + created['reverse_task_id']
    task = await accounts.queue.dequeue(timeout=1)
    confirm = credit_service.confirm

    async def unavailable(*args, **kwargs):
        if reply_lost_after_commit:
            await confirm(*args, **kwargs)
        raise RuntimeError('Settlement unavailable; password=private-ledger-secret')

    monkeypatch.setattr(credit_service, 'confirm', unavailable)
    worker = OnlineProviderWorker('settlement-worker', accounts.queue.redis, accounts.queue)
    assert await worker._process_task(task) is True
    row = await VideoReverseTaskDAO.get(created['reverse_task_id'])
    assert row['status'] == 'completed' and not row['error_message']
    assert await accounts.db.fetchval('SELECT frozen_credits FROM credit_accounts WHERE owner_id=$1',
                                     accounts.owner.user_id) == (0 if reply_lost_after_commit else 20)
    original_segments = await VideoReverseSegmentDAO.list_for_task(created['reverse_task_id'])

    # A failed settlement is not a new generation and must never make a new freeze.
    monkeypatch.setattr(credit_service, 'confirm', confirm)
    if recovery == 'worker_redelivery':
        assert await worker._process_video_reverse_task(task) is True
        assert await accounts.db.fetchval('SELECT frozen_credits FROM credit_accounts WHERE owner_id=$1',
                                         accounts.owner.user_id) == 0
    for _ in range(2):
        assert (await accounts.owner.client.get(path)).status_code == 200
    balance = await accounts.db.fetchrow(
        'SELECT available_credits, frozen_credits, total_used_credits FROM credit_accounts WHERE owner_id=$1',
        accounts.owner.user_id,
    )
    assert dict(balance) == {'available_credits': 80, 'frozen_credits': 0, 'total_used_credits': 20}
    assert await accounts.db.fetchval('SELECT COUNT(*) FROM credit_freezes WHERE task_id=$1', task.task_id) == 1
    assert await accounts.db.fetchval(
        "SELECT COUNT(*) FROM credit_transactions WHERE task_id=$1 AND change_type='consume'", task.task_id,
    ) == 1
    assert await VideoReverseSegmentDAO.list_for_task(created['reverse_task_id']) == original_segments
    extract.assert_awaited_once()
    assert vision.await_count == 3


@pytest.mark.parametrize('response', ['', '{}', '[]', '{"description":"  "}'])
async def test_empty_vision_analysis_is_not_a_success(tmp_path, monkeypatch, response):
    from services import video_reverse_service

    frame = tmp_path / 'frame.jpg'
    frame.write_bytes(b'vision-edge-fixture')
    monkeypatch.setattr(video_reverse_service, 'generate_gemini_chat_result',
                        AsyncMock(return_value=SimpleNamespace(content=response)))
    with pytest.raises(RuntimeError, match='视频画面分析失败'):
        await video_reverse_service.analyze_segment_frames([str(frame)])


async def test_reverse_analysis_publication_rolls_back_partial_segment_writes(accounts, reverse_video):
    created = (await accounts.owner.client.post('/api/video-reverse/tasks', json=reverse_video.body)).json()
    reverse_id = created['reverse_task_id']
    await VideoReverseTaskDAO.update_results(reverse_id, overall_prompt_zh='Previous complete description')
    original = await VideoReverseSegmentDAO.create_many(reverse_id, [{'description': 'Original segment'}])
    with pytest.raises(ValueError):
        await VideoReverseTaskDAO.complete_analysis(
            reverse_id, created['task_id'], prompts={'overall_prompt_zh': 'New description'}, frame_file_ids=[],
            segments=[{'description': 'First new segment'}, {'start_seconds': 'invalid-second-segment'}],
        )
    saved = await VideoReverseTaskDAO.get(reverse_id)
    segments = await VideoReverseSegmentDAO.list_for_task(reverse_id)
    assert saved['overall_prompt_zh'] == 'Previous complete description' and saved['status'] == 'pending'
    assert [segment['segment_id'] for segment in segments] == [original[0]['segment_id']]


async def test_reverse_estimate_hides_internal_diagnostics(accounts, reverse_video, monkeypatch):
    import video_reverse_routes

    monkeypatch.setattr(video_reverse_routes.credit_service, 'estimate',
                        AsyncMock(side_effect=RuntimeError('password=private-database-credential')))
    response = await accounts.owner.client.post('/api/video-reverse/estimate', json={'video_file_id': reverse_video.file_id})
    assert response.status_code == 500
    assert 'private-database-credential' not in response.text


def test_public_video_reverse_routes_are_registered_once():
    from fastapi.routing import iter_route_contexts
    import public_main

    expected = {('POST', '/estimate'), ('POST', '/tasks'), ('GET', '/tasks'),
                ('GET', '/tasks/{reverse_task_id}'), ('POST', '/tasks/{reverse_task_id}/cancel'),
                ('POST', '/tasks/{reverse_task_id}/retry')}
    operations = [(method, route.path) for route in iter_route_contexts(public_main.app.routes)
                  for method in (getattr(route, 'methods', None) or set())]
    for method, suffix in expected:
        assert operations.count((method, '/api/video-reverse' + suffix)) == 1
