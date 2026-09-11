"""Object-level access checks for episode audio tracks and character voices."""
from __future__ import annotations

from typing import Any, Dict

from services.project_access_service import ProjectAccessDenied


class AudioObjectAccessDenied(LookupError):
    pass


async def require_audio_episode_access(
    episode_id: str,
    identity: str,
    required_role: str,
    *,
    episode_dao: Any,
    project_access_checker: Any,
) -> str:
    project_id = str(await episode_dao.get_project_id(episode_id) or "")
    if not project_id:
        raise AudioObjectAccessDenied("Audio object not found or access denied")
    try:
        await project_access_checker(project_id, identity, required_role)
    except ProjectAccessDenied as exc:
        raise AudioObjectAccessDenied("Audio object not found or access denied") from exc
    return project_id


async def require_audio_track_access(
    track_id: str,
    identity: str,
    required_role: str,
    *,
    audio_track_dao: Any,
    episode_dao: Any,
    project_access_checker: Any,
) -> Dict[str, Any]:
    row = await audio_track_dao.get_by_id(track_id)
    track = dict(row or {})
    episode_id = str(track.get("episode_id") or "")
    if not episode_id:
        raise AudioObjectAccessDenied("Audio object not found or access denied")
    await require_audio_episode_access(
        episode_id,
        identity,
        required_role,
        episode_dao=episode_dao,
        project_access_checker=project_access_checker,
    )
    return track


async def require_character_voice_access(
    voice_id: str,
    identity: str,
    required_role: str,
    *,
    character_voice_dao: Any,
    project_access_checker: Any,
) -> Dict[str, Any]:
    row = await character_voice_dao.get_by_id(voice_id)
    voice = dict(row or {})
    project_id = str(voice.get("project_id") or "")
    if not project_id:
        raise AudioObjectAccessDenied("Audio object not found or access denied")
    try:
        await project_access_checker(project_id, identity, required_role)
    except ProjectAccessDenied as exc:
        raise AudioObjectAccessDenied("Audio object not found or access denied") from exc
    return voice
