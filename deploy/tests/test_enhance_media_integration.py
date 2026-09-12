"""Small real-media checks; no database, provider, or generation task is used."""
import io
import math
import shutil
import subprocess
import wave
from array import array
from unittest.mock import AsyncMock

import pytest
from services import episode_compose_service as compose
from services import enhance_media_duration_service as duration_service
from services.audio_transcription_service import _extract_audio

pytestmark = pytest.mark.skipif(not shutil.which('ffmpeg') or not shutil.which('ffprobe'), reason='FFmpeg tools required')


def ffmpeg(*args):
    return subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', *map(str, args)], capture_output=True, check=True, timeout=40).stdout


async def test_actual_black_export_reference_delay_and_local_subtitle_extraction(monkeypatch, tmp_path):
    storage = tmp_path / 'storage'
    storage.mkdir()
    video, voice = storage / 'video.mp4', storage / 'voice.wav'
    ffmpeg('-f','lavfi','-i','color=c=red:s=160x90:r=30:d=2', '-c:v','libx264','-pix_fmt','yuv420p',video)
    ffmpeg('-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=0.7',voice)
    monkeypatch.setattr(compose,'_STORAGE',str(storage))
    monkeypatch.setattr(compose,'_choose_output_size',lambda _: (160,90,'16:9'))
    monkeypatch.setattr(compose,'_get_shots',AsyncMock(return_value=[
        {'video_url':'/storage/video.mp4','duration_ms':2000,'reference_audio_layers':[
            {'audio_url':'/storage/voice.wav','start_ms':500,'duration_ms':700}]},
        {'is_black':True,'duration_ms':1500},
        {'video_url':'/storage/video.mp4','duration_ms':2000},
    ]))
    monkeypatch.setattr(compose.EpisodeComposeDAO,'list_audio_tracks',AsyncMock(return_value=[]))
    saved = AsyncMock()
    monkeypatch.setattr(compose.EpisodeComposeDAO,'create_final_cut_records',saved)
    job = {}
    await compose._compose('ep_test','test_user','test_project',job,audio_mode='reference_dubbing')
    output = compose._local(job['url'])
    assert job['status'] == 'done' and abs(await compose._probe_dur(output) - 5.5) < .15
    black = ffmpeg('-ss','2.7','-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','gray','pipe:1')
    assert max(black) <= 2
    audio, extracted_ms = _extract_audio(__import__('pathlib').Path(output),0,5500)
    assert 5400 <= extracted_ms <= 5600
    with wave.open(io.BytesIO(audio)) as wav:
        values = array('h',wav.readframes(wav.getnframes()))
    def rms(start,end):
        part = values[int(start*16000):int(end*16000)]
        return math.sqrt(sum(float(v)**2 for v in part)/len(part))
    assert rms(.1,.35) < 10 and rms(.65,.95) > 100 and rms(2.4,3.1) < 10
    monkeypatch.setattr(duration_service,'resolve_allowed_media_file',lambda *_args,**_kwargs: video)
    assert await duration_service.selected_video_duration({'file_path':str(video)}) == 2000
    saved.assert_awaited_once()
