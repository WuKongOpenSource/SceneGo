"""Preserve an upscale input's clock, frames and original audio before publication.

Only container timestamps are rewritten; encoded high-resolution pictures are
copied. Unverifiable inputs fail closed instead of replacing an editor source.
"""
from __future__ import annotations

from fractions import Fraction
import json
from pathlib import Path
import subprocess
import tempfile


class UpscaleTimingError(RuntimeError):
    pass


def _run(args):
    try:
        return subprocess.run(args, capture_output=True, check=True, timeout=120).stdout
    except (OSError, subprocess.SubprocessError) as exc:
        raise UpscaleTimingError('高清时长校验失败，已保留原视频，请稍后重试') from exc


def probe_video(path):
    raw = json.loads(_run(['ffprobe', '-v', 'error', '-show_entries',
        'stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,time_base,nb_frames,duration,duration_ts,start_time,start_pts,sample_rate,channels:format=duration',
        '-of', 'json', str(path)]))
    video = next((s for s in raw.get('streams', []) if s.get('codec_type') == 'video'), None)
    if not video:
        raise UpscaleTimingError('无法读取视频时长，已保留原视频')
    try:
        fps = Fraction(video['r_frame_rate'])
        average = Fraction(video['avg_frame_rate'])
        frames = int(video['nb_frames'])
        duration_ms = round(float(raw['format']['duration']) * 1000)
        video_duration_ms = round(float(video['duration']) * 1000)
        if not (0 < fps <= 240 and frames > 0 and duration_ms > 0):
            raise ValueError('Invalid clock metadata')
        # Resampling variable-frame-rate input requires a separate frame map.
        if abs(float(fps - average)) >= 0.01:
            raise ValueError('Variable frame rate is unsupported')
        # Non-zero video starts and VFR need an explicit timestamp map, not CFR repair.
        if (abs(float(video.get('start_time', 0))) > .000001
                or abs(float(Fraction(frames, 1) / fps) * 1000 - video_duration_ms) > 1):
            raise ValueError('Non-CFR clock requires an explicit frame map')
    except (KeyError, TypeError, ValueError, ZeroDivisionError) as exc:
        raise UpscaleTimingError('该视频帧率或时长无法可靠校验，已保留原视频') from exc
    # Metadata can report a CFR average for an irregular or damaged frame sequence.
    decoded = json.loads(_run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', str(path)])).get('frames', [])
    try:
        tolerance = max(Fraction(1, 1_000_000), Fraction(video['time_base']))
        if len(decoded) != frames or not all(
                abs(Fraction(frame['best_effort_timestamp_time']) - Fraction(index, 1) / fps) <= tolerance
                for index, frame in enumerate(decoded)):
            raise ValueError('Decoded frames do not match the source clock')
    except (KeyError, TypeError, ValueError, ZeroDivisionError) as exc:
        raise UpscaleTimingError('视频存在变帧率、缺帧或异常时间戳，已保留原视频') from exc
    return {'video': video, 'fps': fps, 'frames': frames, 'duration_ms': duration_ms,
            'video_duration_ms': video_duration_ms,
            'audio': [s for s in raw.get('streams', []) if s.get('codec_type') == 'audio']}


def audio_packet_hashes(path, count):
    """Hash encoded audio, not decoded/resampled sound: remux must be bit-preserving."""
    return [_run(['ffmpeg', '-v', 'error', '-i', str(path), '-map', f'0:a:{index}',
                  '-c:a', 'copy', '-f', 'hash', '-hash', 'sha256', '-']).decode().strip()
            for index in range(count)]


def _audio_tail_options(source, audios):
    """Keep the source edit-list end when an older muxer expands AAC padding."""
    options = []
    for index, audio in enumerate(audios):
        packets = json.loads(_run(['ffprobe', '-v', 'error', '-select_streams', f'a:{index}',
            '-show_entries', 'packet=pts,duration', '-of', 'json', str(source)])).get('packets', [])
        try:
            end = int(audio['start_pts']) + int(audio['duration_ts'])
            last = packets[-1]
            tail = end - int(last['pts'])
            if not 0 < tail <= int(last['duration']):
                raise ValueError('Unsupported audio edit boundary')
            # Copy every encoded packet; change only its container duration.
            if tail < int(last['duration']):
                options += [f'-bsf:a:{index}',
                    f"setts=duration='if(eq(N,{len(packets)-1}),{tail},DURATION)'"]
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise UpscaleTimingError('原声音轨时间边界无法可靠校验，已保留原视频') from exc
    return options


def preserve_upscale_timing(source, upscale, destination):
    source, upscale, destination = map(Path, (source, upscale, destination))
    if destination.exists() or destination.resolve() in {source.resolve(), upscale.resolve()}:
        raise UpscaleTimingError('拒绝覆盖原始视频文件')
    original, enhanced = probe_video(source), probe_video(upscale)
    if original['frames'] != enhanced['frames']:
        raise UpscaleTimingError('高清结果帧数与原视频不一致，已保留原视频，请重新处理')
    fps = original['fps']
    timescale = fps.numerator * 1000
    frame_ticks = fps.denominator * 1000
    audio_options = _audio_tail_options(source, original['audio'])
    # Audio may outlast the picture. Never turn that difference into a held frame.
    ratio = float(enhanced['fps'] / fps)
    with tempfile.TemporaryDirectory(prefix='upscale-clock-') as scratch:
        stage = Path(scratch) / 'clock.mp4'
        _run(['ffmpeg', '-v', 'error', '-n', '-itsscale', format(ratio, '.17g'), '-i', str(upscale),
              '-map', '0:v:0', '-c', 'copy',
              '-map_metadata', '-1', '-video_track_timescale', str(timescale),
              '-movflags', '+faststart', str(stage)])
        # Preserve B-frame PTS/DTS ordering, with exactly one tick span per frame.
        # Explicit tick counts avoid time-base changes at the stream-copy boundary.
        pts = f'round(PTS/{frame_ticks})*{frame_ticks}'
        dts = f'round(DTS/{frame_ticks})*{frame_ticks}'
        bsf = f"setts=pts='{pts}':dts='{dts}':duration={frame_ticks}"
        _run(['ffmpeg', '-v', 'error', '-n', '-i', str(stage), '-i', str(source),
              '-map', '0:v:0', '-map', '1:a?', '-c', 'copy', *audio_options,
              '-bsf:v', bsf, '-video_track_timescale', str(timescale),
              '-map_metadata', '-1', '-movflags', '+faststart', str(destination)])
    output = probe_video(destination)
    video, duration_ms, audios = output['video'], output['duration_ms'], output['audio']
    if (duration_ms != original['duration_ms'] or int(video['nb_frames']) != original['frames']
            or output['video_duration_ms'] != original['video_duration_ms']
            or output['fps'] != original['fps']
            or Fraction(video['avg_frame_rate']) != Fraction(original['video']['avg_frame_rate'])
            or len(audios) != len(original['audio'])
            or any(abs(float(a.get('duration', 0)) - float(b.get('duration', 0))) > .001
                   or abs(float(a.get('start_time', 0)) - float(b.get('start_time', 0))) > .001
                   or any(a.get(key) != b.get(key) for key in ('codec_name', 'sample_rate', 'channels'))
                   for a, b in zip(audios, original['audio']))
            or audio_packet_hashes(source, len(audios)) != audio_packet_hashes(destination, len(audios))):
        raise UpscaleTimingError('高清结果未能保持原始时长或原声，已保留原视频')
    return {'duration_seconds': duration_ms / 1000, 'width': video['width'], 'height': video['height'],
            'timing_contract': {'source_duration_ms': original['duration_ms'], 'output_duration_ms': duration_ms,
                                'source_video_duration_ms': original['video_duration_ms'],
                                'output_video_duration_ms': output['video_duration_ms'],
                                'source_fps': str(fps), 'output_fps': str(output['fps']),
                                'source_frame_count': original['frames'], 'output_frame_count': output['frames'],
                                'original_audio_packet_copy': True}}
