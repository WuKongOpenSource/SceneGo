"""Episode CRUD, duplication, and reorder business logic."""
from __future__ import annotations

import json
from typing import Any, Dict, Iterable, Optional


class EpisodeServiceError(RuntimeError):
    pass


class EpisodeNotFound(EpisodeServiceError):
    pass


class EpisodeDuplicateFailed(EpisodeServiceError):
    pass


def _row_to_dict(row: Any) -> Optional[Dict[str, Any]]:
    return dict(row) if row is not None else None


def _rows_to_dicts(rows: Iterable[Any]) -> list[Dict[str, Any]]:
    return [dict(row) for row in rows]


def _parse_json_object(value: Any) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _has_script_content(script: Any) -> bool:
    if not script:
        return False
    original = str(script.get("original_content") or "").strip()
    adapted = str(script.get("adapted_script") or "").strip()
    return bool(original or adapted)


async def _apply_effective_episode_status(
    episodes: list[Dict[str, Any]],
    *,
    episode_script_dao: Any = None,
) -> list[Dict[str, Any]]:
    if episode_script_dao is None:
        return episodes

    normalized: list[Dict[str, Any]] = []
    for episode in episodes:
        row = dict(episode)
        stored_status = str(row.get("status") or "draft")
        row["status"] = stored_status
        if stored_status == "draft":
            scripts = await episode_script_dao.list_by_episode(str(row.get("episode_id") or ""))
            if any(_has_script_content(script) for script in scripts):
                row["status"] = "in_progress"
        normalized.append(row)
    return normalized


async def list_episodes(
    project_id: str,
    *,
    episode_dao: Any,
    episode_script_dao: Any = None,
) -> Dict[str, Any]:
    episodes = await episode_dao.get_episodes(project_id)
    rows = await _apply_effective_episode_status(
        _rows_to_dicts(episodes),
        episode_script_dao=episode_script_dao,
    )
    return {"success": True, "episodes": rows}


async def create_episode(
    project_id: str,
    *,
    episode_name: str,
    description: str,
    episode_dao: Any,
) -> Dict[str, Any]:
    episode_number = await episode_dao.get_next_episode_number(project_id)
    episode = await episode_dao.create_episode(
        project_id=project_id,
        episode_number=episode_number,
        episode_name=episode_name or f"第{episode_number}集",
        description=description,
    )
    return {"success": True, "episode": _row_to_dict(episode)}


async def get_episode(
    episode_id: str,
    *,
    episode_dao: Any,
) -> Dict[str, Any]:
    episode = await episode_dao.get_episode(episode_id)
    if not episode:
        raise EpisodeNotFound("Episode not found")
    return {"success": True, "episode": dict(episode)}


async def get_workflow_script(
    episode_id: str,
    *,
    episode_dao: Any,
    episode_script_dao: Any,
) -> Dict[str, Any]:
    episode = await episode_dao.get_episode(episode_id)
    if not episode:
        raise EpisodeNotFound("Episode not found")

    scripts = await episode_script_dao.list_by_episode(episode_id)
    settings = _parse_json_object(episode.get("settings"))
    selected_id = settings.get("workflow_script_id")
    selected = next((row for row in scripts if row.get("script_id") == selected_id), None)
    if selected is None and scripts:
        selected = scripts[0]
        selected_id = selected.get("script_id")
        await episode_dao.set_workflow_script(episode_id, selected_id)

    return {
        "success": True,
        "script_id": selected_id if selected else None,
        "script": dict(selected) if selected else None,
    }


async def select_workflow_script(
    episode_id: str,
    script_id: str,
    *,
    episode_dao: Any,
    episode_script_dao: Any,
) -> Dict[str, Any]:
    script = await episode_script_dao.get_by_id(script_id)
    if not script or script.get("episode_id") != episode_id:
        raise EpisodeNotFound("Script does not belong to episode")
    episode = await episode_dao.set_workflow_script(episode_id, script_id)
    if not episode:
        raise EpisodeNotFound("Episode not found")
    return {"success": True, "script_id": script_id, "script": dict(script)}


async def update_episode(
    episode_id: str,
    fields: Dict[str, Any],
    *,
    episode_dao: Any,
) -> Dict[str, Any]:
    await episode_dao.update_episode(
        episode_id=episode_id,
        episode_name=fields.get("episode_name"),
        description=fields.get("description"),
        status=fields.get("status"),
        settings=fields.get("settings"),
        sort_order=fields.get("sort_order"),
    )
    return {"success": True}


async def delete_episode(
    episode_id: str,
    *,
    episode_dao: Any,
) -> Dict[str, Any]:
    await episode_dao.delete_episode(episode_id)
    return {"success": True}


async def duplicate_episode(
    episode_id: str,
    *,
    episode_dao: Any,
    episode_script_dao: Any,
) -> Dict[str, Any]:
    source = await episode_dao.get_episode(episode_id)
    if not source:
        raise EpisodeNotFound("Episode not found")

    settings = _parse_json_object(source.get("settings"))
    project_id = source["project_id"]
    episode_number = await episode_dao.get_next_episode_number(project_id)
    source_name = source.get("episode_name") or "未命名分集"
    new_episode = await episode_dao.create_episode(
        project_id=project_id,
        episode_number=episode_number,
        episode_name=f"{source_name} 副本",
        description=source.get("description") or "",
        settings=settings or None,
    )
    if not new_episode:
        raise EpisodeDuplicateFailed("Duplicate episode failed")

    new_episode_id = new_episode["episode_id"]
    scripts = await episode_script_dao.list_by_episode(episode_id)
    for script in scripts:
        metadata = _parse_json_object(script.get("metadata"))
        await episode_script_dao.create(
            episode_id=new_episode_id,
            file_name=script.get("file_name") or "未命名文件",
            original_content=script.get("original_content") or "",
            adapted_script=script.get("adapted_script") or "",
            sort_order=script.get("sort_order") or 0,
            metadata=metadata or None,
        )

    return {"success": True, "episode": dict(new_episode), "copied_scripts": len(scripts)}


async def reorder_episodes(
    project_id: str,
    episode_ids: list[str],
    *,
    episode_dao: Any,
) -> Dict[str, Any]:
    await episode_dao.reorder_episodes(project_id, episode_ids)
    return {"success": True}
