"""Access control for files attached to project workflow entities."""
from __future__ import annotations

import json
from typing import Any, Dict, Optional

from dao_asset import AssetDAO
from dao_episode import EpisodeDAO
from dao_storyboard import StoryboardDAO
from dao_video_segment import VideoSegmentDAO
from services.project_access_service import (
    ProjectAccessDenied,
    require_project_access,
    resolve_user_id,
)


class EntityAccessDenied(LookupError):
    pass


def _row_dict(row: Any) -> Dict[str, Any]:
    return dict(row or {})


def _metadata(row: Dict[str, Any]) -> Dict[str, Any]:
    value = row.get("metadata") or {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            value = {}
    return value if isinstance(value, dict) else {}


async def resolve_entity_scope(
    entity_type: str,
    entity_id: str,
    *,
    episode_dao: Any = EpisodeDAO,
    storyboard_dao: Any = StoryboardDAO,
    asset_dao: Any = AssetDAO,
    video_segment_dao: Any = VideoSegmentDAO,
) -> Dict[str, Optional[str]]:
    """Resolve a supported workflow entity to its project and episode."""
    kind = str(entity_type or "").strip().lower()
    target_id = str(entity_id or "").strip()
    if not kind or not target_id:
        raise EntityAccessDenied("Entity not found or access denied")

    if kind == "project":
        return {"project_id": target_id, "episode_id": None}

    if kind == "episode":
        row = _row_dict(await episode_dao.get_episode(target_id))
        if not row:
            raise EntityAccessDenied("Entity not found or access denied")
        return {"project_id": str(row.get("project_id") or "") or None, "episode_id": target_id}

    if kind in {"storyboard_item", "material"}:
        row = _row_dict(await storyboard_dao.get_by_id(target_id))
        episode_id = str(row.get("episode_id") or "")
        if not episode_id:
            raise EntityAccessDenied("Entity not found or access denied")
        project_id = await episode_dao.get_project_id(episode_id)
        return {"project_id": str(project_id or "") or None, "episode_id": episode_id}

    if kind == "asset":
        row = _row_dict(await asset_dao.get_by_id(target_id))
        project_id = str(row.get("project_id") or "")
        if not project_id:
            raise EntityAccessDenied("Entity not found or access denied")
        return {
            "project_id": project_id,
            "episode_id": str(row.get("episode_id") or "") or None,
        }

    if kind == "video_segment":
        row = _row_dict(await video_segment_dao.get_by_id(target_id))
        episode_id = str(row.get("episode_id") or "")
        if not episode_id:
            raise EntityAccessDenied("Entity not found or access denied")
        project_id = await episode_dao.get_project_id(episode_id)
        return {"project_id": str(project_id or "") or None, "episode_id": episode_id}

    raise EntityAccessDenied("Unsupported entity type")


async def require_entity_access(
    entity_type: str,
    entity_id: str,
    identity: str,
    required_role: str = "readonly",
    **scope_dependencies: Any,
) -> Dict[str, Optional[str]]:
    scope = await resolve_entity_scope(entity_type, entity_id, **scope_dependencies)
    project_id = str(scope.get("project_id") or "")
    if not project_id:
        raise EntityAccessDenied("Entity not found or access denied")
    try:
        await require_project_access(project_id, identity, required_role)
    except ProjectAccessDenied as exc:
        raise EntityAccessDenied("Entity not found or access denied") from exc
    return scope


async def require_file_access(
    file_id: str,
    identity: str,
    required_role: str = "readonly",
    *,
    file_dao: Any,
    **scope_dependencies: Any,
) -> Dict[str, Any]:
    # cluster_main still injects the legacy content FileDAO, whose equivalent
    # lookup is named get_file. Keep the access layer compatible with both DAO
    # contracts so post-generation selection cannot fail after a file is saved.
    lookup = getattr(file_dao, "get_by_id", None)
    if not callable(lookup):
        lookup = getattr(file_dao, "get_file", None)
    if not callable(lookup):
        raise EntityAccessDenied("File not found or access denied")

    row = _row_dict(await lookup(file_id))
    if not row:
        raise EntityAccessDenied("File not found or access denied")

    metadata = _metadata(row)
    project_id = str(row.get("project_id") or metadata.get("project_id") or "")
    episode_id = str(row.get("episode_id") or metadata.get("episode_id") or "")

    if not project_id and episode_id:
        project_id = str(await EpisodeDAO.get_project_id(episode_id) or "")

    if not project_id and row.get("entity_type") and row.get("entity_id"):
        try:
            scope = await resolve_entity_scope(
                str(row["entity_type"]),
                str(row["entity_id"]),
                **scope_dependencies,
            )
            project_id = str(scope.get("project_id") or "")
        except EntityAccessDenied:
            project_id = ""

    if project_id:
        try:
            await require_project_access(project_id, identity, required_role)
        except ProjectAccessDenied as exc:
            raise EntityAccessDenied("File not found or access denied") from exc
        row["_access_project_id"] = project_id
        return row

    canonical_user_id = await resolve_user_id(identity)
    owner = str(row.get("user_id") or "")
    if owner and owner in {str(identity or ""), str(canonical_user_id or "")}:
        row["_access_project_id"] = ""
        return row
    raise EntityAccessDenied("File not found or access denied")
