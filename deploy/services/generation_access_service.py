"""Access checks shared by image and material generation routes."""
from __future__ import annotations

from typing import Any, Callable, Dict, Iterable, Optional

from services.entity_access_service import (
    EntityAccessDenied,
    require_entity_access,
    require_file_access,
)
from services.project_access_service import ProjectAccessDenied, require_project_access
from services.media_reference_service import (
    is_local_media_reference,
    resolve_media_file_record as _resolve_source_record,
)
from utils.net_guard import assert_public_http_url


class GenerationAccessDenied(LookupError):
    pass


class _GenerationFileAccessDAO:
    def __init__(self, file_dao: Any):
        self.file_dao = file_dao

    async def get_by_id(self, file_id: str) -> Optional[Dict[str, Any]]:
        return await self.file_dao.get_file(file_id)


def _text(value: Any) -> str:
    return str(value or "").strip()


def generation_source_references(request: Any) -> list[str]:
    """Collect every supported local/remote media reference from a task request."""
    references: list[str] = []

    def add(value: Any) -> None:
        clean = _text(value)
        if clean and clean not in references:
            references.append(clean)

    for field in (
        "image_path",
        "image_path_end",
        "video_filename",
        "audio_filename",
        "first_frame_image",
        "last_frame_image",
        *(f"image_path_{i}" for i in range(1, 7)),
        "image_BK",
        "image_HU",
        "image_MB",
    ):
        add(getattr(request, field, None))

    for item in getattr(request, "media_inputs", None) or []:
        if not isinstance(item, dict):
            continue
        # Check both values when a client sends both. Otherwise an authorized
        # URL could be paired with a different unauthorized database object.
        add(item.get("url"))
        add(item.get("file_id"))
    for image in getattr(request, "h3_reference_images", None) or []:
        add(image)
    for segment in getattr(request, "h3_long_video_segments", None) or []:
        if isinstance(segment, dict):
            add(segment.get("image_path"))
            add(segment.get("image_path_end"))
    return references


async def _resolve_request_scope(
    request: Any,
    identity: str,
    *,
    entity_access_checker: Callable[..., Any],
    project_access_checker: Callable[..., Any],
) -> Dict[str, str]:
    entity_type = _text(getattr(request, "entity_type", None))
    entity_id = _text(getattr(request, "entity_id", None))
    project_id = _text(getattr(request, "project_id", None))
    episode_id = _text(getattr(request, "episode_id", None))

    if bool(entity_type) != bool(entity_id):
        raise GenerationAccessDenied("Generation scope not found or access denied")

    resolved_project_id = ""
    resolved_episode_id = ""
    if entity_type and entity_id:
        try:
            entity_scope = await entity_access_checker(entity_type, entity_id, identity, "member")
        except (EntityAccessDenied, ProjectAccessDenied) as exc:
            raise GenerationAccessDenied("Generation scope not found or access denied") from exc
        resolved_project_id = _text(entity_scope.get("project_id"))
        resolved_episode_id = _text(entity_scope.get("episode_id"))

    if episode_id:
        try:
            episode_scope = await entity_access_checker("episode", episode_id, identity, "member")
        except (EntityAccessDenied, ProjectAccessDenied) as exc:
            raise GenerationAccessDenied("Generation scope not found or access denied") from exc
        episode_project_id = _text(episode_scope.get("project_id"))
        if resolved_project_id and episode_project_id != resolved_project_id:
            raise GenerationAccessDenied("Generation scope not found or access denied")
        if resolved_episode_id and episode_id != resolved_episode_id:
            raise GenerationAccessDenied("Generation scope not found or access denied")
        resolved_project_id = resolved_project_id or episode_project_id
        resolved_episode_id = episode_id

    if project_id:
        try:
            await project_access_checker(project_id, identity, "member")
        except ProjectAccessDenied as exc:
            raise GenerationAccessDenied("Generation scope not found or access denied") from exc
        if resolved_project_id and project_id != resolved_project_id:
            raise GenerationAccessDenied("Generation scope not found or access denied")
        resolved_project_id = project_id

    return {
        "project_id": resolved_project_id,
        "episode_id": resolved_episode_id,
    }


async def require_generation_request_access(
    request: Any,
    identity: str,
    source_references: Iterable[str],
    *,
    file_dao: Any,
    entity_access_checker: Callable[..., Any] = require_entity_access,
    project_access_checker: Callable[..., Any] = require_project_access,
    file_access_checker: Callable[..., Any] = require_file_access,
) -> Dict[str, str]:
    """Authorize the target scope and every local source before task submission."""
    scope = await _resolve_request_scope(
        request,
        identity,
        entity_access_checker=entity_access_checker,
        project_access_checker=project_access_checker,
    )
    access_dao = _GenerationFileAccessDAO(file_dao)

    for raw_source in source_references:
        source = _text(raw_source)
        if not source or source.startswith("data:"):
            continue

        record = await _resolve_source_record(source, file_dao)
        if record and record.get("file_id"):
            try:
                authorized = await file_access_checker(
                    _text(record["file_id"]),
                    identity,
                    "readonly",
                    file_dao=access_dao,
                )
            except EntityAccessDenied as exc:
                raise GenerationAccessDenied("Generation source not found or access denied") from exc
            source_project_id = _text(authorized.get("_access_project_id"))
            if scope["project_id"] and source_project_id and source_project_id != scope["project_id"]:
                raise GenerationAccessDenied("Generation source not found or access denied")
            continue

        # A task transfer treats these aliases as local files, even on an HTTP URL.
        if is_local_media_reference(source):
            raise GenerationAccessDenied("Generation source not found or access denied")

        if source.startswith(("http://", "https://")):
            try:
                assert_public_http_url(source)
            except ValueError as exc:
                raise GenerationAccessDenied("Generation source not found or access denied") from exc
            continue

        # Local paths and ComfyUI filenames must always have an ownership record.
        raise GenerationAccessDenied("Generation source not found or access denied")

    return scope
