"""Explicit reference-only trimming; originals and task inputs stay untouched."""
from __future__ import annotations

import math
import os
import subprocess
import tempfile
from pathlib import Path

from services.seedance_audio_validation_service import (
    MAX_AUDIO_BYTES, SeedanceAudioValidationError, _probe_audio_bytes,
)


def allocate_audio_budget(durations: list[float]) -> list[float]:
    """Proportional allocation, a 2s minimum per voice, millisecond floor."""
    if not durations or len(durations) > 3 or any(not math.isfinite(d) or d < 2 for d in durations):
        raise SeedanceAudioValidationError("请选择 1–3 段至少 2 秒的参考配音；过短片段不会被自动补齐。")
    if sum(durations) <= 15:
        return durations[:]
    remaining = 15.0
    result = [0.0] * len(durations)
    pending = list(range(len(durations)))
    while pending:
        weight = sum(durations[i] for i in pending)
        short = [i for i in pending if remaining * durations[i] / weight < 2]
        if not short:
            for i in pending:
                result[i] = math.floor(remaining * durations[i] / weight * 1000) / 1000
            break
        for i in short:
            result[i] = 2.0
            pending.remove(i)
            remaining -= 2.0
    return result


def trim_audio_copy(content: bytes, duration: float) -> bytes:
    """Create a temporary PCM WAV prefix at normal speed, then verify it."""
    with tempfile.TemporaryDirectory(prefix='seedance-reference-copy-') as directory:
        source, output = Path(directory) / 'original.audio', Path(directory) / 'reference.wav'
        source.write_bytes(content)
        try:
            subprocess.run([
                os.getenv('FFMPEG_BIN', 'ffmpeg'), '-nostdin', '-y', '-v', 'error',
                '-protocol_whitelist', 'file', '-format_whitelist', 'wav,mp3', '-i', str(source),
                '-map', '0:a:0', '-vn', '-af',
                f'aresample=48000,atrim=end_sample={round(duration * 1000) * 48},asetpts=PTS-STARTPTS',
                '-ac', '2', '-c:a', 'pcm_s16le', '-map_metadata', '-1', str(output),
            ], capture_output=True, timeout=20, check=True)
            if output.stat().st_size > MAX_AUDIO_BYTES:
                raise ValueError('Derived reference too large')
            result = output.read_bytes()
            actual = _probe_audio_bytes(result)
            if actual < 2 or actual > duration + 0.000001:
                raise ValueError('Derived reference duration mismatch')
            return result
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            raise SeedanceAudioValidationError("参考副本生成失败，原始配音未修改，请稍后重试。") from exc
