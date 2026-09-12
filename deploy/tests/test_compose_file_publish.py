import asyncio
import errno
from pathlib import Path

import pytest

from services import episode_compose_service as compose
from services.compose_error_service import public_compose_error


@pytest.mark.parametrize('cross_device', [False, True])
def test_publish_replaces_complete_bytes_and_cleans_staging(monkeypatch, tmp_path, cross_device):
    source, destination = tmp_path / 'scratch.mp4', tmp_path / 'final.mp4'
    source.write_bytes(b'new-result' * 200_000)
    expected = source.read_bytes()
    destination.write_bytes(b'previous-result')
    original_replace = compose.os.replace

    def replace(src, dst):
        if cross_device and Path(src) == source:
            raise OSError(errno.EXDEV, 'cross-device', str(src), None, str(dst))
        assert destination.read_bytes() == b'previous-result'
        return original_replace(src, dst)

    monkeypatch.setattr(compose.os, 'replace', replace)
    compose._replace_media_file(str(source), str(destination))
    assert destination.read_bytes() == expected
    assert not source.exists() and not list(tmp_path.glob('.compose-*'))


@pytest.mark.parametrize('failure', ['copy', 'publish', 'permission'])
def test_failed_publish_keeps_original_and_cleans_partial_copy(monkeypatch, tmp_path, failure):
    source, destination = tmp_path / 'scratch.mp4', tmp_path / 'final.mp4'
    source.write_bytes(b'new-result')
    destination.write_bytes(b'previous-result')

    def replace(src, dst):
        if Path(src) == source and failure != 'permission':
            raise OSError(errno.EXDEV, 'cross-device')
        raise PermissionError(errno.EACCES, 'denied')

    def partial_copy(_source, target, **_kwargs):
        target.write(b'partial')
        raise OSError(errno.ENOSPC, 'full')

    monkeypatch.setattr(compose.os, 'replace', replace)
    if failure == 'copy': monkeypatch.setattr(compose.shutil, 'copyfileobj', partial_copy)
    with pytest.raises(OSError): compose._replace_media_file(str(source), str(destination))
    assert source.read_bytes() == b'new-result'
    assert destination.read_bytes() == b'previous-result'
    assert not list(tmp_path.glob('.compose-*'))


@pytest.mark.asyncio
async def test_failed_jobs_and_legacy_status_never_expose_internal_paths(monkeypatch):
    episode_id = 'compose-error-test'
    async def fail(*_args):
        raise OSError(errno.EXDEV, 'cross-device', '/tmp/private/movie.mp4', None, '/app/private/result.mp4')
    monkeypatch.setattr(compose, '_compose', fail)
    monkeypatch.setattr(compose, '_jobs', {})
    compose.start_compose(episode_id, 'user', 'project')
    await asyncio.sleep(0)
    status = compose.get_status(episode_id)
    assert status['status'] == 'failed'
    assert status['error'] == '成片保存失败，请稍后重试；若仍失败，请联系管理员。'
    compose._jobs[episode_id]['error'] = "[Errno 18] '/tmp/private/source' -> '/app/private/destination'"
    assert '/tmp' not in compose.get_status(episode_id)['error']


@pytest.mark.parametrize('error', [
    RuntimeError('Subtitle burn-in failed: /private/font.ttf'),
    RuntimeError('时间线片段 /private/movie.mp4 超出源视频时长'),
    RuntimeError(r'Could not open C:\private\movie.mp4'),
    RuntimeError('https://internal.example/path?token=secret'),
    OSError(errno.ENOSPC, 'disk full', '/private/destination'),
])
def test_public_errors_are_static_and_keep_diagnostics_out_of_response(error):
    message = public_compose_error(error)
    assert not any(marker in message for marker in ('/', '\\', 'private', 'secret', 'Errno'))
    assert public_compose_error(message) == message


@pytest.mark.asyncio
async def test_preflight_response_hides_paths_but_keeps_project_authorization(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from routers import episode_video
    access = AsyncMock()
    monkeypatch.setattr(episode_video, 'preflight_episode_compose', AsyncMock(side_effect=RuntimeError('时间线片段 /private/source.mp4 超出源视频时长')))
    app = FastAPI()
    app.include_router(episode_video.create_episode_video_router(
        get_current_user_dependency=lambda: 'user', video_segment_dao=SimpleNamespace(),
        episode_dao=SimpleNamespace(get_project_id=AsyncMock(return_value='project')), project_access_checker=access))
    async with AsyncClient(transport=ASGITransport(app=app), base_url='https://test') as client:
        response = await client.post('/api/episodes/episode/compose/preflight', json={'timeline': []})
    assert response.status_code == 422
    assert response.json()['detail'] == '裁剪范围超出视频时长，请调整片段长度后重试。'
    access.assert_awaited_once_with('project', 'user', 'member')
