from unittest.mock import AsyncMock
import pytest
from utils.enhance_export import plan_export
from utils.reference_audio_anchors import normalize_anchors, reference_layers
from services import episode_compose_service as service


def test_selected_twelve_second_source_replaces_legacy_full_length_but_preserves_manual_trim():
    session = {'task_groups': [{'uuid':'g','videoSegmentId':'v','ids':['s1','s2']}], 'tasks_status': {'g': {'result':'/storage/new.mp4'}}}
    segments = [{'segment_id':'v','storyboard_item_id':'s1','duration_ms':5875}]
    files = [{'entity_id':'v','file_id':'f','file_url':'/storage/new.mp4','duration_seconds':12.074}]
    shots = [{'item_id':'s1','planned_duration_ms':3000},{'item_id':'s2','planned_duration_ms':3000}]
    old = [{'kind':'video','sourceId':'v','durationMs':5875,'sourceOffsetMs':0},
           {'kind':'audio','sourceId':'aud_sb_s2_mixed','startMs':40000},
           {'kind':'audio','sourceId':'aud_track_m','startMs':36000,'volume':.2}]
    _, result = plan_export(session, segments, files, old, shots)
    assert result[0]['durationMs'] == 12074 and result[0]['sourceDurationMs'] == 12074
    assert result[0]['storyboardAnchors'][1]['sourceStartMs'] == 6037
    assert not any(i.get('sourceId') == 'aud_sb_s2_mixed' for i in result)
    assert old[-1] in result
    old[0].update(durationMs=2000,sourceOffsetMs=1000)
    assert plan_export(session,segments,files,old,shots)[1][0]['durationMs'] == 2000


def test_reference_layers_use_only_episode_owned_media_and_keep_planned_silence():
    anchors = normalize_anchors([{'itemId':'s1','sourceStartMs':3000,'durationMs':3000}, {'itemId':'s2','sourceStartMs':6000,'durationMs':3000}])
    rows = [{'item_id':'s1','mixed_audio_url':'/voice1.wav','dialogue_audio_url':'/duplicate.wav','audio_duration_ms':2700},
            {'item_id':'s2','mixed_audio_url':'/voice2.wav','audio_duration_ms':2200}]
    assert reference_layers(anchors,rows) == [{'audio_url':'/voice1.wav','start_ms':3000,'duration_ms':2700}, {'audio_url':'/voice2.wav','start_ms':6000,'duration_ms':2200}]
    with pytest.raises(ValueError, match='episode'): reference_layers(anchors, rows[:1])


def test_reexport_preserves_black_between_split_cuts_and_after_removed_sources():
    session = {'task_groups': [{'uuid':'g','videoSegmentId':'v'}], 'tasks_status': {'g': {'result':'/storage/v.mp4'}}}
    segments = [{'segment_id':'v','duration_ms':12000}, {'segment_id':'old','duration_ms':5000}]
    files = [{'entity_id':'v','file_id':'f','file_url':'/storage/v.mp4','duration_seconds':12}]
    items = [{'kind':'video','clipId':'a','sourceId':'v','durationMs':6000},
             {'kind':'black','clipId':'b','durationMs':2000},
             {'kind':'video','clipId':'c','sourceId':'v','durationMs':6000,'sourceOffsetMs':6000},
             {'kind':'video','clipId':'old','sourceId':'old','durationMs':5000},
             {'kind':'black','clipId':'d','durationMs':3000}]
    cuts = [i for i in plan_export(session,segments,files,items)[1] if i['kind'] in ('video','black')]
    assert [i['clipId'] for i in cuts] == ['a','b','c','d']
    assert [i['startMs'] for i in cuts] == [0,6000,8000,14000]


async def test_black_clip_preflight_is_bounded_and_does_not_probe_an_imaginary_file(monkeypatch):
    monkeypatch.setattr(service, '_list_shot_takes', AsyncMock(return_value=[]))
    probe = AsyncMock()
    monkeypatch.setattr(service, '_probe_dur', probe)
    result = await service.preflight_timeline('ep',[{'clip_id':'black_1','segment_id':'black_1','is_black':True,'duration_ms':2500}])
    assert result[0]['is_black'] and result[0]['duration_ms'] == 2500
    probe.assert_not_called()


async def test_merged_reference_provenance_survives_shot_resolution(monkeypatch):
    monkeypatch.setattr(service, '_list_shot_takes', AsyncMock(return_value=[{'takes':[{'segment_id':'v','video_url':'/v.mp4'}]}]))
    owned = AsyncMock(return_value=[{'item_id':'s','mixed_audio_url':'/s.wav','audio_duration_ms':2200}])
    monkeypatch.setattr(service.EpisodeComposeDAO,'list_storyboard_audio_rows',owned)
    result = await service._get_shots('ep', timeline=[{'segment_id':'v','duration_ms':12000,'storyboard_anchors':[{'itemId':'s','sourceStartMs':3000,'durationMs':3000}]}])
    assert result[0]['reference_audio_layers'][0]['start_ms'] == 3000
    owned.assert_awaited_once_with('ep',['s'])
