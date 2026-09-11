"""Validate original reference audio before reserving credits and submitting.

Seedance 2.0: 2–15 seconds per clip, at most 3 clips and 15 seconds total.
Source: https://docs.byteplus.com/en/docs/byteplus_las/video_gen_enhanced
Client duration fields are display hints, never evidence for this boundary.
"""
from __future__ import annotations

import asyncio
import base64
import ipaddress
import json
import math
import os
import subprocess
import tempfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import aiohttp

from services.generation_access_service import (
    GenerationAccessDenied, require_generation_request_access,
)
from services.provider_media_input_service import (
    ProviderMediaInputError, _decode_data_uri, provider_audio_or_video_reference,
)
from services.remote_content_service import RemoteContentTooLarge, read_aiohttp_response_limited

MAX_AUDIO_BYTES = 15 * 1024 * 1024
MAX_AUDIO_SECONDS = 15


class SeedanceAudioValidationError(ValueError):
    """Invalid or unverifiable user media; never automatically retry generation."""


class _PublicResolver(aiohttp.resolver.DefaultResolver):
    async def resolve(self, host, port=0, family=0):
        records = await super().resolve(host, port, family)
        if not records or any(not ipaddress.ip_address(row['host']).is_global for row in records):
            raise SeedanceAudioValidationError("参考音频地址不可访问，请上传原始音频文件。")
        return records


async def _download_audio(url: str) -> bytes:
    # Validate the actual connector DNS results too; redirects and proxy env
    # settings must not turn a public reference into an internal-network read.
    connector = aiohttp.TCPConnector(resolver=_PublicResolver())
    async with aiohttp.ClientSession(
        connector=connector, timeout=aiohttp.ClientTimeout(total=20, connect=5), trust_env=False,
    ) as session:
        async with session.get(url, allow_redirects=False) as response:
            if response.status != 200:
                raise SeedanceAudioValidationError("无法读取参考音频，请重新上传原始文件。")
            return await read_aiohttp_response_limited(response, max_bytes=MAX_AUDIO_BYTES)


def _probe_audio_bytes(content: bytes) -> float:
    # Probe only a bounded local copy; ffprobe cannot fetch URLs, playlists or
    # auxiliary files. No transcoding, trimming or changes to the source bytes.
    with tempfile.TemporaryDirectory(prefix='seedance-audio-') as directory:
        source = Path(directory) / 'reference.audio'
        source.write_bytes(content)
        try:
            result = subprocess.run([
                os.getenv('FFPROBE_BIN', 'ffprobe'), '-v', 'error',
                '-protocol_whitelist', 'file', '-format_whitelist', 'wav,mp3',
                '-select_streams', 'a:0', '-show_entries', 'format=duration:stream=duration,codec_type',
                '-of', 'json', str(source),
            ], capture_output=True, timeout=8, check=True)
            info = json.loads(result.stdout)
            streams = info.get('streams') or []
            if not streams or streams[0].get('codec_type') != 'audio':
                raise ValueError('No audio stream')
            durations = [float(row['duration']) for row in [info.get('format') or {}, *streams]
                         if row.get('duration') not in (None, 'N/A')]
            duration = max(durations)
            if not math.isfinite(duration) or duration <= 0:
                raise ValueError('Invalid duration')
            return duration
        except (OSError, subprocess.SubprocessError, ValueError, KeyError) as exc:
            raise SeedanceAudioValidationError(
                "无法确认参考音频的真实时长，请上传可播放的 WAV/MP3 原始文件后再提交。"
            ) from exc


async def validate_seedance_reference_audio(
    task_type: str, task_data: dict[str, Any], user_id: str, *, file_dao: Any = None,
    prepare_for_submission: bool = True,
) -> dict[int, str]:
    """Return verified reference data URIs indexed by media_inputs position.

    The API discards these after validation; workers recheck ownership and the
    current bytes, optionally trim explicit reference-only copies, and submit
    those verified bytes so a URL cannot change after the final probe.
    Nothing is written into task data or existing media rows.
    """
    if not task_type.startswith('seedance_') or task_data.get('sub_model') == 'agent_plan':
        return {}
    policy = task_data.get('reference_audio_policy') or 'preserve'
    if policy not in {'preserve', 'trim_to_15'}:
        raise SeedanceAudioValidationError('参考配音处理选项无效，请重新选择。')
    prepared, durations = await inspect_seedance_reference_audio(task_data, user_id, file_dao=file_dao)
    if policy == 'trim_to_15' and durations:
        from services.seedance_audio_reference_service import allocate_audio_budget, trim_audio_copy
        budgets = allocate_audio_budget(list(durations.values()))
        if prepare_for_submission:
            for (index, original_duration), budget in zip(durations.items(), budgets):
                if budget >= original_duration:
                    continue
                content = _decode_data_uri(prepared[index], max_bytes=MAX_AUDIO_BYTES, expected_kind='audio')
                derived = await asyncio.to_thread(trim_audio_copy, content, budget)
                durations[index] = await asyncio.to_thread(_probe_audio_bytes, derived)
                prepared[index] = f"data:audio/wav;base64,{base64.b64encode(derived).decode('ascii')}"
        else:
            # Enqueue preflight authorizes and probes originals, but never
            # transcodes or stores a derived copy before the explicit run.
            durations = dict(zip(durations, budgets))
    detail = '、'.join(f'配音 {i + 1}：{value:.3f} 秒' for i, value in enumerate(durations.values()))
    total = sum(durations.values())
    if any(value < 2 or value > MAX_AUDIO_SECONDS for value in durations.values()) or total > MAX_AUDIO_SECONDS:
        raise SeedanceAudioValidationError(
            f"{detail}；合计 {total:.3f} 秒。Seedance 2.0 每段参考配音需为 2–15 秒，合计不超过 15 秒。"
            "可在声音设置中勾选“仅裁剪参考副本至 15 秒内”，或手动调整后重新提交；不会变速或自动重试。"
        )
    return prepared


async def inspect_seedance_reference_audio(
    task_data: dict[str, Any], user_id: str, *, file_dao: Any = None,
) -> tuple[dict[int, str], dict[int, float]]:
    """Read and probe authorized originals without imposing the duration budget."""
    media = task_data.get('media_inputs') or []
    audios = [(i, item) for i, item in enumerate(media)
              if isinstance(item, dict) and str(item.get('kind') or '').lower() == 'audio']
    if not audios:
        return {}, {}
    if not user_id:
        raise SeedanceAudioValidationError("无法确认参考音频访问权限，请重新登录后提交。")
    if len(audios) > 3:
        raise SeedanceAudioValidationError("Seedance 2.0 最多使用 3 段参考配音，合计不超过 15 秒。")
    if file_dao is None:
        from dao_content import FileDAO
        file_dao = FileDAO
    references = [str(item[key]) for _, item in audios for key in ('file_id', 'url') if item.get(key)]
    try:
        await require_generation_request_access(
            SimpleNamespace(**task_data), user_id, references, file_dao=file_dao,
        )
    except GenerationAccessDenied as exc:
        raise SeedanceAudioValidationError("参考音频不存在或无权访问，请重新选择素材。") from exc
    prepared = {}
    durations = {}
    for index, item in audios:
        try:
            resolved = await provider_audio_or_video_reference(
                item.get('file_id') or item.get('url') or '',
                media_kind='audio', file_dao=file_dao, max_bytes=MAX_AUDIO_BYTES,
            )
            if resolved.startswith('data:'):
                content = _decode_data_uri(resolved, max_bytes=MAX_AUDIO_BYTES, expected_kind='audio')
                mime = resolved[5:].split(';', 1)[0].split(',', 1)[0]
            else:
                content = await _download_audio(resolved)
                mime = 'audio/wav' if content.startswith(b'RIFF') else 'audio/mpeg'
            duration = await asyncio.to_thread(_probe_audio_bytes, content)
        except (ProviderMediaInputError, RemoteContentTooLarge, aiohttp.ClientError, TimeoutError, ValueError) as exc:
            if isinstance(exc, SeedanceAudioValidationError):
                raise
            raise SeedanceAudioValidationError(
                f"参考配音 {len(durations) + 1} 无法校验，请重新上传不超过 15 MB 的 WAV/MP3 原始文件。"
            ) from exc
        durations[index] = duration
        prepared[index] = f"data:{mime};base64,{base64.b64encode(content).decode('ascii')}"
    return prepared, durations


async def preflight_seedance_reference_audio(task_type: str, task_data: dict[str, Any], user_id: str) -> None:
    from fastapi import HTTPException
    try:
        await validate_seedance_reference_audio(task_type, task_data, user_id, prepare_for_submission=False)
    except SeedanceAudioValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
