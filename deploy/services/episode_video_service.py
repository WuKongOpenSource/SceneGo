"""Episode video segment and composition business logic."""
from __future__ import annotations

from typing import Any, Dict, Iterable, Optional

from services import episode_compose_service
from services.project_access_service import ProjectAccessDenied


class EpisodeVideoServiceError(RuntimeError):
    pass


class EpisodeNotFound(EpisodeVideoServiceError):
    pass


class VideoSegmentCreateFailed(EpisodeVideoServiceError):
    pass


class VideoSegmentNotFound(EpisodeVideoServiceError):
    pass


def _rows_to_dicts(rows: Iterable[Any]) -> list[Dict[str, Any]]:
    return [dict(row) for row in rows]


async def require_episode_access(
    episode_id: str,
    identity: str,
    role: str,
    *,
    episode_dao: Any,
    project_access_checker: Any,
) -> str:
    project_id = await episode_dao.get_project_id(episode_id)
    if not project_id:
        raise EpisodeNotFound("Episode not found")
    try:
        await project_access_checker(project_id, identity, role)
    except ProjectAccessDenied as exc:
        raise EpisodeNotFound("Episode not found") from exc
    return str(project_id)


async def require_video_segment_access(
    segment_id: str,
    identity: str,
    *,
    video_segment_dao: Any,
    episode_dao: Any,
    project_access_checker: Any,
) -> Dict[str, Any]:
    segment = await video_segment_dao.get_by_id(segment_id)
    if not segment:
        raise VideoSegmentNotFound("Video segment not found")
    await require_episode_access(
        str(segment["episode_id"]),
        identity,
        "member",
        episode_dao=episode_dao,
        project_access_checker=project_access_checker,
    )
    return dict(segment)


async def list_video_segments(
    episode_id: str,
    *,
    video_segment_dao: Any,
) -> Dict[str, Any]:
    segments = await video_segment_dao.get_by_episode(episode_id)
    return {"success": True, "segments": _rows_to_dicts(segments)}


async def get_video_takes(
    episode_id: str,
    *,
    compose_service: Any = episode_compose_service,
) -> Dict[str, Any]:
    shots = await compose_service.get_takes(episode_id)
    return {"success": True, "shots": shots}


async def preflight_episode_compose(
    episode_id: str,
    timeline: Optional[Any],
    *,
    episode_dao: Any,
    compose_service: Any = episode_compose_service,
) -> Dict[str, Any]:
    project_id = await episode_dao.get_project_id(episode_id)
    if not project_id:
        raise EpisodeNotFound("Episode not found")
    validated = await compose_service.preflight_timeline(episode_id, timeline)
    return {
        "success": True,
        "timeline": validated,
        "corrected": any(bool(item.get("duration_corrected")) for item in validated),
    }


async def start_episode_compose(
    episode_id: str,
    user_id: str,
    selections: Optional[Any],
    audio_mode: str = "reference_dubbing",
    timeline: Optional[Any] = None,
    subtitles: Optional[Any] = None,
    subtitle_style: Optional[Any] = None,
    *,
    episode_dao: Any,
    compose_service: Any = episode_compose_service,
) -> Dict[str, Any]:
    project_id = await episode_dao.get_project_id(episode_id)
    if not project_id:
        raise EpisodeNotFound("Episode not found")
    if timeline is None and subtitles is None and subtitle_style is None:
        job = compose_service.start_compose(
            episode_id,
            user_id,
            project_id,
            selections,
            audio_mode,
        )
    else:
        job = compose_service.start_compose(
            episode_id,
            user_id,
            project_id,
            selections,
            audio_mode,
            timeline,
            subtitles,
            subtitle_style,
        )
    return {
        "success": True,
        "status": job["status"],
        "total": job["total"],
        "done": job["done"],
        "audio_mode": job.get("audio_mode", "reference_dubbing"),
    }


def get_episode_compose_status(
    episode_id: str,
    *,
    compose_service: Any = episode_compose_service,
) -> Dict[str, Any]:
    return {"success": True, **compose_service.get_status(episode_id)}


async def create_video_segment(
    episode_id: str,
    *,
    sort_order: int,
    storyboard_item_id: Optional[str],
    generation_mode: str,
    model: str,
    input_params: Optional[dict],
    video_segment_dao: Any,
) -> Dict[str, Any]:
    segment = await video_segment_dao.create(
        episode_id=episode_id,
        sort_order=sort_order,
        storyboard_item_id=storyboard_item_id,
        generation_mode=generation_mode,
        model=model,
        input_params=input_params,
    )
    if not segment:
        raise VideoSegmentCreateFailed("Video segment create failed")
    return {"success": True, "segment": dict(segment)}


async def update_video_segment(
    segment_id: str,
    fields: Dict[str, Any],
    *,
    video_segment_dao: Any,
) -> Dict[str, Any]:
    segment = await video_segment_dao.update(segment_id, **fields)
    if not segment:
        raise VideoSegmentNotFound("Video segment not found")
    if fields.get("video_url"):
        try:
            from dao.creative.content_workflow import ContentWorkflowDAO
            from services.content_workflow_service import register_generated_take

            await register_generated_take(
                user_id=None,
                file_id=None,
                file_type="video",
                entity_type="video_segment",
                entity_id=segment_id,
                file_role="video",
                source="video_segment",
                project_id=None,
                episode_id=segment.get("episode_id"),
                metadata={
                    "task_id": segment.get("task_id"),
                    "model": segment.get("model"),
                    "generation_params": segment.get("input_params") or {},
                },
                workflow_dao=ContentWorkflowDAO,
            )
        except Exception:
            # The legacy update remains authoritative during rolling migration.
            pass
    return {"success": True, "segment": dict(segment)}


async def delete_video_segment(
    segment_id: str,
    *,
    video_segment_dao: Any,
) -> Dict[str, Any]:
    ok = await video_segment_dao.delete(segment_id)
    if not ok:
        raise VideoSegmentNotFound("Video segment not found")
    return {"success": True}
