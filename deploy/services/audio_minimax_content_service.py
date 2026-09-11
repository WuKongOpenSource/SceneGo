"""MiniMax generated content helpers for audio routes."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from services.audio_generation_service import (
    CreateMediaLibraryItem,
    SaveGeneratedFile,
    attach_local_generated_audio_file,
)


async def query_minimax_tts_response(*, client: Any, task_id: str) -> dict[str, Any]:
    result = await client.tts_query(task_id)
    return {"success": True, **result}


async def generate_minimax_music_response(
    data: Any,
    *,
    user_id: str,
    client: Any,
    audio_upload_dir: str | Path,
    logger: Any,
    save_generated_file_to_db: SaveGeneratedFile,
    create_media_library_item: Optional[CreateMediaLibraryItem] = None,
) -> dict[str, Any]:
    result = await client.music_generate(
        lyrics=data.lyrics,
        prompt=getattr(data, "prompt", ""),
        refer_voice=data.refer_voice,
        refer_instrumental=data.refer_instrumental,
        model=getattr(data, "model", None),
        is_instrumental=getattr(data, "is_instrumental", False),
        lyrics_optimizer=getattr(data, "lyrics_optimizer", False),
    )
    response = {
        "success": True,
        "audio_url": result.get("audio_url", ""),
        "duration_ms": result.get("duration_ms", 0),
    }
    return dict(
        await attach_local_generated_audio_file(
            response,
            audio_upload_dir=audio_upload_dir,
            user_id=user_id,
            source="minimax",
            entity_type=data.entity_type,
            entity_id=data.entity_id,
            file_role=data.file_role or "background_music",
            project_id=getattr(data, "project_id", None),
            episode_id=data.episode_id,
            media_source="generated_audio_minimax_music",
            title=(getattr(data, "lyrics", "") or "")[:80] or None,
            logger=logger,
            save_generated_file_to_db=save_generated_file_to_db,
            create_media_library_item=create_media_library_item,
        )
    )


async def generate_minimax_lyrics_response(
    *,
    client: Any,
    text: str,
    language: str,
    mode: str = "write_full_song",
    lyrics: str = "",
    title: str = "",
) -> dict[str, Any]:
    result = await client.lyrics_generate(
        text=text,
        language=language,
        mode=mode,
        lyrics=lyrics,
        title=title,
    )
    lyrics = result.get("lyrics") or result.get("data", {}).get("lyrics", "")
    return {
        "success": True,
        "lyrics": lyrics,
        "song_title": result.get("song_title", ""),
        "style_tags": result.get("style_tags", ""),
    }
