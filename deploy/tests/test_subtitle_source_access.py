from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from services.generation_access_service import GenerationAccessDenied
from routers import audio


@pytest.fixture
def route(monkeypatch):
    monkeypatch.setattr(audio, 'require_audio_episode_access', AsyncMock())
    monkeypatch.setattr(audio, 'require_generation_request_access', AsyncMock(return_value={}))
    monkeypatch.setattr(audio, 'get_transcription_capability', lambda: {'available':True,'model':'whisper-1'})
    monkeypatch.setattr(audio, 'transcribe_timeline_audio', AsyncMock(return_value=[]))
    async def current(): return 'u1'
    router=audio.create_audio_router(get_current_user_dependency=current,audio_track_dao=Mock(),character_voice_dao=Mock(),episode_dao=Mock(),provider_object_dao=Mock(),user_dao=Mock(),get_audio_provider_func=Mock(),audio_upload_dir='unused',require_minimax_client=Mock(),task_service_module=Mock(),save_generated_file_to_db_provider=Mock(),logger=Mock(),file_dao=Mock())
    return next(r for r in router.routes if r.path.endswith('/transcribe-timeline'))


def body(route, **overrides):
    field=route.dependant.body_params[0]
    model=getattr(field,'type_',None) or field.field_info.annotation
    return model(episode_id='ep1',clips=[{'clip_id':'v1','audio_url':'/storage/v.mp4','duration_ms':500,**overrides}])


async def test_route_passes_authorized_context_and_never_mutates_timeline(route):
    data=body(route)
    result=await route.endpoint('ep1',data,user_id='u1')
    assert result == {'success':True,'subtitles':[],'model':'whisper-1'}
    audio.require_audio_episode_access.assert_awaited_once()
    audio.require_generation_request_access.assert_awaited_once()
    assert audio.transcribe_timeline_audio.await_args.kwargs['user_id']=='u1'


async def test_route_stops_on_foreign_scope_or_file(route, monkeypatch):
    with pytest.raises(HTTPException) as exc:
        await route.endpoint('other',body(route),user_id='u1')
    assert exc.value.status_code == 422
    monkeypatch.setattr(audio,'require_generation_request_access',AsyncMock(side_effect=GenerationAccessDenied('denied')))
    with pytest.raises(HTTPException) as exc:
        await route.endpoint('ep1',body(route),user_id='u1')
    assert exc.value.status_code == 404
    audio.transcribe_timeline_audio.assert_not_called()


@pytest.mark.parametrize('override', [{'duration_ms':True},{'duration_ms':60001},{'duration_ms':0},{'source_offset_ms':-1},{'media_kind':'image'}])
def test_route_rejects_invalid_contract(route, override):
    with pytest.raises(ValidationError):
        body(route,**override)
