"""Bounded, authorized audio transcription with verified word timestamps."""
from __future__ import annotations

import asyncio
import base64
import io
import json
import math
import os
import subprocess
import tempfile
import wave
from array import array
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from services.api_provider_runtime import resolve_provider
from services.ai_proxy_http_client import _post_form_request_async
from services.provider_media_input_service import ProviderMediaInputError, provider_audio_or_video_reference
from services.subtitle_word_timing import word_timestamps_to_cues
from services.remote_content_service import RemoteContentTooLarge

MAX_CHUNK_MS = 60_000
_busy_users: set[str] = set()
_slots = asyncio.Semaphore(2)


async def _finish_before_cancel(awaitable):
    # Thread-backed HTTP and media work cannot be interrupted by task cancellation.
    # Keep the per-user/global slots until that bounded operation really finishes.
    task = asyncio.create_task(awaitable)
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        try:
            await task
        except Exception:
            pass
        raise


class AudioTranscriptionError(ValueError):
    pass


class AudioTranscriptionBusy(AudioTranscriptionError):
    pass


def transcription_endpoint(endpoint: str) -> str:
    parsed = urlsplit(str(endpoint or '').strip())
    if parsed.scheme not in {'http', 'https'} or not parsed.netloc or parsed.query or parsed.fragment:
        raise AudioTranscriptionError('字幕识别通道地址无效，请联系管理员')
    path = parsed.path.rstrip('/')
    if path.endswith('/audio/transcriptions'):
        return urlunsplit((parsed.scheme, parsed.netloc, path, '', ''))
    for suffix in ('/chat/completions', '/v1beta/openai', '/v1beta'):
        if path.endswith(suffix):
            path = path[:-len(suffix)]
            break
    if not path.endswith('/v1'):
        path += '/v1'
    return urlunsplit((parsed.scheme, parsed.netloc, path + '/audio/transcriptions', '', ''))


def resolve_transcription_config():
    # Reuse this installation's configured account only after explicit opt-in.
    if os.getenv('SUBTITLE_TRANSCRIPTION_ENGINE', '').strip().lower() != 'whisper':
        raise AudioTranscriptionError('AI 字幕识别尚未开通，请联系管理员配置语音识别通道')
    config = resolve_provider('gemini-text', usage_scope='workflow')
    if not config.api_key or not config.endpoint:
        raise AudioTranscriptionError('AI 字幕识别通道尚未配置')
    transcription_endpoint(config.endpoint)
    return config


def transcription_capability() -> dict[str, Any]:
    try:
        resolve_transcription_config()
        return {'available': True, 'model': 'whisper-1', 'max_chunk_ms': MAX_CHUNK_MS}
    except AudioTranscriptionError as exc:
        return {'available': False, 'reason': str(exc)}


def _extract_audio(data_uri: str, source_offset_ms: int, duration_ms: int) -> tuple[bytes, int]:
    with tempfile.TemporaryDirectory(prefix='subtitle-audio-') as directory:
        try:
            header, encoded = data_uri.split(',', 1)
            source = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError) as exc:
            raise AudioTranscriptionError('音视频文件格式无效') from exc
        suffix = '.mp4' if 'video/' in header.lower() else '.wav' if 'wav' in header.lower() else '.mp3'
        source_path = Path(directory) / ('source' + suffix)
        source_path.write_bytes(source)
        output_path = Path(directory) / 'speech.wav'
        try:
            probe = subprocess.run([
                'ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type',
                '-of', 'json', str(source_path),
            ], check=True, capture_output=True, timeout=15)
            info = json.loads(probe.stdout)
            actual_ms = round(float(info['format']['duration']) * 1000)
            if actual_ms <= 0 or source_offset_ms + duration_ms > actual_ms + 150:
                raise AudioTranscriptionError('识别范围超过原文件时长，请刷新素材或调整裁剪范围')
            if not any(stream.get('codec_type') == 'audio' for stream in info.get('streams', [])):
                return b'', 0
            subprocess.run([
                'ffmpeg', '-nostdin', '-v', 'error', '-y', '-threads', '1',
                '-ss', f'{source_offset_ms / 1000:.3f}', '-i', str(source_path),
                '-t', f'{duration_ms / 1000:.3f}', '-map', '0:a:0', '-vn',
                '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(output_path),
            ], check=True, capture_output=True, timeout=45)
            output = output_path.read_bytes()
            with wave.open(io.BytesIO(output), 'rb') as audio:
                actual_ms = round(audio.getnframes() * 1000 / audio.getframerate())
                samples = array('h', audio.readframes(audio.getnframes()))
            if not 0 < actual_ms <= MAX_CHUNK_MS + 150 or len(output) > 2_000_000:
                raise AudioTranscriptionError('提取的音频时长或大小超出识别限制')
            # Exact silence is not sent upstream, where it can produce invented text.
            rms = math.sqrt(sum(float(value) ** 2 for value in samples) / max(1, len(samples)))
            return (output if rms >= 3.3 else b''), actual_ms
        except (OSError, subprocess.SubprocessError, ValueError, KeyError, wave.Error) as exc:
            if isinstance(exc, AudioTranscriptionError):
                raise
            raise AudioTranscriptionError('无法读取当前片段的音轨，请检查源文件后重试') from exc


async def _transcribe_wav(config: Any, content: bytes, duration_ms: int) -> list[dict[str, Any]]:
    response = await _finish_before_cancel(_post_form_request_async(
        label='Subtitle word transcription', url=transcription_endpoint(config.endpoint),
        headers={'Authorization': f'Bearer {config.api_key}'},
        files={'file': ('speech.wav', content, 'audio/wav')},
        data={'model': 'whisper-1', 'response_format': 'verbose_json', 'temperature': '0',
              'timestamp_granularities[]': ['word', 'segment']},
        request_kwargs={**config.requests_kwargs(), 'allow_redirects': False},
        timeout=(15, 90), expected_status=200,
        timeout_message='字幕识别超时，请稍后重试；已有字幕已保留',
        request_error_message='字幕识别连接失败，请稍后重试',
        parse_error_message='字幕识别服务响应无效',
        upstream_detail=lambda _body, status: f'字幕识别服务调用失败（{status}），请管理员检查转录权限',
    ))
    try:
        return word_timestamps_to_cues(response, duration_ms)
    except (ValueError, TypeError, AttributeError) as exc:
        raise AudioTranscriptionError('识别结果缺少有效的逐词时间点，请重试或检查识别通道；已有字幕已保留') from exc


async def transcribe_timeline_audio(
    clips: list[dict[str, Any]], *, file_dao: Any, user_id: str,
) -> list[dict[str, Any]]:
    if not clips or len(clips) > 10:
        raise AudioTranscriptionError('每次识别需要 1 至 10 个片段')
    for clip in clips:
        duration, offset = clip.get('duration_ms'), clip.get('source_offset_ms', 0)
        if type(duration) is not int or not 100 <= duration <= MAX_CHUNK_MS or type(offset) is not int or offset < 0:
            raise AudioTranscriptionError('字幕识别裁剪范围无效')
    if sum(clip.get('duration_ms', 0) for clip in clips) > MAX_CHUNK_MS:
        raise AudioTranscriptionError('单次识别最多 60 秒，请分段处理')
    if user_id in _busy_users:
        raise AudioTranscriptionBusy('已有字幕片段正在识别，请稍后重试')
    _busy_users.add(user_id)
    try:
        async with _slots:
            config = resolve_transcription_config()
            results = []
            for clip in clips:
                duration = clip.get('duration_ms', 0)
                offset = clip.get('source_offset_ms', 0)
                reference = str(clip.get('audio_url') or '').strip()
                if not reference or reference.startswith(('data:', 'blob:')):
                    raise AudioTranscriptionError('请选择已保存到当前项目的音视频文件')
                try:
                    source = await provider_audio_or_video_reference(reference, media_kind=clip.get('media_kind', 'audio'), file_dao=file_dao)
                except ProviderMediaInputError as exc:
                    raise AudioTranscriptionError('音视频文件不存在或无法读取') from exc
                except RemoteContentTooLarge as exc:
                    raise AudioTranscriptionError('原素材超过识别读取上限，请先将音轨导出为较小文件并上传') from exc
                if not source.startswith(('data:audio/', 'data:video/')):
                    raise AudioTranscriptionError('请先将音视频上传并保存到当前项目')
                content, actual_ms = await _finish_before_cancel(asyncio.to_thread(_extract_audio, source, offset, duration))
                if content:
                    for cue in await _transcribe_wav(config, content, actual_ms):
                        results.append({'clip_id': clip['clip_id'], **cue})
            return results
    finally:
        _busy_users.discard(user_id)
