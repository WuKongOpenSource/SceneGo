"""Audio track, generated audio, MiniMax, and character voice routes."""

import logging
import os
from typing import Any, Callable, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field

from services.audio_access_service import (
    AudioObjectAccessDenied,
    require_audio_episode_access,
    require_audio_track_access,
    require_character_voice_access,
)
from services.audio_generation_service import (
    AudioGenerationMissingAudioError,
    AudioGenerationProviderError,
    AudioGenerationValidationError,
    attach_local_generated_audio_file,
    generate_minimax_tts_sync_response,
)
from services.audio_minimax_content_service import (
    generate_minimax_lyrics_response,
    generate_minimax_music_response,
    query_minimax_tts_response,
)
from services.audio_minimax_file_service import (
    MiniMaxFileProviderError,
    MiniMaxFileValidationError,
    delete_minimax_file_response,
    retrieve_minimax_file_response,
    upload_minimax_file_response,
)
from services.audio_minimax_voice_service import (
    clone_minimax_voice_response,
    delete_minimax_voice_response,
    design_minimax_voice_response,
    list_minimax_voices_response,
)
from services.project_access_service import ProjectAccessDenied, require_project_access
from services.generation_access_service import GenerationAccessDenied, require_generation_request_access
from services.provider_object_access_service import (
    ProviderObjectAccessDenied,
    filter_minimax_voice_payload,
    find_minimax_voice,
    owned_provider_object_ids,
    record_provider_object,
    reject_foreign_provider_object,
    require_provider_object_owner,
)
from services.audio_transcription_service import (
    AudioTranscriptionError, AudioTranscriptionBusy, transcribe_timeline_audio,
    transcription_capability as get_transcription_capability,
)
from services.ai_proxy_types import AIProxyError


def create_audio_router(
    *,
    get_current_user_dependency: Any,
    audio_track_dao: Any,
    character_voice_dao: Any,
    episode_dao: Any,
    provider_object_dao: Any,
    user_dao: Any,
    get_audio_provider_func: Callable[[str], Any],
    audio_upload_dir: str,
    require_minimax_client: Callable[[], Any],
    task_service_module: Any,
    save_generated_file_to_db_provider: Callable[[], Callable[..., Any]],
    logger: logging.Logger,
    file_dao: Any = None,
    project_access_checker: Any = require_project_access,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    AudioTrackDAO = audio_track_dao
    CharacterVoiceDAO = character_voice_dao
    EpisodeDAO = episode_dao
    ProviderObjectDAO = provider_object_dao
    UserDAO = user_dao
    FileDAO = file_dao
    get_audio_provider = get_audio_provider_func
    AUDIO_UPLOAD_DIR = audio_upload_dir
    task_service = task_service_module

    def _require_minimax_client():
        return require_minimax_client()

    def _minimax_voice_object_type(voice_type: str) -> str:
        return "minimax_voice_generation" if voice_type in {"voice_generation", "voice_design"} else "minimax_voice_cloning"

    async def save_generated_file_to_db(*args, **kwargs):
        return await save_generated_file_to_db_provider()(*args, **kwargs)


    class AudioTrackCreate(BaseModel):
        track_type: str
        name: str = ''
        audio_url: Optional[str] = None
        duration_ms: Optional[int] = None
        start_item_id: Optional[str] = None
        end_item_id: Optional[str] = None
        generation_params: Optional[dict] = None


    class AudioTrackUpdate(BaseModel):
        name: Optional[str] = None
        audio_url: Optional[str] = None
        duration_ms: Optional[int] = None
        start_item_id: Optional[str] = None
        end_item_id: Optional[str] = None
        generation_params: Optional[dict] = None


    @router.get("/api/episodes/{episode_id}/audio-tracks")
    async def get_audio_tracks(episode_id: str, user_id: str = Depends(get_current_user)):
        try:
            await require_audio_episode_access(
                episode_id,
                user_id,
                "readonly",
                episode_dao=EpisodeDAO,
                project_access_checker=project_access_checker,
            )
        except AudioObjectAccessDenied:
            raise HTTPException(status_code=404, detail="音频轨不存在")
        tracks = await AudioTrackDAO.get_by_episode(episode_id)
        return {"success": True, "tracks": [dict(t) for t in tracks]}


    @router.post("/api/episodes/{episode_id}/audio-tracks")
    async def create_audio_track(episode_id: str, data: AudioTrackCreate, user_id: str = Depends(get_current_user)):
        try:
            await require_audio_episode_access(
                episode_id,
                user_id,
                "member",
                episode_dao=EpisodeDAO,
                project_access_checker=project_access_checker,
            )
        except AudioObjectAccessDenied:
            raise HTTPException(status_code=404, detail="音频轨不存在")
        track = await AudioTrackDAO.create(
            episode_id=episode_id, track_type=data.track_type, name=data.name,
            audio_url=data.audio_url, duration_ms=data.duration_ms,
            start_item_id=data.start_item_id, end_item_id=data.end_item_id,
            generation_params=data.generation_params
        )
        if not track:
            raise HTTPException(status_code=500, detail="创建音频轨失败")
        return {"success": True, "track": dict(track)}


    @router.put("/api/audio-tracks/{track_id}")
    async def update_audio_track(track_id: str, data: AudioTrackUpdate, user_id: str = Depends(get_current_user)):
        try:
            await require_audio_track_access(
                track_id,
                user_id,
                "member",
                audio_track_dao=AudioTrackDAO,
                episode_dao=EpisodeDAO,
                project_access_checker=project_access_checker,
            )
        except AudioObjectAccessDenied:
            raise HTTPException(status_code=404, detail="音频轨不存在")
        updates = data.model_dump(exclude_unset=True)
        track = await AudioTrackDAO.update(track_id, **updates)
        if not track:
            raise HTTPException(status_code=404, detail="音频轨不存在")
        return {"success": True, "track": dict(track)}


    @router.delete("/api/audio-tracks/{track_id}")
    async def delete_audio_track(track_id: str, user_id: str = Depends(get_current_user)):
        try:
            await require_audio_track_access(
                track_id,
                user_id,
                "member",
                audio_track_dao=AudioTrackDAO,
                episode_dao=EpisodeDAO,
                project_access_checker=project_access_checker,
            )
        except AudioObjectAccessDenied:
            raise HTTPException(status_code=404, detail="音频轨不存在")
        ok = await AudioTrackDAO.delete(track_id)
        if not ok:
            raise HTTPException(status_code=404, detail="音频轨不存在")
        return {"success": True}




    class SpeechGenRequest(BaseModel):
        text: str
        persona: str = 'narrator'
        emotion: str = 'neutral'
        entity_type: Optional[str] = None
        entity_id: Optional[str] = None
        file_role: Optional[str] = None
        project_id: Optional[str] = None
        episode_id: Optional[str] = None

    class SFXGenRequest(BaseModel):
        description: str
        entity_type: Optional[str] = None
        entity_id: Optional[str] = None
        file_role: Optional[str] = None
        project_id: Optional[str] = None
        episode_id: Optional[str] = None

    class MusicGenRequest(BaseModel):
        description: str
        duration_ms: Optional[int] = None
        entity_type: Optional[str] = None
        entity_id: Optional[str] = None
        file_role: Optional[str] = None
        project_id: Optional[str] = None
        episode_id: Optional[str] = None

    class TimelineTranscriptionClip(BaseModel):
        clip_id: str = Field(min_length=1, max_length=200)
        audio_url: str = Field(min_length=1, max_length=4096)
        media_kind: Literal['audio', 'video'] = "audio"
        source_offset_ms: int = Field(default=0, ge=0, strict=True)
        duration_ms: int = Field(ge=100, le=60_000, strict=True)

    class TimelineTranscriptionRequest(BaseModel):
        project_id: Optional[str] = None
        episode_id: str
        clips: list[TimelineTranscriptionClip] = Field(min_length=1, max_length=10)

    @router.get("/api/episodes/{episode_id}/audio/transcription-capability")
    async def transcription_capability(episode_id: str, user_id: str = Depends(get_current_user)):
        try:
            await require_audio_episode_access(
                episode_id,
                user_id,
                "readonly",
                episode_dao=EpisodeDAO,
                project_access_checker=project_access_checker,
            )
        except AudioObjectAccessDenied:
            raise HTTPException(status_code=404, detail="分集不存在")
        return get_transcription_capability()

    @router.post("/api/episodes/{episode_id}/audio/transcribe-timeline")
    async def transcribe_timeline(
        episode_id: str,
        data: TimelineTranscriptionRequest,
        user_id: str = Depends(get_current_user),
    ):
        if data.episode_id != episode_id:
            raise HTTPException(status_code=422, detail="分集范围不一致")
        try:
            await require_audio_episode_access(
                episode_id,
                user_id,
                "member",
                episode_dao=EpisodeDAO,
                project_access_checker=project_access_checker,
            )
            await require_generation_request_access(data, user_id, [clip.audio_url for clip in data.clips], file_dao=FileDAO)
            capability = get_transcription_capability()
            if not capability['available']:
                raise HTTPException(status_code=503, detail=capability['reason'])
            subtitles = await transcribe_timeline_audio(
                [clip.model_dump() for clip in data.clips],
                file_dao=FileDAO,
                user_id=user_id,
            )
            return {"success": True, "subtitles": subtitles, "model": capability['model']}
        except (AudioObjectAccessDenied, GenerationAccessDenied):
            raise HTTPException(status_code=404, detail="配音片段不存在或无权访问")
        except AudioTranscriptionBusy as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        except AudioTranscriptionError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        except AIProxyError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail)


    @router.post("/api/audio/generate-speech")
    async def gen_speech(data: SpeechGenRequest, user_id: str = Depends(get_current_user)):
        try:
            _require_minimax_client()
            provider = get_audio_provider('minimax')
            result = await provider.generate_speech(data.text, persona=data.persona, emotion=data.emotion)
            result = await attach_local_generated_audio_file(
                result,
                audio_upload_dir=AUDIO_UPLOAD_DIR,
                user_id=user_id,
                source='minimax',
                entity_type=data.entity_type,
                entity_id=data.entity_id,
                file_role=data.file_role or 'dialogue_audio',
                project_id=data.project_id,
                episode_id=data.episode_id,
                media_source='generated_audio_minimax_speech',
                title=(getattr(data, 'text', '') or '')[:80] or None,
                logger=logger,
                save_generated_file_to_db=save_generated_file_to_db,
            )
            return {"success": True, **result}
        except HTTPException:
            raise
        except Exception as e:
            msg = str(e)
            if 'MINIMAX_API_KEY' in msg or '\u672a\u914d\u7f6e' in msg:
                raise HTTPException(
                    status_code=503,
                    detail=(
                        "MINIMAX_API_KEY \u672a\u914d\u7f6e: \u8bf7\u5728\u7ba1\u7406\u5458\u540e\u53f0 -> API \u914d\u7f6e "
                        "\u4e2d\u6dfb\u52a0 provider=minimax \u7684\u5bc6\u94a5; \u4fdd\u5b58\u540e\u4f1a\u5b9e\u65f6\u5237\u65b0."
                    ),
                )
            logger.error("generate_speech failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=msg)

    @router.post("/api/audio/generate-sfx")
    async def gen_sfx(data: SFXGenRequest, user_id: str = Depends(get_current_user)):
        try:
            _require_minimax_client()
            provider = get_audio_provider('minimax')
            result = await provider.generate_sfx(data.description)
            result = await attach_local_generated_audio_file(
                result,
                audio_upload_dir=AUDIO_UPLOAD_DIR,
                user_id=user_id,
                source='minimax',
                entity_type=data.entity_type,
                entity_id=data.entity_id,
                file_role=data.file_role or 'sfx_audio',
                project_id=data.project_id,
                episode_id=data.episode_id,
                media_source='generated_audio_minimax_sfx',
                title=(getattr(data, 'description', '') or '')[:80] or None,
                logger=logger,
                save_generated_file_to_db=save_generated_file_to_db,
            )
            return {"success": True, **result}
        except HTTPException:
            raise
        except Exception as e:
            logger.error("generate_sfx failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/audio/generate-music")
    async def gen_music(data: MusicGenRequest, user_id: str = Depends(get_current_user)):
        try:
            _require_minimax_client()
            provider = get_audio_provider('minimax')
            result = await provider.generate_music(data.description, duration_ms=data.duration_ms)
            result = await attach_local_generated_audio_file(
                result,
                audio_upload_dir=AUDIO_UPLOAD_DIR,
                user_id=user_id,
                source='minimax',
                entity_type=data.entity_type,
                entity_id=data.entity_id,
                file_role=data.file_role or 'background_music',
                project_id=data.project_id,
                episode_id=data.episode_id,
                media_source='generated_audio_minimax_music',
                title=(getattr(data, 'description', '') or '')[:80] or None,
                logger=logger,
                save_generated_file_to_db=save_generated_file_to_db,
            )
            return {"success": True, **result}
        except HTTPException:
            raise
        except Exception as e:
            logger.error("generate_music failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))



    class MinimaxVoiceDesignRequest(BaseModel):
        prompt: str
        preview_text: str
        voice_id: Optional[str] = None

    class MinimaxVoiceCloneRequest(BaseModel):
        file_id: str
        voice_id: Optional[str] = None
        demo_text: Optional[str] = "你好，这是一段测试语音。"
        model: str = "speech-2.8-hd"
        voice_id_prefix: str = "clone"

    class MinimaxTTSRequest(BaseModel):
        model_config = ConfigDict(protected_namespaces=())

        text: str
        voice_id: str
        model: str = "speech-2.8-hd"
        model_scope: Optional[str] = None
        speed: float = 1.0
        pitch: int = 0
        emotion: Optional[str] = None
        entity_type: Optional[str] = None
        entity_id: Optional[str] = None
        file_role: Optional[str] = None
        project_id: Optional[str] = None
        episode_id: Optional[str] = None
        storyboard_lineage_id: Optional[str] = None


        bind_to_character_voice_id: Optional[str] = None

    class MinimaxMusicRequest(BaseModel):
        prompt: str = ""
        lyrics: str = ""
        model: Optional[str] = None
        is_instrumental: bool = False
        lyrics_optimizer: bool = False
        # Retained for old clients; current models do not receive these fields.
        refer_voice: str = ""
        refer_instrumental: str = ""
        entity_type: Optional[str] = None
        entity_id: Optional[str] = None
        file_role: Optional[str] = None
        project_id: Optional[str] = None
        episode_id: Optional[str] = None

    class MinimaxLyricsRequest(BaseModel):
        text: str
        language: str = "zh"
        mode: str = "write_full_song"
        lyrics: str = ""
        title: str = ""


    @router.post("/api/minimax/voice-design")
    async def minimax_voice_design(data: MinimaxVoiceDesignRequest, user_id: str = Depends(get_current_user)):
        try:
            if data.voice_id:
                await reject_foreign_provider_object(
                    provider="minimax",
                    object_types=("minimax_voice_generation", "minimax_voice_cloning"),
                    object_id=data.voice_id,
                    owner_identity=user_id,
                    provider_object_dao=ProviderObjectDAO,
                )
            result = await design_minimax_voice_response(
                client=_require_minimax_client(),
                prompt=data.prompt,
                preview_text=data.preview_text,
                voice_id=data.voice_id,
            )
            await record_provider_object(
                provider="minimax",
                object_type="minimax_voice_generation",
                object_id=str(result.get("voice_id") or ""),
                owner_identity=user_id,
                provider_object_dao=ProviderObjectDAO,
            )
            return result
        except ProviderObjectAccessDenied as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"MiniMax voice_design 失败: {e}")
            raise HTTPException(status_code=500, detail=str(e))


    @router.post("/api/minimax/voice-clone")
    async def minimax_voice_clone(data: MinimaxVoiceCloneRequest, user_id: str = Depends(get_current_user)):
        try:
            await require_provider_object_owner(
                provider="minimax",
                object_type="minimax_file",
                object_id=data.file_id,
                owner_identity=user_id,
                provider_object_dao=ProviderObjectDAO,
            )
            if data.voice_id:
                await reject_foreign_provider_object(
                    provider="minimax",
                    object_types=("minimax_voice_generation", "minimax_voice_cloning"),
                    object_id=data.voice_id,
                    owner_identity=user_id,
                    provider_object_dao=ProviderObjectDAO,
                )
            result = await clone_minimax_voice_response(
                client=_require_minimax_client(),
                file_id=data.file_id,
                voice_id=data.voice_id,
                demo_text=data.demo_text,
                model=data.model,
                voice_id_prefix=data.voice_id_prefix,
            )
            await record_provider_object(
                provider="minimax",
                object_type="minimax_voice_cloning",
                object_id=str(result.get("voice_id") or ""),
                owner_identity=user_id,
                provider_object_dao=ProviderObjectDAO,
                metadata={"source_file_id": data.file_id},
            )
            return result
        except ProviderObjectAccessDenied as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"MiniMax voice_clone 失败: {e}")
            raise HTTPException(status_code=502, detail=str(e))


    @router.get("/api/minimax/voices")
    async def minimax_list_voices(voice_type: str = "all", user_id: str = Depends(get_current_user)):
        try:
            owned_ids = await owned_provider_object_ids(
                provider="minimax",
                object_types=("minimax_voice_cloning", "minimax_voice_generation"),
                owner_identity=user_id,
                provider_object_dao=ProviderObjectDAO,
            )
            result = await list_minimax_voices_response(client=_require_minimax_client(), voice_type=voice_type)
            return filter_minimax_voice_payload(result, owned_ids)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


    @router.get("/api/minimax/voices/{voice_id}")
    async def minimax_get_voice(voice_id: str, user_id: str = Depends(get_current_user)):
        try:
            owned_ids = await owned_provider_object_ids(
                provider="minimax",
                object_types=("minimax_voice_cloning", "minimax_voice_generation"),
                owner_identity=user_id,
                provider_object_dao=ProviderObjectDAO,
            )
            result = await list_minimax_voices_response(client=_require_minimax_client(), voice_type="all")
            voice = find_minimax_voice(filter_minimax_voice_payload(result, owned_ids), voice_id)
            if not voice:
                raise HTTPException(status_code=404, detail="Voice not found or access denied")
            return voice
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


    @router.delete("/api/minimax/voices/{voice_id}")
    async def minimax_delete_voice(
        voice_id: str,
        voice_type: str = "voice_cloning",
        user_id: str = Depends(get_current_user),
    ):
        try:
            object_type = _minimax_voice_object_type(voice_type)
            await require_provider_object_owner(
                provider="minimax",
                object_type=object_type,
                object_id=voice_id,
                owner_identity=user_id,
                provider_object_dao=ProviderObjectDAO,
            )
            result = await delete_minimax_voice_response(
                client=_require_minimax_client(),
                voice_id=voice_id,
                voice_type=voice_type,
            )
            await ProviderObjectDAO.delete(
                provider="minimax",
                object_type=object_type,
                object_id=voice_id,
            )
            return result
        except ProviderObjectAccessDenied as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


    @router.post("/api/minimax/tts")
    async def minimax_tts(data: MinimaxTTSRequest, user_id: str = Depends(get_current_user)):
        # Text-only input has no media sources, but its output scope and voice
        # binding still require authorization before provider work or billing.
        try:
            scope = await require_generation_request_access(
                data, user_id, (), file_dao=None,
                project_access_checker=project_access_checker,
            )
            if data.bind_to_character_voice_id:
                try:
                    data.bind_to_character_voice_id = str(UUID(data.bind_to_character_voice_id))
                except ValueError as exc:
                    raise AudioObjectAccessDenied("Character voice not found") from exc
                voice = await require_character_voice_access(
                    data.bind_to_character_voice_id, user_id, "member",
                    character_voice_dao=CharacterVoiceDAO,
                    project_access_checker=project_access_checker,
                )
                if scope["project_id"] and scope["project_id"] != str(voice.get("project_id") or ""):
                    raise AudioObjectAccessDenied("Character voice is outside the output scope")
        except (GenerationAccessDenied, AudioObjectAccessDenied) as exc:
            raise HTTPException(status_code=404, detail="音频生成对象不存在或无权访问") from exc

        if data.voice_id.startswith(("clone", "ttv-voice-")):
            try:
                await reject_foreign_provider_object(
                    provider="minimax",
                    object_types=("minimax_voice_generation", "minimax_voice_cloning"),
                    object_id=data.voice_id,
                    owner_identity=user_id,
                    provider_object_dao=ProviderObjectDAO,
                )
            except ProviderObjectAccessDenied as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc


        try:
            _require_minimax_client()
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        task_data = {
            "text": data.text,
            "voice_id": data.voice_id,
            "model": data.model,
            "speed": data.speed,
            "pitch": data.pitch,
            "emotion": data.emotion,
            "entity_type": data.entity_type,
            "entity_id": data.entity_id,
            "file_role": data.file_role,
            "project_id": data.project_id,
            "episode_id": data.episode_id,
            "storyboard_lineage_id": data.storyboard_lineage_id,
        }


        bind = getattr(data, 'bind_to_character_voice_id', None)
        if bind:
            task_data['bind_to_character_voice_id'] = bind

        try:
            svc = task_service.get()
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=f"任务服务未就绪: {e}")

        try:
            task_id = await svc.submit(
                task_type='minimax_tts',
                task_data=task_data,
                user_id=user_id,
                priority=2,
                prepare=False,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(
                f"MiniMax TTS 入队失败: text_len={len(data.text or '')} err={e}",
                exc_info=True,
            )
            raise HTTPException(status_code=500, detail=f"TTS 入队失败: {e}")

        logger.info(
            f"📤 MiniMax TTS 已入队: task_id={task_id} voice_id={data.voice_id} "
            f"text_len={len(data.text or '')}"
        )
        return {"success": True, "task_id": task_id}


    @router.post("/api/minimax/tts/sync")
    async def minimax_tts_sync(
        data: MinimaxTTSRequest,
        user_id: str = Depends(get_current_user),
    ):
        try:
            if str(data.file_role or "").startswith("studio_"):
                if not data.episode_id or data.entity_type != "episode" or data.entity_id != data.episode_id:
                    raise HTTPException(status_code=400, detail="Invalid Studio episode scope")
                try:
                    episode_project_id = await require_audio_episode_access(
                        data.episode_id,
                        user_id,
                        "member",
                        episode_dao=EpisodeDAO,
                        project_access_checker=project_access_checker,
                    )
                except AudioObjectAccessDenied as exc:
                    raise HTTPException(status_code=404, detail="Studio episode not found") from exc
                if data.project_id and data.project_id != episode_project_id:
                    raise HTTPException(status_code=404, detail="Studio episode not found")
            if data.voice_id.startswith(("clone", "ttv-voice-")):
                await reject_foreign_provider_object(
                    provider="minimax",
                    object_types=("minimax_voice_generation", "minimax_voice_cloning"),
                    object_id=data.voice_id,
                    owner_identity=user_id,
                    provider_object_dao=ProviderObjectDAO,
                )
            return await generate_minimax_tts_sync_response(
                data,
                user_id=user_id,
                client=_require_minimax_client(),
                character_voice_dao=CharacterVoiceDAO,
                logger=logger,
                save_generated_file_to_db=save_generated_file_to_db,
            )
        except ProviderObjectAccessDenied as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except AudioGenerationValidationError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        except (AudioGenerationProviderError, AudioGenerationMissingAudioError) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @router.get("/api/minimax/tts/{task_id}")
    async def minimax_tts_query(task_id: str, user_id: str = Depends(get_current_user)):






        try:
            if not await UserDAO.is_admin_user(user_id):
                raise HTTPException(status_code=404, detail="Task not found")
            return await query_minimax_tts_response(client=_require_minimax_client(), task_id=task_id)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


    @router.post("/api/minimax/music")
    async def minimax_music(data: MinimaxMusicRequest, user_id: str = Depends(get_current_user)):
        try:
            return await generate_minimax_music_response(
                data,
                user_id=user_id,
                client=_require_minimax_client(),
                audio_upload_dir=AUDIO_UPLOAD_DIR,
                logger=logger,
                save_generated_file_to_db=save_generated_file_to_db,
            )
        except Exception as e:
            logger.error("MiniMax music failed: %s", e)
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/minimax/lyrics")
    async def minimax_lyrics(data: MinimaxLyricsRequest, user_id: str = Depends(get_current_user)):
        try:
            return await generate_minimax_lyrics_response(
                client=_require_minimax_client(),
                text=data.text,
                language=data.language,
                mode=data.mode,
                lyrics=data.lyrics,
                title=data.title,
            )
        except Exception as e:
            logger.error(f"MiniMax lyrics 失败: {e}")
            raise HTTPException(status_code=500, detail=str(e))


    @router.post("/api/minimax/files/upload")
    async def minimax_file_upload(
        file: UploadFile = File(...),
        purpose: str = Form("voice_clone"),
        user_id: str = Depends(get_current_user),
    ):
        try:
            result = await upload_minimax_file_response(
                upload_file=file,
                purpose=purpose,
                audio_upload_dir=AUDIO_UPLOAD_DIR,
                client=_require_minimax_client(),
                logger=logger,
            )
            await record_provider_object(
                provider="minimax",
                object_type="minimax_file",
                object_id=str(result.get("file_id") or ""),
                owner_identity=user_id,
                provider_object_dao=ProviderObjectDAO,
                metadata={"purpose": purpose},
            )
            return result
        except MiniMaxFileValidationError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        except MiniMaxFileProviderError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc


    @router.get("/api/minimax/files/{file_id}")
    async def minimax_file_retrieve(file_id: str, user_id: str = Depends(get_current_user)):
        try:
            await require_provider_object_owner(
                provider="minimax",
                object_type="minimax_file",
                object_id=file_id,
                owner_identity=user_id,
                provider_object_dao=ProviderObjectDAO,
            )
            return await retrieve_minimax_file_response(file_id=file_id, client=_require_minimax_client())
        except ProviderObjectAccessDenied as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


    @router.delete("/api/minimax/files/{file_id}")
    async def minimax_file_delete(file_id: str, user_id: str = Depends(get_current_user)):
        try:
            await require_provider_object_owner(
                provider="minimax",
                object_type="minimax_file",
                object_id=file_id,
                owner_identity=user_id,
                provider_object_dao=ProviderObjectDAO,
            )
            result = await delete_minimax_file_response(file_id=file_id, client=_require_minimax_client())
            await ProviderObjectDAO.delete(
                provider="minimax",
                object_type="minimax_file",
                object_id=file_id,
            )
            return result
        except ProviderObjectAccessDenied as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))





    class CharacterVoiceCreate(BaseModel):
        project_id: str
        character_name: str
        asset_id: Optional[str] = None
        voice_provider: Optional[str] = None
        voice_model_id: Optional[str] = None
        voice_name: Optional[str] = None
        voice_params: Optional[dict] = None
        sample_audio_url: Optional[str] = None

    class CharacterVoiceUpdate(BaseModel):
        character_name: Optional[str] = None
        asset_id: Optional[str] = None
        voice_provider: Optional[str] = None
        voice_model_id: Optional[str] = None
        voice_name: Optional[str] = None
        voice_params: Optional[dict] = None
        sample_audio_url: Optional[str] = None


    @router.post("/api/character-voices")
    async def create_character_voice(data: CharacterVoiceCreate, user_id: str = Depends(get_current_user)):
        try:
            await project_access_checker(data.project_id, user_id, "member")
        except ProjectAccessDenied:
            raise HTTPException(status_code=404, detail="项目不存在")
        voice = await CharacterVoiceDAO.create(
            project_id=data.project_id, character_name=data.character_name,
            asset_id=data.asset_id, voice_provider=data.voice_provider,
            voice_model_id=data.voice_model_id, voice_name=data.voice_name,
            voice_params=data.voice_params, sample_audio_url=data.sample_audio_url,
        )
        if not voice:
            raise HTTPException(status_code=500, detail="创建音色失败")
        return {"success": True, "voice": dict(voice)}


    @router.get("/api/projects/{project_id}/character-voices")
    async def get_character_voices(project_id: str, user_id: str = Depends(get_current_user)):
        try:
            await project_access_checker(project_id, user_id, "readonly")
        except ProjectAccessDenied:
            raise HTTPException(status_code=404, detail="项目不存在")
        voices = await CharacterVoiceDAO.get_by_project(project_id)
        return {"success": True, "voices": [dict(v) for v in voices]}


    @router.put("/api/character-voices/{voice_id}")
    async def update_character_voice(voice_id: str, data: CharacterVoiceUpdate, user_id: str = Depends(get_current_user)):
        try:
            await require_character_voice_access(
                voice_id,
                user_id,
                "member",
                character_voice_dao=CharacterVoiceDAO,
                project_access_checker=project_access_checker,
            )
        except AudioObjectAccessDenied:
            raise HTTPException(status_code=404, detail="音色不存在")
        voice = await CharacterVoiceDAO.update(voice_id, **data.dict(exclude_none=True))
        if not voice:
            raise HTTPException(status_code=404, detail="音色不存在")
        return {"success": True, "voice": dict(voice)}


    @router.delete("/api/character-voices/{voice_id}")
    async def delete_character_voice(voice_id: str, user_id: str = Depends(get_current_user)):
        try:
            await require_character_voice_access(
                voice_id,
                user_id,
                "member",
                character_voice_dao=CharacterVoiceDAO,
                project_access_checker=project_access_checker,
            )
        except AudioObjectAccessDenied:
            raise HTTPException(status_code=404, detail="音色不存在")
        ok = await CharacterVoiceDAO.delete(voice_id)
        if not ok:
            raise HTTPException(status_code=404, detail="音色不存在")
        return {"success": True}




    return router
