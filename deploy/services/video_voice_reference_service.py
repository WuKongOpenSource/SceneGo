"""Extract and persist a stable character voice reference from a generated video."""
from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional

import aiohttp

from file_service import save_generated_file_to_db
from services.remote_content_service import (
    RemoteContentTooLarge,
    configured_download_limit,
    write_aiohttp_response_limited,
)
from utils.net_guard import assert_public_http_url, safe_storage_path
from services.local_file_access_service import resolve_allowed_media_file
from services.media_reference_service import extract_file_reference_id, resolve_media_file_record


_DEPLOY_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class VideoVoiceReferenceError(RuntimeError):
    pass


class VideoVoiceReferenceValidationError(VideoVoiceReferenceError):
    pass


def _video_download_limit() -> int:
    return configured_download_limit(
        "MAX_REMOTE_VIDEO_DOWNLOAD_BYTES",
        1024 * 1024 * 1024,
    )


def _read_extracted_audio(audio_path: str) -> bytes:
    path = Path(audio_path)
    limit = configured_download_limit(
        "MAX_EXTRACTED_REFERENCE_AUDIO_BYTES",
        50 * 1024 * 1024,
    )
    if not path.is_file():
        raise VideoVoiceReferenceError("Extracted reference audio is missing")
    if path.stat().st_size > limit:
        raise VideoVoiceReferenceValidationError("Extracted reference audio exceeds the configured size limit")
    content = path.read_bytes()
    if len(content) > limit:
        raise VideoVoiceReferenceValidationError("Extracted reference audio exceeds the configured size limit")
    return content


async def _materialize_video(source_url: str, destination: str) -> None:
    clean_url = (source_url or "").split("?", 1)[0]
    max_bytes = _video_download_limit()
    if extract_file_reference_id(clean_url) or not clean_url.startswith(("/", "http://", "https://")):
        from dao_content import FileDAO

        record = await resolve_media_file_record(clean_url, FileDAO)
        source_path = resolve_allowed_media_file(
            str((record or {}).get("file_path") or ""), deploy_root=Path(_DEPLOY_ROOT),
        ) if record else None
        if source_path is None:
            raise VideoVoiceReferenceValidationError("Source video was not found")
        if source_path.stat().st_size > max_bytes:
            raise RemoteContentTooLarge(f"source video exceeds {max_bytes} bytes")
        await asyncio.to_thread(shutil.copy2, source_path, destination)
        return
    if clean_url.startswith("/storage/"):
        try:
            source_path = Path(safe_storage_path(clean_url, _DEPLOY_ROOT))
        except ValueError as exc:
            raise VideoVoiceReferenceValidationError("Invalid source video path") from exc
        if not source_path.is_file():
            raise VideoVoiceReferenceValidationError("Source video was not found")
        if source_path.stat().st_size > max_bytes:
            raise RemoteContentTooLarge(f"source video exceeds {max_bytes} bytes")
        shutil.copy2(source_path, destination)
        return
    if not clean_url.startswith(("http://", "https://")):
        raise VideoVoiceReferenceValidationError("Unsupported source video URL")
    assert_public_http_url(clean_url)
    timeout = aiohttp.ClientTimeout(total=120, connect=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(clean_url, allow_redirects=False) as response:
            if 300 <= response.status < 400:
                raise VideoVoiceReferenceValidationError("Remote video redirect was refused")
            response.raise_for_status()
            await write_aiohttp_response_limited(
                response,
                destination,
                max_bytes=max_bytes,
                chunk_size=128 * 1024,
            )


async def _extract_first_audio_stream(video_path: str, audio_path: str) -> None:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise VideoVoiceReferenceError("Server media tools are unavailable (ffmpeg/ffprobe)")

    probe = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=codec_type",
        "-of", "csv=p=0",
        video_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _stderr = await probe.communicate()
    if probe.returncode != 0 or "audio" not in stdout.decode("utf-8", "ignore").lower():
        raise VideoVoiceReferenceValidationError("The selected video has no audio track")

    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-y",
        "-loglevel", "error",
        "-i", video_path,
        "-map", "0:a:0",
        "-vn",
        "-codec:a", "libmp3lame",
        "-b:a", "192k",
        audio_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _stdout, stderr = await proc.communicate()
    if proc.returncode != 0 or not Path(audio_path).is_file():
        raise VideoVoiceReferenceError(
            f"Failed to extract video audio: {stderr.decode('utf-8', 'ignore')[:300]}"
        )


async def create_from_video(
    *,
    project_id: str,
    episode_id: str,
    character_name: str,
    source_video_url: str,
    user_id: str,
    video_voice_reference_dao: Any,
    episode_dao: Any,
    storyboard_item_id: Optional[str] = None,
    video_segment_id: Optional[str] = None,
    video_model: Optional[str] = None,
) -> Dict[str, Any]:
    normalized_character = (character_name or "").strip()
    if not normalized_character:
        raise VideoVoiceReferenceValidationError("Character name is required")
    if not source_video_url:
        raise VideoVoiceReferenceValidationError("Source video URL is required")
    actual_project_id = await episode_dao.get_project_id(episode_id)
    if not actual_project_id or actual_project_id != project_id:
        raise VideoVoiceReferenceValidationError("Episode does not belong to the project")

    saved = await extract_audio_reference_from_video(
        project_id=project_id,
        episode_id=episode_id,
        source_video_url=source_video_url,
        user_id=user_id,
        storyboard_item_id=storyboard_item_id,
        video_segment_id=video_segment_id,
        video_model=video_model,
        source="video_voice_reference",
        file_role="voice_reference_audio",
        extra_metadata={"character_name": normalized_character},
        episode_dao=episode_dao,
    )

    row = await video_voice_reference_dao.upsert(
        project_id=project_id,
        episode_id=episode_id,
        storyboard_item_id=storyboard_item_id,
        video_segment_id=video_segment_id,
        character_name=normalized_character,
        source_video_url=source_video_url,
        reference_audio_url=saved["audio_url"],
        video_model=video_model,
        created_by=user_id,
        metadata={"file_id": saved.get("file_id")},
    )
    if not row:
        raise VideoVoiceReferenceError("Failed to save video voice reference")
    return {"success": True, "reference": dict(row)}


async def extract_audio_reference_from_video(
    *,
    project_id: str,
    episode_id: str,
    source_video_url: str,
    user_id: str,
    episode_dao: Any,
    storyboard_item_id: Optional[str] = None,
    video_segment_id: Optional[str] = None,
    video_model: Optional[str] = None,
    source: str = "video_reference_audio",
    file_role: str = "reference_audio",
    extra_metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not source_video_url:
        raise VideoVoiceReferenceValidationError("Source video URL is required")
    actual_project_id = await episode_dao.get_project_id(episode_id)
    if not actual_project_id or actual_project_id != project_id:
        raise VideoVoiceReferenceValidationError("Episode does not belong to the project")

    entity_type = None
    entity_id = None
    if video_segment_id:
        entity_type = "video_segment"
        entity_id = video_segment_id
    elif storyboard_item_id:
        entity_type = "storyboard_item"
        entity_id = storyboard_item_id
    elif episode_id:
        entity_type = "episode"
        entity_id = episode_id

    with tempfile.TemporaryDirectory(prefix="video_reference_audio_") as tmpdir:
        video_path = os.path.join(tmpdir, "source.mp4")
        audio_path = os.path.join(tmpdir, "reference_audio.mp3")
        await _materialize_video(source_video_url, video_path)
        await _extract_first_audio_stream(video_path, audio_path)
        saved = await save_generated_file_to_db(
            content=_read_extracted_audio(audio_path),
            file_type="audio",
            user_id=user_id,
            source=source,
            entity_type=entity_type,
            entity_id=entity_id,
            file_role=file_role,
            original_ext=".mp3",
            project_id=project_id,
            episode_id=episode_id,
            extra_metadata={
                "source_video_url": source_video_url,
                "video_model": video_model,
                **(extra_metadata or {}),
            },
        )

    return {
        "success": True,
        "file_id": saved.get("file_id"),
        "audio_url": saved["file_url"],
        "source_video_url": source_video_url,
    }
