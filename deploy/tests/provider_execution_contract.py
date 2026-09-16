"""Provider behavior exercised by both online-only and mixed workers.

Concrete suites supply worker_type and task_type. Provider calls, queue writes,
and media persistence are mocked here; no worker loop or external service starts.
Keep assertions shared so neither distribution silently loses failure coverage.
"""
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest
import requests

from core.online_provider_tasks import FileDAO
from schemas.generation import GenerateRequest


class ProviderWorkerFixture:
    @pytest.fixture
    def mock_worker(self):
        worker = self.worker_type.__new__(self.worker_type)
        worker.task_queue = MagicMock()
        worker.task_queue.update_progress = AsyncMock()
        worker.task_queue.complete_task = AsyncMock()
        worker.task_queue.fail_task = AsyncMock()
        return worker


class ProviderTtsContract(ProviderWorkerFixture):
    async def test_process_minimax_tts_happy_path(self, mock_worker, tmp_path):
        task = self.task_type(
            task_id='uuid-1',
            task_type='minimax_tts',
            data={
                'text': '你好世界',
                'voice_id': 'female-shaonv',
                'model': 'speech-2.8-hd',
                'speed': 1.0, 'pitch': 0, 'emotion': None,
                'entity_type': 'storyboard_item',
                'entity_id': 'item-1',
                'file_role': 'dialogue_audio',
                'episode_id': 'ep-1',
            },
            priority=2, user_id='u1',
        )
        fake_audio = b'ID3' + b'\x00' * 1024
        fake_audio_path = tmp_path / 'tts_abc12345.mp3'
        fake_audio_path.write_bytes(fake_audio)

        with patch('core.online_provider_tasks.get_minimax_audio_client') as mc, \
             patch('core.online_provider_tasks.save_generated_file_to_db', new=AsyncMock(return_value={
                'file_id': 'fid-1', 'file_url': '/storage/audio/tts_abc12345.mp3'
             })):
            client = mc.return_value
            client.tts_async = AsyncMock(return_value={'task_id': 'mx-1'})
            client.tts_wait_and_download = AsyncMock(return_value={
                'audio_url': str(fake_audio_path),
                'duration_ms': 1500,
            })

            client.tts_sync = AsyncMock(return_value={
                'audio_url': '/storage/audio/tts_abc12345.mp3',
                'local_path': str(fake_audio_path),
                'audio_bytes': fake_audio,
                'duration_ms': 1500,
                'trace_id': 'trace-xyz-1',
                'mime': 'audio/mpeg',
            })
            ok = await mock_worker._process_minimax_tts_task(task)

        assert ok is True
        mock_worker.task_queue.complete_task.assert_awaited_once()
        completed_result = mock_worker.task_queue.complete_task.call_args[0][1]
        assert completed_result['file_id'] == 'fid-1'
        assert completed_result['file_url'] == '/storage/audio/tts_abc12345.mp3'
        assert completed_result['duration_ms'] == 1500
        client.tts_sync.assert_awaited_once()
        assert client.tts_async.await_count == 0
        assert client.tts_wait_and_download.await_count == 0

    async def test_process_minimax_tts_writes_back_sample_audio_url(self, mock_worker, tmp_path):

        task = self.task_type(
            task_id='uuid-2', task_type='minimax_tts',
            data={
                'text': '试听文本', 'voice_id': 'female-shaonv',
                'bind_to_character_voice_id': 'cv-99',
            },
            priority=2, user_id='u1',
        )
        fake_audio = b'ID3' + b'\x00' * 100
        fake_audio_path = tmp_path / 'tts_xyz.mp3'
        fake_audio_path.write_bytes(fake_audio)

        with patch('core.online_provider_tasks.get_minimax_audio_client') as mc, \
             patch('core.online_provider_tasks.save_generated_file_to_db', new=AsyncMock(return_value={
                'file_id': 'fid-2', 'file_url': '/storage/audio/tts_xyz.mp3'
             })), \
             patch('core.online_provider_tasks.CharacterVoiceDAO.update_sample_audio_url', new=AsyncMock()) as upd:
            client = mc.return_value
            client.tts_async = AsyncMock(return_value={'task_id': 'mx-2'})
            client.tts_wait_and_download = AsyncMock(return_value={
                'audio_url': str(fake_audio_path), 'duration_ms': 2000,
            })

            client.tts_sync = AsyncMock(return_value={
                'audio_url': '/storage/audio/tts_xyz.mp3',
                'local_path': str(fake_audio_path),
                'audio_bytes': fake_audio,
                'duration_ms': 2000,
                'trace_id': 'trace-xyz-2',
                'mime': 'audio/mpeg',
            })
            await mock_worker._process_minimax_tts_task(task)

        upd.assert_awaited_once_with('cv-99', '/storage/audio/tts_xyz.mp3')
        client.tts_sync.assert_awaited_once()
        assert client.tts_async.await_count == 0
        assert client.tts_wait_and_download.await_count == 0

    async def test_process_minimax_tts_failure_calls_fail_task(self, mock_worker):

        task = self.task_type(
            task_id='uuid-3', task_type='minimax_tts',
            data={'text': 'x', 'voice_id': 'female-shaonv'},
            priority=2, user_id='u1',
        )
        with patch('core.online_provider_tasks.get_minimax_audio_client') as mc:
            client = mc.return_value
            client.tts_async = AsyncMock(return_value={'task_id': 'mx-3'})
            client.tts_wait_and_download = AsyncMock()
            client.tts_sync = AsyncMock(
                side_effect=RuntimeError('tts_sync 失败: status_code=1004')
            )
            ok = await mock_worker._process_minimax_tts_task(task)

        assert ok is False
        mock_worker.task_queue.fail_task.assert_awaited_once()
        err_msg = mock_worker.task_queue.fail_task.call_args[0][1]
        assert 'MiniMax TTS' in err_msg
        assert 'Key' in err_msg
        mock_worker.task_queue.complete_task.assert_not_awaited()
        client.tts_sync.assert_awaited_once()
        assert client.tts_async.await_count == 0
        assert client.tts_wait_and_download.await_count == 0

    async def test_process_minimax_tts_rejects_oversized_provider_bytes_before_save(self,
        mock_worker,
        monkeypatch,
    ):
        """Provider bytes above the configured ceiling must never reach persistence."""
        monkeypatch.setenv('MAX_PROVIDER_AUDIO_OUTPUT_BYTES', '3')
        task = self.task_type(
            task_id='uuid-oversized',
            task_type='minimax_tts',
            data={'text': 'x', 'voice_id': 'female-shaonv'},
            priority=2,
            user_id='u1',
        )
        save_file = AsyncMock()
        with patch('core.online_provider_tasks.get_minimax_audio_client') as mc, \
             patch('core.online_provider_tasks.save_generated_file_to_db', new=save_file):
            client = mc.return_value
            client.tts_sync = AsyncMock(return_value={
                'audio_url': '/storage/audio/too-large.mp3',
                'audio_bytes': b'ID34',
                'duration_ms': 100,
                'trace_id': 'trace-too-large',
                'mime': 'audio/mpeg',
            })
            ok = await mock_worker._process_minimax_tts_task(task)

        assert ok is False
        mock_worker.task_queue.fail_task.assert_awaited_once()
        mock_worker.task_queue.complete_task.assert_not_awaited()
        save_file.assert_not_awaited()



def _http_error(status_code: int, body: str = "") -> requests.HTTPError:

    response = requests.Response()
    response.status_code = status_code
    response._content = body.encode("utf-8")
    err = requests.HTTPError(f"{status_code} Client Error")
    err.response = response
    return err


class ProviderFailureContract(ProviderWorkerFixture):
    async def test_minimax_task_401_fails_without_retry(self, mock_worker):
        task = self.task_type(task_id='m-1', task_type='minimax_i2v', data={'first_frame_image': 'fake-id'}, priority=2, user_id='u1')
        fake_client = MagicMock()
        fake_client.generate_video = MagicMock(side_effect=_http_error(401, '{"error": "unauthorized"}'))

        with patch('minimax_api.get_minimax_client', return_value=fake_client), \
             patch.object(mock_worker, '_file_id_to_dashscope_url', AsyncMock(return_value='data:image/png;base64,AAA')):
            ok = await mock_worker._process_minimax_task(task)
        assert ok is False
        mock_worker.task_queue.fail_task.assert_awaited_once()
        args = mock_worker.task_queue.fail_task.call_args[0]
        kwargs = mock_worker.task_queue.fail_task.call_args[1]
        assert args[0] == 'm-1'
        assert kwargs['retry'] is False
        assert 'MiniMax' in args[1]

    async def test_sora2_task_401_fails_without_retry(self, mock_worker, tmp_path):
        task = self.task_type(task_id='s-1', task_type='sora2_i2v', data={'image_path': 'fake-id'}, priority=2, user_id='u1')
        fake_client = MagicMock()
        fake_client.create_video_task = MagicMock(side_effect=_http_error(401, 'Unauthorized'))

        tmp_img = tmp_path / 'src.png'
        tmp_img.write_bytes(b'fake-image-bytes')
        with patch('sora2_api.get_sora2_client', return_value=fake_client), \
             patch.object(mock_worker, '_download_image_to_temp', AsyncMock(return_value=str(tmp_img))):
            ok = await mock_worker._process_sora2_task(task)
        assert ok is False
        args = mock_worker.task_queue.fail_task.call_args[0]
        kwargs = mock_worker.task_queue.fail_task.call_args[1]
        assert args[0] == 's-1'
        assert kwargs['retry'] is False
        assert 'Sora2' in args[1]

    async def test_veo_task_401_fails_without_retry(self, mock_worker, tmp_path):
        task = self.task_type(task_id='v-1', task_type='veo_i2v', data={'image_path': 'fake-id'}, priority=2, user_id='u1')
        fake_client = MagicMock()
        fake_client.create_video_task = MagicMock(side_effect=_http_error(401, 'Unauthorized'))
        tmp_img = tmp_path / 'src.png'
        tmp_img.write_bytes(b'fake-image-bytes')
        with patch('veo_api.get_veo_client', return_value=fake_client), \
             patch.object(mock_worker, '_download_image_to_temp', AsyncMock(return_value=str(tmp_img))):
            ok = await mock_worker._process_veo_task(task)
        assert ok is False
        args = mock_worker.task_queue.fail_task.call_args[0]
        kwargs = mock_worker.task_queue.fail_task.call_args[1]
        assert args[0] == 'v-1'
        assert kwargs['retry'] is False
        assert 'Veo' in args[1]

    async def test_sora2_persistence_failure_is_reported_instead_of_fake_temp_success(self, mock_worker, tmp_path):
        task = self.task_type(task_id='s-persist', task_type='sora2_i2v', data={'image_path': 'fake-id'}, priority=2, user_id='u1')
        fake_client = MagicMock()
        fake_client.create_video_task.return_value = {'id': 'remote-sora'}
        fake_client.query_task.return_value = {'status': 'completed', 'progress': 100}
        fake_client.download_video.return_value = b'video-bytes'
        tmp_img = tmp_path / 'src.png'
        tmp_img.write_bytes(b'fake-image-bytes')

        with patch('sora2_api.get_sora2_client', return_value=fake_client), \
             patch.object(mock_worker, '_download_image_to_temp', AsyncMock(return_value=str(tmp_img))), \
             patch.object(mock_worker, '_save_external_video', AsyncMock(return_value=None)):
            ok = await mock_worker._process_sora2_task(task)

        assert ok is False
        mock_worker.task_queue.complete_task.assert_not_awaited()
        mock_worker.task_queue.fail_task.assert_awaited_once()
        assert '持久化失败' in mock_worker.task_queue.fail_task.await_args.args[1]

    async def test_veo_persistence_failure_is_reported_instead_of_fake_temp_success(self, mock_worker, tmp_path):
        task = self.task_type(task_id='v-persist', task_type='veo_i2v', data={'image_path': 'fake-id'}, priority=2, user_id='u1')
        fake_client = MagicMock()
        fake_client.create_video_task.return_value = {'id': 'remote-veo'}
        fake_client.query_task.return_value = {'status': 'completed'}
        fake_client.get_video_content.return_value = {'url': 'https://media.example.test/video.mp4'}
        fake_client.download_video.return_value = b'video-bytes'
        tmp_img = tmp_path / 'src.png'
        tmp_img.write_bytes(b'fake-image-bytes')

        with patch('veo_api.get_veo_client', return_value=fake_client), \
             patch.object(mock_worker, '_download_image_to_temp', AsyncMock(return_value=str(tmp_img))), \
             patch.object(mock_worker, '_save_external_video', AsyncMock(return_value=None)):
            ok = await mock_worker._process_veo_task(task)

        assert ok is False
        mock_worker.task_queue.complete_task.assert_not_awaited()
        mock_worker.task_queue.fail_task.assert_awaited_once()
        assert '持久化失败' in mock_worker.task_queue.fail_task.await_args.args[1]

    async def test_wan26_task_invalid_api_key_fails_without_retry(self, mock_worker, tmp_path):
        """Wan2.6 resolves a guarded image input before provider submission."""
        task = self.task_type(task_id='w-1', task_type='wan26_i2v', data={'image_path': 'fake-id'}, priority=2, user_id='u1')
        fake_client = MagicMock()
        fake_client.create_video_task = MagicMock(side_effect=RuntimeError('Wan2.6 失败: code=InvalidApiKey'))
        with patch('wan2_dashscope_api.get_wan26_client', return_value=fake_client), \
             patch.object(mock_worker, '_file_id_to_dashscope_url', AsyncMock(return_value='data:image/png;base64,AAA')):
            ok = await mock_worker._process_wan26_task(task)
        assert ok is False
        args = mock_worker.task_queue.fail_task.call_args[0]
        kwargs = mock_worker.task_queue.fail_task.call_args[1]
        assert args[0] == 'w-1'
        assert kwargs['retry'] is False
        assert 'Wan2.6' in args[1]

    async def test_minimax_tts_network_error_still_retries(self, mock_worker):

        task = self.task_type(task_id='t-2', task_type='minimax_tts', data={'text': 'hi', 'voice_id': 'female-shaonv'}, priority=2, user_id='u1')
        fake_client = MagicMock()
        fake_client.tts_sync = AsyncMock(side_effect=RuntimeError('tts_sync 失败: consecutive 3 network errors last_err=Timeout'))
        with patch('core.online_provider_tasks.get_minimax_audio_client', return_value=fake_client):
            ok = await mock_worker._process_minimax_tts_task(task)
        assert ok is False
        kwargs = mock_worker.task_queue.fail_task.call_args[1]
        assert kwargs['retry'] is True

    async def test_minimax_tts_business_code_1004_fails_without_retry(self, mock_worker):

        task = self.task_type(task_id='t-1', task_type='minimax_tts', data={'text': 'hi', 'voice_id': 'female-shaonv'}, priority=2, user_id='u1')
        fake_client = MagicMock()
        fake_client.tts_sync = AsyncMock(side_effect=RuntimeError('tts_sync 失败: status_code=1004 msg=insufficient balance'))
        with patch('core.online_provider_tasks.get_minimax_audio_client', return_value=fake_client):
            ok = await mock_worker._process_minimax_tts_task(task)
        assert ok is False
        args = mock_worker.task_queue.fail_task.call_args[0]
        kwargs = mock_worker.task_queue.fail_task.call_args[1]
        assert args[0] == 't-1'
        assert kwargs['retry'] is False
        assert 'TTS' in args[1] or 'MiniMax' in args[1]

    async def test_minimax_terminal_failed_status_fails_without_retry(self, mock_worker):
        task = self.task_type(
            task_id='m-2',
            task_type='minimax_i2v',
            data={'first_frame_image': 'fake-id', 'prompt': 'hello'},
            priority=2,
            user_id='u1',
        )
        fake_client = MagicMock()
        fake_client.generate_video = MagicMock(return_value={'task_id': 'remote-1'})
        fake_client.query_task = MagicMock(return_value={
            'status': 'failed',
            'base_resp': {'status_msg': 'insufficient balance'},
        })
        with patch('minimax_api.get_minimax_client', return_value=fake_client), \
             patch.object(mock_worker, '_file_id_to_dashscope_url', AsyncMock(return_value='data:image/png;base64,AAA')):
            ok = await mock_worker._process_minimax_task(task)
        assert ok is False
        args = mock_worker.task_queue.fail_task.call_args[0]
        kwargs = mock_worker.task_queue.fail_task.call_args[1]
        assert args[0] == 'm-2'
        assert kwargs['retry'] is False

    async def test_minimax_task_uses_model_name_duration_and_success_status(self, mock_worker):
        task = self.task_type(
            task_id='m-3',
            task_type='minimax_i2v',
            data={
                'first_frame_image': 'https://cdn.example.test/frame.png',
                'prompt': 'hello',
                'model_name': 'MiniMax-Hailuo-2.3-Fast',
                'duration': 10,
                'minimax_resolution': '768P',
                'minimax_prompt_optimizer': False,
            },
            priority=2,
            user_id='u1',
        )
        fake_client = MagicMock()
        fake_client.generate_video = MagicMock(return_value={'task_id': 'remote-3'})
        fake_client.query_task = MagicMock(return_value={'status': 'Success', 'file_id': 'file-3'})
        fake_client.download_video = MagicMock(return_value=b'video-bytes')
        mock_worker._save_external_video = AsyncMock(return_value={'url': '/videos/minimax.mp4'})

        with patch('minimax_api.get_minimax_client', return_value=fake_client), \
             patch.object(mock_worker, '_file_id_to_dashscope_url', AsyncMock(return_value='data:image/png;base64,AAA')):
            ok = await mock_worker._process_minimax_task(task)

        assert ok is True
        _, kwargs = fake_client.generate_video.call_args
        assert kwargs['first_frame_image'] == 'data:image/png;base64,AAA'
        assert kwargs['model'] == 'MiniMax-Hailuo-2.3-Fast'
        assert kwargs['duration'] == 10
        assert kwargs['resolution'] == '768P'
        assert kwargs['prompt_optimizer'] is False
        fake_client.query_task.assert_called_once_with('remote-3')
        fake_client.download_video.assert_called_once_with('file-3')
        mock_worker.task_queue.complete_task.assert_awaited_once()

    async def test_external_minimax_video_persists_model_and_requested_duration(self, mock_worker, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        task = self.task_type(
            task_id='m-save-6',
            task_type='minimax_i2v',
            data={
                'entity_type': 'video_segment',
                'entity_id': 'seg-6',
                'file_role': 'video',
                'episode_id': 'ep-1',
                'model': 'Wan2',  # legacy generic-schema contamination
                'duration': 6,
            },
            priority=2,
            user_id='u1',
        )
        fake_file_record = {'file_id': 'file-6', 'user_id': 'u1', 'file_type': 'video'}

        with patch('core.online_provider_tasks.DB_AVAILABLE', True), \
             patch('core.online_provider_tasks.FileDAO') as fake_file_dao, \
             patch('file_optimization.FileOptimizationService._probe_video_duration', return_value=None), \
             patch('file_optimization.FileOptimizationService.create_video_thumbnail', new=AsyncMock(return_value={'success': False})), \
             patch('file_service._sync_legacy_on_file_create', new=AsyncMock()), \
             patch('dao.creative.video_segment.VideoSegmentDAO.update', new=AsyncMock()) as update_segment, \
             patch('media_library_service.create_from_file', new=AsyncMock()):
            fake_file_dao.create_file = AsyncMock(return_value=fake_file_record)
            saved = await mock_worker._save_external_video(b'video-bytes', task, 'minimax')

        create_kwargs = fake_file_dao.create_file.await_args.kwargs
        assert create_kwargs['metadata']['model'] == 'MINI'
        assert create_kwargs['metadata']['duration_seconds'] == 6
        update_segment.assert_awaited_once_with(
            'seg-6',
            video_url=saved['url'],
            model='MINI',
            duration_ms=6000,
            task_id='m-save-6',
            status='completed',
        )
        assert saved['duration_seconds'] == 6
        assert saved['duration_ms'] == 6000
        assert saved['model'] == 'MINI'

    async def test_external_video_database_failure_does_not_return_fake_success(self, mock_worker, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        task = self.task_type(
            task_id='persist-failure',
            task_type='seedance_i2v',
            data={'duration': 5},
            priority=2,
            user_id='u1',
        )

        with patch('core.online_provider_tasks.DB_AVAILABLE', True), \
             patch('core.online_provider_tasks.FileDAO') as fake_file_dao, \
             patch('file_optimization.FileOptimizationService._probe_video_duration', return_value=None):
            fake_file_dao.create_file = AsyncMock(side_effect=RuntimeError('database unavailable'))
            saved = await mock_worker._save_external_video(b'video-bytes', task, 'seedance')

        assert saved is None
        assert list(tmp_path.rglob('*.mp4')) == []

    async def test_dashscope_result_uses_bounded_public_video_downloader(self, mock_worker):
        task = self.task_type(
            task_id='ds-download',
            task_type='kling_t2v',
            data={'prompt': 'hello', 'duration': 5},
            priority=2,
            user_id='u1',
        )
        fake_client = MagicMock()
        fake_client.kling_submit = AsyncMock(
            return_value={'output': {'task_id': 'remote-ds'}}
        )
        fake_client.query_task = AsyncMock(
            return_value={'output': {'task_status': 'SUCCEEDED'}}
        )
        fake_client.extract_video_url.return_value = 'https://media.example.invalid/result.mp4'
        mock_worker._save_external_video = AsyncMock(return_value={'url': '/storage/video/result.mp4'})

        with patch('dashscope_video_api.get_dashscope_video_client', return_value=fake_client), \
             patch('external_api.video.base.download_streaming_video', return_value=b'bounded-video') as download:
            ok = await mock_worker._process_dashscope_video_task(task)

        assert ok is True
        download.assert_called_once_with(
            'https://media.example.invalid/result.mp4',
            logger=__import__('logging').getLogger('core.online_provider_tasks'),
            label='DashScope kling video',
        )
        mock_worker._save_external_video.assert_awaited_once()

    async def test_seedance_resolves_each_media_kind_through_guarded_policy(self, mock_worker):
        task = self.task_type(
            task_id='seedance-inputs',
            task_type='seedance_multi',
            data={
                'prompt': 'hello',
                'sub_model': 'standard',
                'media_inputs': [
                    {'kind': 'image', 'file_id': 'image-1'},
                    {'kind': 'video', 'file_id': 'video-1'},
                    {'kind': 'audio', 'file_id': 'audio-1'},
                ],
            },
            priority=2,
            user_id='u1',
        )
        fake_client = MagicMock()
        fake_client.create_video_task.return_value = 'ark-task'
        fake_client.query_task.return_value = {
            'status': 'succeeded',
            'content': {'video_url': 'https://media.example.invalid/output.mp4'},
        }
        fake_client.download_video.return_value = b'video'
        mock_worker._provider_media_reference = AsyncMock(
            side_effect=lambda ref, *, media_kind, **kwargs: f'data:{media_kind}/test;base64,{ref}'
        )
        mock_worker._save_external_video = AsyncMock(return_value={'url': '/storage/video/output.mp4'})

        with patch('seedance_api.get_seedance_client', return_value=fake_client), \
             patch('services.seedance_audio_validation_service.validate_seedance_reference_audio', new=AsyncMock(return_value={2: 'data:audio/wav;base64,verified-original'})) as audio_guard, \
             patch('services.video_credit_pricing.validate_seedance_generation_options'):
            ok = await mock_worker._process_seedance_task(task)

        assert ok is True
        assert mock_worker._provider_media_reference.await_args_list == [
            call('image-1', media_kind='image', seedance_sub_model='standard', usage_scope='workflow'),
            call('video-1', media_kind='video'),
        ]
        audio_guard.assert_awaited_once_with(task.task_type, task.data, task.user_id, file_dao=FileDAO)
        contents = fake_client.create_video_task.call_args.args[1]
        assert contents[-1]['audio_url']['url'] == 'data:audio/wav;base64,verified-original'
        assert [item['type'] for item in contents] == [
            'text',
            'image_url',
            'video_url',
            'audio_url',
        ]
        assert [item['role'] for item in contents[1:]] == [
            'reference_image',
            'reference_video',
            'reference_audio',
        ]
        fake_client.download_video.assert_called_once_with(
            'https://media.example.invalid/output.mp4', task_id='ark-task'
        )

    @pytest.mark.parametrize('failure', ['query_404', 'missing_status', 'download', 'save', 'timeout'])
    async def test_seedance_accepted_task_failure_never_resubmits(self, mock_worker, failure):
        task = self.task_type('accepted-task', 'seedance_multi', {'prompt': 'test'}, user_id='u1')
        client = MagicMock()
        client.create_video_task.return_value = 'accepted-provider-task'
        client.query_task.return_value = {
            'status': 'succeeded', 'content': {'video_url': 'https://media.example.invalid/video.mp4'},
        }
        client.download_video.return_value = b'video'
        mock_worker._save_external_video = AsyncMock(return_value={'url': '/storage/video/result.mp4'})
        if failure == 'query_404':
            client.query_task.side_effect = _http_error(404, 'ResourceNotFound')
        elif failure == 'missing_status':
            client.query_task.return_value = {'id': 'accepted-provider-task'}
        elif failure == 'download':
            client.download_video.side_effect = OSError('download failed')
        elif failure == 'save':
            mock_worker._save_external_video.return_value = None

        clock = MagicMock(side_effect=[0, 601]) if failure == 'timeout' else MagicMock(return_value=0)
        with patch('seedance_api.get_seedance_client', return_value=client), \
             patch('services.video_credit_pricing.validate_seedance_generation_options'), \
             patch('core.online_provider_tasks.time', MagicMock(time=clock)), \
             patch('core.online_provider_tasks.asyncio.sleep', new=AsyncMock()) as sleep:
            assert await mock_worker._process_seedance_task(task) is False
        client.create_video_task.assert_called_once()
        sleep.assert_not_awaited()
        mock_worker.task_queue.complete_task.assert_not_awaited()
        mock_worker.task_queue.fail_task.assert_awaited_once()
        failure_call = mock_worker.task_queue.fail_task.await_args
        assert failure_call.kwargs['retry'] is False
        assert 'accepted-provider-task' in failure_call.args[1]

    async def test_seedance_transient_query_failure_polls_same_task(self, mock_worker):
        task = self.task_type('poll-retry', 'seedance_multi', {'prompt': 'test'}, user_id='u1')
        client = MagicMock()
        client.create_video_task.return_value = 'accepted-provider-task'
        client.query_task.side_effect = [
            _http_error(503, 'temporarily unavailable'),
            {'status': 'running'},
            {'status': 'succeeded', 'content': {'video_url': 'https://media.example.invalid/video.mp4'}},
        ]
        client.download_video.return_value = b'video'
        mock_worker._save_external_video = AsyncMock(return_value={'url': '/storage/video/result.mp4'})
        with patch('seedance_api.get_seedance_client', return_value=client), \
             patch('services.video_credit_pricing.validate_seedance_generation_options'), \
             patch('core.online_provider_tasks.asyncio.sleep', new=AsyncMock()) as sleep:
            assert await mock_worker._process_seedance_task(task) is True
        client.create_video_task.assert_called_once()
        assert client.query_task.call_args_list == [call('accepted-provider-task')] * 3
        assert sleep.await_count == 2
        assert all(args.args[1] >= 5 for args in mock_worker.task_queue.update_progress.await_args_list)
        mock_worker.task_queue.fail_task.assert_not_awaited()
        mock_worker.task_queue.complete_task.assert_awaited_once()

    def test_minimax_video_token_plan_2056_message_is_actionable(self):
        from services.api_provider_runtime import vendor_user_facing_error

        message = vendor_user_facing_error(
            RuntimeError("MiniMax create failed: status_code=2056 status_msg=已达到 Token Plan 用量上限"),
            "minimax",
        )

        assert "Token Plan" in message
        assert "Plus" in message
        assert "Max" in message
        assert "Ultra" in message

    @pytest.mark.parametrize('stage', ['submit', 'poll', 'provenance', 'audio_parameter'])
    async def test_seedance_input_rejection_stops_queue_retry_and_releases_credit(self, mock_worker, stage):
        from core.online_provider_queue import OnlineProviderQueue, PENDING_KEY
        from core.online_provider_task_model import OnlineProviderTask, OnlineTaskStatus
        from services.seedance_image_provenance import SeedanceInputProvenanceError

        task = OnlineProviderTask('seedance-rejection', 'seedance_multi', {
            'prompt': 'storyboard', 'media_inputs': [{'kind': 'image', 'file_id': 'original-1'}],
        }, user_id='test-user')
        task.status = OnlineTaskStatus.PROCESSING
        queue = OnlineProviderQueue(AsyncMock())
        queue.get_task = AsyncMock(return_value=task)
        queue._save_task = AsyncMock()
        queue._persist_status = AsyncMock()
        mock_worker.task_queue = queue
        mock_worker._provider_media_reference = AsyncMock(return_value='data:image/png;base64,AAAA')
        fake_client = MagicMock()
        error = {'code': 'InputImageSensitiveContentDetected.PrivacyInformation', 'message': "Input image content[1] refused"}
        if stage == 'audio_parameter':
            error = {'code': 'InvalidParameter', 'message': 'audio duration must be <= 15.2 seconds'}
            fake_client.create_video_task.side_effect = _http_error(400, __import__('json').dumps({'error': error}))
        elif stage == 'submit':
            fake_client.create_video_task.side_effect = _http_error(400, __import__('json').dumps({'error': error}))
        elif stage == 'poll':
            fake_client.create_video_task.return_value = 'remote-task'
            fake_client.query_task.return_value = {'status': 'failed', 'error': error}
        else:
            mock_worker._provider_media_reference.side_effect = SeedanceInputProvenanceError('原图过期，请重新生成')
        with patch('seedance_api.get_seedance_client', return_value=fake_client), \
             patch('services.video_credit_pricing.validate_seedance_generation_options'), \
             patch('core.online_provider_tasks.asyncio.sleep', new=AsyncMock(side_effect=AssertionError('Unexpected polling retry'))), \
             patch('services.api_provider_health_monitor.cache_provider_health_result', new=AsyncMock()) as health, \
             patch('services.task_credit_billing_service.release_task_credits', new=AsyncMock()) as release, \
             patch('services.task_credit_billing_service.settle_task_credits', new=AsyncMock()) as settle:
            assert await mock_worker._process_seedance_task(task) is False
        assert task.status == OnlineTaskStatus.FAILED
        assert task.retries == 1
        assert not any(args.args[0] == PENDING_KEY for args in queue.redis.zadd.await_args_list)
        release.assert_awaited_once()
        settle.assert_not_awaited()
        health.assert_not_awaited()
        assert fake_client.create_video_task.call_count == (0 if stage == 'provenance' else 1)
        fake_client.download_video.assert_not_called()
        assert ('原图过期' if stage == 'provenance' else '已停止自动重试') in task.error
        if stage in ('submit', 'poll'):
            assert '本次提交的图片1（上游位置 content[1]）' in task.error



class ProviderReferenceContract(ProviderWorkerFixture):
    @pytest.mark.asyncio
    async def test_dashscope_url_resolution_uses_guarded_provider_media_service(self):
        worker = self.worker_type.__new__(self.worker_type)
        with patch(
            "services.provider_media_input_service.provider_image_reference_to_data_uri",
            AsyncMock(return_value="data:image/png;base64,c2FmZQ=="),
        ) as resolve:
            result = await worker._file_id_to_dashscope_url(
                "/storage/image/user/project/episode/source.png?token=legacy",
                label="seedance_image_0",
            )

        assert result == "data:image/png;base64,c2FmZQ=="
        resolve.assert_awaited_once_with(
            "/storage/image/user/project/episode/source.png?token=legacy",
            file_dao=FileDAO,
        )



class ProviderPayloadContract(ProviderWorkerFixture):
    def test_generate_request_accepts_kling_multi_shot_extras(self):
        """Pydantic GenerateRequest must NOT drop kling_multi_shot via extra='ignore'."""
        body = GenerateRequest(
            task_type='kling_t2v', prompt='x',
            kling_multi_shot=True, kling_shot_type='customize',
            kling_multi_prompt=[{'index': 1, 'prompt': 'a', 'duration': 5}],
        )
        dumped = body.model_dump()
        assert dumped.get('kling_multi_shot') is True
        assert dumped.get('kling_shot_type') == 'customize'
        assert dumped.get('kling_multi_prompt') == [{'index': 1, 'prompt': 'a', 'duration': 5}]

    def test_generate_request_accepts_vidu_resolution_and_seed(self):
        body = GenerateRequest(
            task_type='vidu_r2v', prompt='x',
            vidu_resolution='1080P', vidu_size='1920*1080', vidu_seed=42, vidu_audio=True,
        )
        dumped = body.model_dump()
        assert dumped.get('vidu_resolution') == '1080P'
        assert dumped.get('vidu_size') == '1920*1080'
        assert dumped.get('vidu_seed') == 42
        assert dumped.get('vidu_audio') is True

    def test_generate_request_accepts_hh_ratio_and_seed(self):
        body = GenerateRequest(
            task_type='happyhorse_r2v', prompt='x',
            hh_resolution='720P', hh_ratio='9:21', hh_duration=7, hh_seed=42, hh_watermark=False,
        )
        dumped = body.model_dump()
        assert dumped.get('hh_ratio') == '9:21'
        assert dumped.get('hh_resolution') == '720P'
        assert dumped.get('hh_seed') == 42
        assert dumped.get('hh_duration') == 7
        assert dumped.get('hh_watermark') is False

    async def test_worker_passes_kling_multi_shot_to_client(self):
        """worker._process_dashscope_video_task must propagate kling_multi_shot to client.kling_submit.

        Strategy: bypass __init__ heavy deps via __new__, stub task_queue, and make
        `extract_video_url` return None so the inner code path short-circuits with
        ValueError BEFORE attempting an aiohttp download. The outer except in
        `_process_dashscope_video_task` swallows the ValueError and calls
        `task_queue.fail_task` — fine for our purposes, we only need to prove
        `kling_submit` was called with `multi_shot=True` BEFORE the short-circuit.
        """

        fake_task = MagicMock()
        fake_task.task_id = 't-1'
        fake_task.task_type = 'kling_t2v'
        fake_task.data = {
            'prompt': 'multi-scene story',
            'kling_multi_shot': True,
            'kling_shot_type': 'customize',
            'kling_multi_prompt': [
                {'index': 1, 'prompt': 'shot1', 'duration': 5},
                {'index': 2, 'prompt': 'shot2', 'duration': 5},
            ],
            'duration': 10,
            'aspect_ratio': '9:16',
        }

        fake_client = MagicMock()
        fake_client.kling_submit = AsyncMock(
            return_value={'output': {'task_id': 'ds-1', 'task_status': 'PENDING'}}
        )
        fake_client.query_task = AsyncMock(
            return_value={'output': {'task_status': 'SUCCEEDED'}}
        )
        # Force the worker's `if not video_url: raise ValueError` short-circuit:
        fake_client.extract_video_url = MagicMock(return_value=None)

        # patch the dashscope_video_api factory (imported inside the worker fn)
        with patch('dashscope_video_api.get_dashscope_video_client', return_value=fake_client):
            # Bypass __init__ heavy deps (redis, cluster_manager, ...)
            tw = self.worker_type.__new__(self.worker_type)
            tw.task_queue = MagicMock()
            tw.task_queue.update_progress = AsyncMock()
            tw.task_queue.complete_task = AsyncMock()
            tw.task_queue.fail_task = AsyncMock()
            # Defensive: kling_t2v with empty media_inputs won't call this, but stub anyway.
            tw._file_id_to_dashscope_url = AsyncMock(
                side_effect=lambda src, label='x': src or ''
            )

            # _process_dashscope_video_task wraps everything in try/except and returns
            # False on failure (e.g. our forced "no video_url" ValueError). Either way,
            # kling_submit was called before the failure point — that's what we assert.
            result = await tw._process_dashscope_video_task(fake_task)
            # Result is False because we deliberately starved video_url; that's fine.
            assert result is False

        # Verify kling_submit was called with the new kwargs that prove the wiring works.
        assert fake_client.kling_submit.await_count >= 1, "kling_submit was never awaited"
        call_kwargs = fake_client.kling_submit.await_args.kwargs
        assert call_kwargs.get('multi_shot') is True, (
            f"Expected multi_shot=True in kling_submit kwargs, got: {call_kwargs}"
        )
        assert call_kwargs.get('shot_type') == 'customize'
        assert isinstance(call_kwargs.get('multi_prompt'), list)
        assert len(call_kwargs['multi_prompt']) == 2
        assert call_kwargs['multi_prompt'][0]['prompt'] == 'shot1'
