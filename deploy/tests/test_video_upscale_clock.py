import shutil
import subprocess
from pathlib import Path

import pytest

from utils.video_upscale_clock import UpscaleTimingError, preserve_upscale_timing, probe_video


def ffmpeg(*args):
    result = subprocess.run(['ffmpeg', '-v', 'error', '-n', *map(str, args)], capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr.decode(errors='replace')
    return result.stdout


@pytest.fixture
def media(tmp_path):
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        pytest.skip('FFmpeg integration runtime unavailable')
    return tmp_path


@pytest.mark.parametrize('fps', ['24', '25', '30', '60', '30000/1001', '24000/1001'])
@pytest.mark.parametrize('audio', [False, True])
def test_preserves_duration_frames_audio_and_high_resolution_pixels(media, fps, audio):
    source, high, output = [media / name for name in ('source.mp4', 'high.mp4', 'output.mp4')]
    args = ['-f', 'lavfi', '-i', f'testsrc2=size=64x64:rate={fps}:duration=1']
    if audio:
        args += ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.05', '-c:a', 'aac']
    ffmpeg(*args, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source)
    # Reproduce the fixed-25-fps encoder bug without dropping source frames.
    ffmpeg('-i', source, '-an', '-vf', 'settb=1/25,setpts=N', '-r', '25', '-fps_mode', 'cfr',
           '-c:v', 'libx264', '-pix_fmt', 'yuv420p', high)
    before_source, before_high = source.read_bytes(), high.read_bytes()
    result = preserve_upscale_timing(source, high, output)
    assert round(result['duration_seconds'] * 1000) == probe_video(source)['duration_ms']
    assert result['timing_contract']['source_frame_count'] == probe_video(high)['frames']
    source_info, result_info = probe_video(source), probe_video(output)
    assert result_info['fps'] == source_info['fps']
    assert result_info['video']['avg_frame_rate'] == source_info['video']['avg_frame_rate']
    assert result_info['video_duration_ms'] == source_info['video_duration_ms']
    assert result['timing_contract']['output_frame_count'] == source_info['frames']
    assert result['timing_contract']['original_audio_packet_copy'] is True
    assert source.read_bytes() == before_source and high.read_bytes() == before_high
    def decoded_hash(path):
        return ffmpeg('-i', path, '-map', '0:v:0', '-fps_mode', 'passthrough', '-f', 'hash', '-hash', 'sha256', '-')
    assert decoded_hash(output) == decoded_hash(high)


def test_refuses_overwrite_or_frame_loss(media):
    source, high = media / 'source.mp4', media / 'high.mp4'
    ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=24:duration=1', '-c:v', 'libx264', source)
    ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=25:duration=1', '-c:v', 'libx264', high)
    with pytest.raises(UpscaleTimingError, match='覆盖'):
        preserve_upscale_timing(source, high, source)
    with pytest.raises(UpscaleTimingError, match='帧数'):
        preserve_upscale_timing(source, high, media / 'out.mp4')
    assert not (media / 'out.mp4').exists()


def test_preserves_delayed_and_multiple_original_audio_tracks(media):
    from utils.video_upscale_clock import audio_packet_hashes
    source, high, output = [media / name for name in ('source.mp4', 'high.mp4', 'out.mp4')]
    ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=30:duration=1',
           '-itsoffset', '0.12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.2',
           '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.5',
           '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-c:a', 'aac', source)
    ffmpeg('-i', source, '-an', '-vf', 'settb=1/25,setpts=N', '-r', '25', '-fps_mode', 'cfr', '-c:v', 'libx264', high)
    preserve_upscale_timing(source, high, output)
    assert probe_video(output)['video_duration_ms'] == 1000
    assert probe_video(output)['duration_ms'] == probe_video(source)['duration_ms']
    assert audio_packet_hashes(source, 2) == audio_packet_hashes(output, 2)


def test_variable_frame_timestamps_are_not_silently_resampled(media):
    source = media / 'vfr.mp4'
    ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=30:duration=1',
           '-vf', "select='not(eq(n,10))'", '-fps_mode', 'vfr', '-c:v', 'libx264', source)
    with pytest.raises(UpscaleTimingError):
        probe_video(source)
