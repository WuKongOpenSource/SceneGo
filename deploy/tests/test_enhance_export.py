import pytest
from utils.enhance_export import plan_export, apply_audio_edits


def fixture():
    segments = [{'segment_id': str(i), 'storyboard_item_id': f'sb{i}', 'video_url': f'/storage/old{i}.mp4', 'duration_ms': 5000} for i in range(9)]
    groups = [{'uuid': str(i), 'videoSegmentId': str(i)} for i in (4, 0, 1, 7, 8)]
    session = {'task_groups': groups, 'tasks_status': {g['uuid']: {'result': f"https://example.test/storage/new{g['uuid']}.mp4"} for g in groups}}
    files = [{'entity_id': str(i), 'file_id': f'f{i}', 'file_url': f'/storage/new{i}.mp4', 'duration_seconds': 6} for i in range(9)]
    return session, segments, files


def test_export_uses_five_current_cards_in_order_not_nine_historical_segments():
    session, segments, files = fixture()
    old = [{'kind': 'video', 'sourceId': str(i), 'clipId': str(i), 'durationMs': 5000} for i in range(9)]
    music = {'kind': 'audio', 'sourceId': 'aud_track_m', 'startMs': 36000, 'volume': 0.12}
    selected, items = plan_export(session, segments, files, old + [music, {'kind': 'subtitle', 'text': 'manual'}])
    assert [s['segment_id'] for s in selected] == ['4', '0', '1', '7', '8']
    assert [s['file_id'] for s in selected] == ['f4', 'f0', 'f1', 'f7', 'f8']
    assert [i['sourceId'] for i in items if i['kind'] == 'video'] == ['4', '0', '1', '7', '8']
    assert {i['sourceId'] for i in items if i['kind'] == 'excluded_video'} == {'2', '3', '5', '6'}
    assert music in items and items[-1]['text'] == 'manual'
    assert len(segments) == 9 and len(files) == 9


@pytest.mark.parametrize('problem', ['deleted', 'foreign', 'ambiguous', 'missing'])
def test_export_fails_closed_for_invalid_selected_files_or_associations(problem):
    session, segments, files = fixture()
    if problem == 'deleted': files[4]['is_deleted'] = True
    if problem == 'foreign': files[4]['entity_id'] = 'outside_episode'
    if problem == 'ambiguous': session['task_groups'][0]['videoSegmentId'] = 'missing'
    if problem == 'missing': files.pop(4)
    with pytest.raises(ValueError): plan_export(session, segments, files, [])


def test_composition_uses_editor_music_edits_not_stale_audio_track_defaults():
    rows = [{'track_id': 'm', 'generation_params': {'timeline': {'startMs': 0, 'volume': 0.35}}}, {'track_id': 'deleted'}, {'track_id': 'new'}]
    items = [{'kind': 'audio_sources', 'sourceIds': ['aud_track_m', 'aud_track_deleted']},
             {'kind': 'audio', 'sourceId': 'aud_track_m', 'startMs': 36000, 'durationMs': 19000, 'sourceOffsetMs': 2000, 'volume': 0}]
    result = apply_audio_edits(rows, items)
    assert [r['track_id'] for r in result] == ['m', 'new']
    assert result[0]['generation_params']['timeline'] == {'startMs': 36000, 'durationMs': 19000, 'sourceOffsetMs': 2000, 'volume': 0, 'fadeInMs': 0, 'fadeOutMs': 0}


@pytest.mark.asyncio
async def test_export_route_checks_membership_before_reading_private_workspace(monkeypatch):
    from routers import episode_video
    from services.project_access_service import ProjectAccessDenied
    calls = []
    class Episode:
        async def get_project_id(_): return 'project'
    async def deny(*args): raise ProjectAccessDenied('denied')
    async def export(*args): calls.append(args)
    monkeypatch.setattr(episode_video.EnhanceExportDAO, 'export', export)
    router = episode_video.create_episode_video_router(get_current_user_dependency=lambda: 'user',
        video_segment_dao=None, episode_dao=Episode, project_access_checker=deny)
    endpoint = next(r.endpoint for r in router.routes if r.path.endswith('/export-enhance'))
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as error: await endpoint('ep', 'outsider')
    assert error.value.status_code == 404 and calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize('invalid', [False, True])
@pytest.mark.parametrize('probe', ['none', 'success', 'failure'])
async def test_export_dao_commits_selection_and_timeline_together_or_writes_nothing(monkeypatch, invalid, probe):
    from dao.creative import enhance_export
    session, segments, files = fixture()
    if invalid: files.pop(4)
    writes, transactions = [], []
    class Context:
        async def __aenter__(self): return conn
        async def __aexit__(self, kind, *_): transactions.append(kind)
    class Connection:
        def transaction(self): return Context()
        async def fetchrow(self, *_): return {'episode_id': 'ep'}
        async def fetchval(self, query, key):
            assert key == 'workspace_session_owner_ep'
            return session
        async def fetch(self, query, *_):
            if 'FROM storyboard_items' in query: return []
            if 'SELECT * FROM video_segments' in query: return segments
            if 'SELECT f.*' in query: return files
            return [{'track_id': 'timeline', 'items': []}]
        async def execute(self, *args): writes.append(args)
    conn = Connection()
    class Database:
        def acquire(self): return Context()
    monkeypatch.setattr(enhance_export, 'get_db_manager', lambda: Database())
    async def resolve_duration(record):
        if probe == 'failure': raise ValueError('unreadable source')
        return 12074
    kwargs = {} if probe == 'none' else {'resolve_duration': resolve_duration}
    if invalid or probe == 'failure':
        with pytest.raises(ValueError): await enhance_export.EnhanceExportDAO.export('ep', 'owner', **kwargs)
        assert writes == [] and ValueError in transactions
    else:
        result = await enhance_export.EnhanceExportDAO.export('ep', 'owner', **kwargs)
        assert result['segment_ids'] == ['4', '0', '1', '7', '8']
        assert len(writes) == (16 if probe == 'success' else 11) and all(kind is None for kind in transactions)
        if probe == 'success':
            assert next(w for w in writes if w[0].startswith('UPDATE files SET duration_seconds'))[2] == 12.074
        assert 'timeline_tracks' in writes[-1][0]
