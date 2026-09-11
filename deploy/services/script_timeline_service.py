"""Script, script segment, and timeline business logic."""
from __future__ import annotations

from typing import Any, Dict, Optional


class ScriptTimelineServiceError(RuntimeError):
    pass


class ScriptSaveFailed(ScriptTimelineServiceError):
    pass


class ScriptFileCreateFailed(ScriptTimelineServiceError):
    pass


class ScriptFileNotFound(ScriptTimelineServiceError):
    pass


class TimelineTrackCreateFailed(ScriptTimelineServiceError):
    pass


class TimelineTrackNotFound(ScriptTimelineServiceError):
    pass


async def list_script_segments(
    episode_id: str,
    script_id: Optional[str],
    *,
    episode_script_segment_dao: Any,
) -> Dict[str, Any]:
    if script_id:
        rows = await episode_script_segment_dao.list_by_script(episode_id, script_id)
    else:
        rows = await episode_script_segment_dao.list_by_episode(episode_id)
    return {"success": True, "segments": rows}


async def batch_save_script_segments(
    episode_id: str,
    script_id: Optional[str],
    segments: list,
    *,
    episode_script_segment_dao: Any,
) -> Dict[str, Any]:
    rows = await episode_script_segment_dao.batch_replace(episode_id, script_id, segments)
    return {"success": True, "segments": rows}


async def delete_script_segments(
    episode_id: str,
    script_id: Optional[str],
    *,
    episode_script_segment_dao: Any,
) -> Dict[str, Any]:
    count = await episode_script_segment_dao.delete_by_script(episode_id, script_id)
    return {"success": True, "deleted": count}


async def get_primary_script(
    episode_id: str,
    *,
    episode_script_dao: Any,
) -> Dict[str, Any]:
    script = await episode_script_dao.get_by_episode(episode_id)
    if not script:
        return {"success": True, "script": None}
    return {"success": True, "script": dict(script)}


async def update_primary_script(
    episode_id: str,
    *,
    original_content: Optional[str],
    adapted_script: Optional[str],
    metadata: Optional[dict],
    episode_script_dao: Any,
) -> Dict[str, Any]:
    script = await episode_script_dao.save_or_update(
        episode_id=episode_id,
        original_content=original_content or "",
        adapted_script=adapted_script or "",
        metadata=metadata,
    )
    if not script:
        raise ScriptSaveFailed("Script save failed")
    return {"success": True, "script": dict(script)}


async def list_scripts(
    episode_id: str,
    *,
    episode_script_dao: Any,
) -> Dict[str, Any]:
    scripts = await episode_script_dao.list_by_episode(episode_id)
    return {"success": True, "scripts": scripts}


async def create_script_file(
    episode_id: str,
    *,
    file_name: str,
    original_content: str,
    adapted_script: str,
    sort_order: Optional[int],
    metadata: Optional[dict],
    episode_script_dao: Any,
    source_type: Optional[str] = None,
    source_id: Optional[str] = None,
) -> Dict[str, Any]:
    resolved_sort_order = sort_order
    if resolved_sort_order is None:
        resolved_sort_order = await episode_script_dao.get_next_sort_order(episode_id)
    if bool(source_type) != bool(source_id):
        raise ScriptFileCreateFailed("source_type and source_id must be provided together")
    created = True
    if source_type and source_id:
        script, created = await episode_script_dao.get_or_create_by_source(
            episode_id,
            source_type=source_type,
            source_id=source_id,
            file_name=file_name,
            original_content=original_content,
            adapted_script=adapted_script,
            sort_order=resolved_sort_order,
            metadata=metadata,
        )
    else:
        script = await episode_script_dao.create(
            episode_id=episode_id,
            file_name=file_name,
            original_content=original_content,
            adapted_script=adapted_script,
            sort_order=resolved_sort_order,
            metadata=metadata,
        )
    if not script:
        raise ScriptFileCreateFailed("Script file create failed")
    return {"success": True, "script": dict(script), "created": created}


async def update_script_file(
    script_id: str,
    *,
    file_name: Optional[str],
    original_content: Optional[str],
    adapted_script: Optional[str],
    metadata: Optional[dict],
    episode_script_dao: Any,
) -> Dict[str, Any]:
    script = await episode_script_dao.update(
        script_id=script_id,
        file_name=file_name,
        original_content=original_content,
        adapted_script=adapted_script,
        metadata=metadata,
    )
    if not script:
        raise ScriptFileNotFound("Script file not found")
    return {"success": True, "script": dict(script)}


async def delete_script_file(
    script_id: str,
    *,
    episode_script_dao: Any,
) -> Dict[str, Any]:
    ok = await episode_script_dao.delete_by_id(script_id)
    if not ok:
        raise ScriptFileNotFound("Script file not found")
    return {"success": True}


async def list_timeline_tracks(
    episode_id: str,
    *,
    timeline_dao: Any,
) -> Dict[str, Any]:
    tracks = await timeline_dao.get_by_episode(episode_id)
    return {"success": True, "tracks": [dict(track) for track in tracks]}


async def create_timeline_track(
    episode_id: str,
    *,
    track_type: str,
    track_name: str,
    sort_order: int,
    items: Optional[list],
    timeline_dao: Any,
) -> Dict[str, Any]:
    track = await timeline_dao.create(
        episode_id=episode_id,
        track_type=track_type,
        track_name=track_name,
        sort_order=sort_order,
        items=items,
    )
    if not track:
        raise TimelineTrackCreateFailed("Timeline track create failed")
    return {"success": True, "track": dict(track)}


async def update_timeline_track(
    track_id: str,
    fields: Dict[str, Any],
    *,
    timeline_dao: Any,
) -> Dict[str, Any]:
    track = await timeline_dao.update(track_id, **fields)
    if not track:
        raise TimelineTrackNotFound("Timeline track not found")
    return {"success": True, "track": dict(track)}
