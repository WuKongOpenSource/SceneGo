import hashlib
import io
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from PIL import Image

from services import jimeng_media_service as media
from services import jimeng_result_service as output
from services.jimeng_contract import JimengError


def payload(kind='image'):
    return {'task_type': 'jimeng_multimodal', 'model': 'JimengSeedance2', 'prompt': 'authorized video',
            'duration': 5, 'media_inputs': [{'kind': kind, 'file_id': 'file_original'}]}


@pytest.mark.asyncio
async def test_original_bytes_and_sha_survive_with_thumbnail_present(monkeypatch, tmp_path):
    buffer = io.BytesIO()
    Image.new('RGB', (40, 50), 'red').save(buffer, format='PNG')
    original = buffer.getvalue()
    record = {'file_id': 'file_original', 'file_name': 'original.png',
              'file_path': 'private-original-path', 'thumbnail_url': '/small-thumbnail.jpg'}
    access = AsyncMock()
    monkeypatch.setattr(media, 'require_generation_request_access', access)
    monkeypatch.setattr(media, 'resolve_media_file_record', AsyncMock(return_value=record))
    read = Mock(return_value=original)
    monkeypatch.setattr(media, '_read_local_record', read)
    trace = await media.inspect_inputs(payload(), 'owner', file_dao=object(), directory=tmp_path)
    assert Path(trace[0]['path']).read_bytes() == original
    assert trace[0]['sha256'] == hashlib.sha256(original).hexdigest()
    assert read.call_args.args[0] == record
    assert not any('path' in entry for entry in media.trace_inputs(trace))
    access.assert_awaited_once()


@pytest.mark.asyncio
async def test_unauthorized_reference_never_read_or_sent(monkeypatch, tmp_path):
    from services.generation_access_service import GenerationAccessDenied
    monkeypatch.setattr(media, 'require_generation_request_access', AsyncMock(side_effect=GenerationAccessDenied()))
    read = Mock()
    monkeypatch.setattr(media, '_read_local_record', read)
    with pytest.raises(GenerationAccessDenied):
        await media.inspect_inputs(payload(), 'wrong-user', file_dao=object(), directory=tmp_path)
    read.assert_not_called()


@pytest.mark.asyncio
async def test_unregistered_external_reference_is_not_downloaded(monkeypatch, tmp_path):
    monkeypatch.setattr(media, 'require_generation_request_access', AsyncMock())
    monkeypatch.setattr(media, 'resolve_media_file_record', AsyncMock(return_value=None))
    data = payload()
    data['media_inputs'] = [{'kind': 'image', 'url': 'https://example.test/external.png'}]
    with pytest.raises(JimengError, match='已上传原素材'):
        await media.inspect_inputs(data, 'user', file_dao=object(), directory=tmp_path)


@pytest.mark.asyncio
@pytest.mark.parametrize('durations', [[1.9], [15.1], [8.0, 8.0]])
async def test_actual_video_durations_validated_not_client_hint(monkeypatch, tmp_path, durations):
    monkeypatch.setattr(media, 'require_generation_request_access', AsyncMock())
    monkeypatch.setattr(media, 'resolve_media_file_record', AsyncMock(return_value={'file_id': 'file_v', 'file_name': 'original.mp4'}))
    monkeypatch.setattr(media, '_read_local_record', Mock(return_value=b'original-video'))
    monkeypatch.setattr(media, 'probe_media', Mock(side_effect=[{'duration_seconds': d} for d in durations]))
    data = payload('video')
    data['media_inputs'] = [{'kind': 'video', 'file_id': 'file_v', 'duration_seconds': 2}] * len(durations)
    with pytest.raises(JimengError):
        await media.inspect_inputs(data, 'user', file_dao=object(), directory=tmp_path)


def test_downloaded_file_uses_real_probe_not_provider_metadata(monkeypatch, tmp_path):
    file = tmp_path / 'result.mp4'
    file.write_bytes(b'real-file-bytes')
    monkeypatch.setattr(output, 'probe_media', Mock(return_value={'duration_seconds': 5.088, 'streams': [
        {'width': 1280, 'height': 720, 'codec_name': 'h264', 'avg_frame_rate': '60/1'}]}))
    response = {'result_json': {'videos': [{'path': str(file), 'fps': 24, 'duration': 5.042}]}}
    path, metadata = output.inspect_result(response, tmp_path, 5)
    assert path == file and metadata['duration_seconds'] == 5.088 and metadata['frame_rate'] == '60/1'


@pytest.mark.parametrize('value', ['https://example.test/result.mp4', '../other.mp4'])
def test_remote_or_traversal_result_not_accepted(tmp_path, value):
    with pytest.raises(JimengError):
        output.inspect_result({'result_json': {'videos': [{'path': value}]}}, tmp_path, 5)


def test_download_path_outside_task_is_rejected(tmp_path):
    directory = tmp_path / 'job'
    directory.mkdir()
    other = tmp_path / 'other.mp4'
    other.write_bytes(b'bytes')
    with pytest.raises(JimengError):
        output.inspect_result({'result_json': {'videos': [{'path': str(other)}]}}, directory, 5)
def test_real_local_media_probe_is_authoritative(tmp_path):
    import shutil
    import subprocess
    from services.jimeng_result_service import inspect_result
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        pytest.skip('Real media probe requires ffmpeg and ffprobe; run in isolated runtime container')
    target = tmp_path / 'result.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=1280x720:r=24',
                    '-frames:v', '96', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
                    str(target)], check=True, capture_output=True, timeout=30)
    path, result = inspect_result({'result_json': {'videos': [{'path': str(target), 'fps': 60, 'duration': 99}]}}, tmp_path, 4)
    assert path == target
    assert result['duration_seconds'] == pytest.approx(4, abs=0.05)
    assert result['frame_rate'] == '24/1' and result['width'] == 1280 and result['height'] == 720
