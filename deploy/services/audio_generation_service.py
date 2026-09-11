"""Generated audio persistence helpers for audio routes."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Awaitable, Callable, Mapping, MutableMapping, Optional

from services.api_provider_runtime import resolve_minimax_model_name


SaveGeneratedFile = Callable[..., Awaitable[dict[str, Any]]]
CreateMediaLibraryItem = Callable[..., Awaitable[Any]]


class AudioGenerationServiceError(RuntimeError):
    pass


class AudioGenerationValidationError(AudioGenerationServiceError):
    def __init__(self, detail: str, *, status_code: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


class AudioGenerationProviderError(AudioGenerationServiceError):
    pass


class AudioGenerationMissingAudioError(AudioGenerationServiceError):
    pass


async def _default_create_media_library_item(**kwargs: Any) -> Any:
    import media_library_service

    return await media_library_service.create_from_file(**kwargs)


async def attach_local_generated_audio_file(
    result: Mapping[str, Any] | None,
    *,
    audio_upload_dir: str | Path,
    user_id: str,
    source: str,
    entity_type: Optional[str],
    entity_id: Optional[str],
    file_role: str,
    episode_id: Optional[str],
    media_source: str,
    title: Optional[str],
    logger: Any,
    save_generated_file_to_db: SaveGeneratedFile,
    project_id: Optional[str] = None,
    create_media_library_item: Optional[CreateMediaLibraryItem] = None,
) -> MutableMapping[str, Any]:
    """Attach a DB file record for a provider-generated local audio URL.

    Providers return an `audio_url` that often points at a file already written
    under the local audio upload directory. This helper performs the shared
    best-effort tail work: read local bytes, register the generated file, and
    create a media-library index row with caller-specific metadata.
    """

    enriched: MutableMapping[str, Any] = dict(result or {})
    audio_url = enriched.get("audio_url") or ""
    if not audio_url:
        return enriched

    audio_filename = os.path.basename(str(audio_url))
    if not audio_filename:
        return enriched

    audio_file_path = Path(audio_upload_dir) / audio_filename
    if not audio_file_path.exists():
        logger.warning("Generated audio file not found for url=%s path=%s", audio_url, audio_file_path)
        return enriched

    try:
        saved = await save_generated_file_to_db(
            content=audio_file_path.read_bytes(),
            file_type="audio",
            user_id=user_id,
            source=source,
            entity_type=entity_type,
            entity_id=entity_id,
            file_role=file_role,
            original_ext=audio_file_path.suffix,
            project_id=project_id,
            episode_id=episode_id,
        )
        enriched["file_id"] = saved["file_id"]
        enriched["file_url"] = saved["file_url"]
    except Exception as exc:
        logger.warning("Failed to save generated audio to files table: %s", exc)
        return enriched

    media_library_creator = create_media_library_item or _default_create_media_library_item
    try:
        await media_library_creator(
            file_record=saved,
            source=media_source,
            project_id=project_id,
            episode_id=episode_id,
            source_entity_type=entity_type,
            source_entity_id=entity_id,
            title=title,
        )
    except Exception as exc:
        logger.warning("media_library sync failed (%s): %s", media_source, exc)

    return enriched


def _build_minimax_tts_kwargs(data: Any) -> dict[str, Any]:
    resolved_model, _model_env = resolve_minimax_model_name(
        getattr(data, "model", None),
        usage_scope=getattr(data, "model_scope", None) or "workflow",
    )
    kwargs = {
        "text": data.text,
        "voice_id": data.voice_id,
        "model": resolved_model or data.model,
        "speed": data.speed,
        "pitch": data.pitch,
    }
    if getattr(data, "emotion", None):
        kwargs["emotion"] = data.emotion
    return kwargs


async def generate_minimax_tts_sync_response(
    data: Any,
    *,
    user_id: str,
    client: Any,
    character_voice_dao: Any,
    logger: Any,
    save_generated_file_to_db: SaveGeneratedFile,
    create_media_library_item: Optional[CreateMediaLibraryItem] = None,
) -> dict[str, Any]:
    """Run the short-text MiniMax TTS fast path and persist its output."""

    if not getattr(data, "text", None) or not data.text.strip():
        raise AudioGenerationValidationError("text \u4e0d\u80fd\u4e3a\u7a7a", status_code=400)
    if len(data.text) > 1000:
        raise AudioGenerationValidationError(
            f"text \u8fc7\u957f ({len(data.text)} > 1000),"
            "\u8bf7\u6539\u7528 POST /api/minimax/tts (\u8d70 worker \u5f02\u6b65\u8def\u5f84, \u652f\u6301\u957f\u6587\u672c)",
            status_code=413,
        )

    try:
        result = await client.tts_sync(**_build_minimax_tts_kwargs(data)) or {}
    except Exception as exc:
        logger.error("MiniMax TTS sync provider call failed: text_len=%s err=%s", len(data.text), exc, exc_info=True)
        raise AudioGenerationProviderError(f"MiniMax TTS \u8c03\u7528\u5931\u8d25: {exc}") from exc

    audio_bytes = result.get("audio_bytes")
    if not audio_bytes:
        raise AudioGenerationMissingAudioError(f"MiniMax \u672a\u8fd4\u56de\u97f3\u9891\u5b57\u8282 trace_id={result.get('trace_id')}")

    saved = await save_generated_file_to_db(
        content=audio_bytes,
        file_type="audio",
        user_id=user_id,
        source="minimax",
        entity_type=data.entity_type,
        entity_id=data.entity_id,
        file_role=data.file_role or "dialogue_audio",
        original_ext=".mp3",
        project_id=getattr(data, "project_id", None),
        episode_id=data.episode_id,
        extra_metadata={
            "storyboard_lineage_id": getattr(data, "storyboard_lineage_id", None),
            "requested_entity_id": data.entity_id,
        },
    )
    file_id = saved["file_id"]
    file_url = saved["file_url"]

    media_library_creator = create_media_library_item or _default_create_media_library_item
    try:
        await media_library_creator(
            file_record=saved,
            source="generated_audio_minimax",
            project_id=getattr(data, "project_id", None),
            episode_id=data.episode_id,
            source_entity_type=data.entity_type,
            source_entity_id=data.entity_id,
            title=(getattr(data, "text", "") or "")[:80] or None,
        )
    except Exception as exc:
        logger.warning("media_library sync failed (minimax sync TTS): %s", exc)

    if data.bind_to_character_voice_id:
        try:
            await character_voice_dao.update_sample_audio_url(data.bind_to_character_voice_id, file_url)
        except Exception as exc:
            logger.warning(
                "sync TTS sample_audio_url write-back failed: voice_id=%s err=%s",
                data.bind_to_character_voice_id,
                exc,
            )

    logger.info(
        "MiniMax TTS sync completed: voice_id=%s text_len=%s duration_ms=%s trace_id=%s file_id=%s",
        data.voice_id,
        len(data.text),
        result.get("duration_ms"),
        result.get("trace_id"),
        file_id,
    )

    return {
        "success": True,
        "audio_url": file_url,
        "file_id": file_id,
        "file_url": file_url,
        "duration_ms": result.get("duration_ms"),
        "minimax_trace_id": result.get("trace_id"),
    }
