"""Project video-task export and cleanup service."""
from __future__ import annotations

from datetime import datetime
import json
from typing import Any, Awaitable, Callable, Iterable

from services.project_image_service import (
    is_data_image,
    persist_export_storyboard_base64_image,
)
from utils.json_helpers import parse_jsonb_field


class ProjectVideoTaskError(RuntimeError):
    pass


class ProjectVideoTaskNotFound(ProjectVideoTaskError):
    pass


class ProjectVideoTaskForbidden(ProjectVideoTaskError):
    pass


ImagePersister = Callable[..., Awaitable[Any]]


async def _get_owned_project(
    project_id: str,
    *,
    username: str,
    project_dao: Any,
) -> dict[str, Any]:
    db_project = await project_dao.get_project(project_id)
    if not db_project:
        raise ProjectVideoTaskNotFound("project not found")
    if db_project.get("user_id") != username:
        raise ProjectVideoTaskForbidden("project access denied")
    return db_project


async def _ensure_export_version(
    project_id: str,
    *,
    username: str,
    version_dao: Any,
    logger: Any,
) -> str:
    versions = await version_dao.get_project_versions(project_id)
    if versions:
        version_id = versions[0]["version_id"]
        logger.info("Using existing export version: %s", version_id)
        return version_id

    export_version = await version_dao.create_version(
        project_id=project_id,
        user_id=username,
        version_name="\u5bfc\u51fa\u7248\u672c",
        description="\u753b\u9762\u5206\u955c\u5bfc\u51fa\u5230\u89c6\u9891\u751f\u6210",
    )
    version_id = export_version["version_id"]
    logger.info("Created export version: %s", version_id)
    return version_id


def _select_image_url(shot_images_data: Any, logger: Any, item_id: str) -> tuple[str, Any]:
    if not isinstance(shot_images_data, dict):
        return "", None

    generated_images = shot_images_data.get("images", [])
    selected_image_id = shot_images_data.get("selectedImageId")
    logger.info("Shot %s has %s generated images, selected=%s", item_id, len(generated_images), selected_image_id)

    selected_img = None
    image_url = ""
    if selected_image_id and generated_images:
        selected_img = next((img for img in generated_images if img.get("id") == selected_image_id), None)
        if selected_img:
            image_url = selected_img.get("url") or selected_img.get("thumbnail") or ""
            if image_url:
                logger.info("Selected image found for shot %s: %s...", item_id, image_url[:50])
            else:
                logger.warning("Selected image has no url or thumbnail: %s", item_id)

    if not selected_img and generated_images:
        selected_img = generated_images[0]
        image_url = selected_img.get("url") or selected_img.get("thumbnail") or ""
        if image_url:
            logger.info("Selected image missing for shot %s, using first image: %s...", item_id, image_url[:50])
        else:
            logger.warning("First image has no url or thumbnail: %s", item_id)

    return image_url, selected_img


def _as_dict(row: Any) -> dict[str, Any]:
    if not row:
        return {}
    if isinstance(row, dict):
        return row
    try:
        return dict(row)
    except Exception:
        return {}


def _parse_bound_assets(raw: Any) -> list[Any]:
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return []
    return raw if isinstance(raw, list) else []


def _bound_asset_names(raw: Any, prefix: str) -> list[str]:
    names: list[str] = []
    for item in _parse_bound_assets(raw):
        if isinstance(item, str):
            if item.startswith(prefix):
                names.append(item[len(prefix):])
        elif isinstance(item, dict):
            kind = item.get("asset_type") or item.get("assetType") or item.get("type")
            name = item.get("name") or item.get("asset_name") or item.get("assetName")
            expected = prefix[:-1]
            if kind == expected and name:
                names.append(str(name))
    return names


def _bound_asset_tag_keys(raw: Any) -> list[str]:
    keys: list[str] = []
    seen: set[str] = set()
    for item in _parse_bound_assets(raw):
        if not isinstance(item, str):
            continue
        value = item.strip()
        if not value.startswith(("char:", "scene:", "prop:")) or value in seen:
            continue
        seen.add(value)
        keys.append(value)
    return keys


async def _resolve_live_bindings(
    *,
    project_id: str,
    item_id: str,
    row: dict[str, Any],
    content_workflow_dao: Any,
    logger: Any,
) -> list[dict[str, Any]]:
    if not content_workflow_dao:
        return []
    tag_keys = _bound_asset_tag_keys(row.get("bound_assets") or row.get("boundAssets"))
    if not tag_keys:
        return []
    resolver = getattr(content_workflow_dao, "resolve_bindings", None)
    if not callable(resolver):
        return []
    try:
        rows = await resolver(project_id, item_id, tag_keys)
    except Exception as exc:
        logger.warning("Failed to resolve live bindings for shot %s: %s", item_id, exc)
        return []
    return [
        {
            "binding_id": item.get("binding_id"),
            "binding_version": item.get("binding_version"),
            "tag_key": item.get("tag_key"),
            "scope": item.get("scope"),
            "asset_id": item.get("asset_id"),
            "file_id": item.get("file_id"),
            "file_url": item.get("effective_url"),
            "is_disabled": bool(item.get("is_disabled")),
            "locked": bool(item.get("locked")),
        }
        for raw in rows
        for item in [dict(raw)]
    ]


async def _get_storyboard_row(
    item_id: str,
    *,
    storyboard_dao: Any,
    logger: Any,
) -> dict[str, Any]:
    if not item_id or not storyboard_dao:
        return {}
    getter = getattr(storyboard_dao, "get_by_id", None)
    if not callable(getter):
        return {}
    try:
        return _as_dict(await getter(item_id))
    except Exception as exc:
        logger.warning("Failed to load storyboard item %s for video export: %s", item_id, exc)
        return {}


async def _select_entity_file_url(
    item_id: str,
    *,
    entity_file_dao: Any,
    logger: Any,
) -> str:
    if not item_id or not entity_file_dao:
        return ""

    getter = getattr(entity_file_dao, "get_selected_file", None)
    if callable(getter):
        try:
            selected = _as_dict(await getter("storyboard_item", item_id, "generated_image"))
            file_url = selected.get("file_url") or selected.get("file_path") or ""
            if file_url:
                logger.info("Using selected entity file for shot %s: %s...", item_id, file_url[:50])
                return file_url
        except Exception as exc:
            logger.warning("Failed to load selected entity file for shot %s: %s", item_id, exc)

    list_files = getattr(entity_file_dao, "get_entity_files", None)
    if not callable(list_files):
        return ""
    try:
        result = await list_files("storyboard_item", item_id, "generated_image", limit=50, offset=0)
    except Exception as exc:
        logger.warning("Failed to list entity files for shot %s: %s", item_id, exc)
        return ""

    files = result.get("items", []) if isinstance(result, dict) else []
    selected = next((f for f in files if _as_dict(f).get("is_selected")), None)
    fallback = selected or (files[0] if files else None)
    file_row = _as_dict(fallback)
    file_url = file_row.get("file_url") or file_row.get("file_path") or ""
    if file_url:
        logger.info("Using entity file fallback for shot %s: %s...", item_id, file_url[:50])
    return file_url


async def _select_export_image_url(
    *,
    item_id: str,
    generated_images_data: dict[str, Any],
    storyboard_dao: Any,
    entity_file_dao: Any,
    logger: Any,
) -> tuple[str, dict[str, Any]]:
    row = await _get_storyboard_row(item_id, storyboard_dao=storyboard_dao, logger=logger)

    file_url = await _select_entity_file_url(item_id, entity_file_dao=entity_file_dao, logger=logger)
    if file_url:
        return file_url, row

    db_url = row.get("generated_image_url") or row.get("generatedImageUrl") or ""
    if db_url:
        logger.info("Using storyboard_items.generated_image_url for shot %s: %s...", item_id, db_url[:50])
        return db_url, row

    image_url, _selected_img = _select_image_url(generated_images_data.get(item_id, {}), logger, item_id)
    return image_url, row


def _legacy_or_db_text(item: dict[str, Any], row: dict[str, Any], db_key: str, legacy_key: str) -> str:
    value = row.get(db_key)
    if value:
        return str(value)
    legacy_value = item.get(legacy_key)
    return str(legacy_value or "")


def _characters_for_task(item: dict[str, Any], row: dict[str, Any]) -> list[Any]:
    names = _bound_asset_names(row.get("bound_assets") or row.get("boundAssets"), "char:")
    if names:
        return names
    legacy = item.get("characters", [])
    return legacy if isinstance(legacy, list) else []


def _scene_for_task(item: dict[str, Any], row: dict[str, Any]) -> str:
    names = _bound_asset_names(row.get("bound_assets") or row.get("boundAssets"), "scene:")
    if names:
        return names[0]
    return str(item.get("scene") or "")


async def _persist_image_if_needed(
    *,
    image_url: str,
    item: dict[str, Any],
    username: str,
    version_id: str,
    file_dao: Any,
    logger: Any,
    persist_image: ImagePersister,
) -> str:
    if image_url and is_data_image(image_url):
        logger.info("Detected base64 storyboard image for export: %s", image_url[:50])
        try:
            persisted = await persist_image(
                username=username,
                image_data=image_url,
                storyboard_item=item,
                version_id=version_id,
                file_dao=file_dao,
                logger=logger,
            )
            logger.info("Export image persisted: file_id=%s", persisted.file_id)
            return persisted.file_url
        except Exception as exc:
            logger.error("Base64 export image conversion failed: %s", exc, exc_info=True)
            logger.warning("Using original base64 image as fallback")
            return image_url
    if image_url:
        logger.info("Image already uses URL format: %s", image_url[:100])
    return image_url


def _unique_selected_items(selected_items: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item_id in selected_items:
        if not item_id or item_id in seen:
            continue
        result.append(item_id)
        seen.add(item_id)
    return result


def _iter_selected_items(items: Iterable[dict[str, Any]], selected_items: Iterable[str]) -> Iterable[dict[str, Any]]:
    by_id = {str(item.get("id")): item for item in items if item.get("id")}
    for item_id in selected_items:
        yield by_id.get(item_id, {"id": item_id})


async def export_project_to_video_response(
    project_id: str,
    *,
    selected_items: Iterable[str],
    username: str,
    project_dao: Any,
    version_dao: Any,
    file_dao: Any,
    logger: Any,
    storyboard_dao: Any = None,
    entity_file_dao: Any = None,
    content_workflow_dao: Any = None,
    now_provider: Callable[[], datetime] = datetime.now,
    persist_image: ImagePersister = persist_export_storyboard_base64_image,
) -> dict[str, Any]:
    db_project = await _get_owned_project(project_id, username=username, project_dao=project_dao)
    if content_workflow_dao is None:
        try:
            from dao.creative.content_workflow import ContentWorkflowDAO

            content_workflow_dao = ContentWorkflowDAO
        except Exception:
            content_workflow_dao = None
    version_id = await _ensure_export_version(
        project_id,
        username=username,
        version_dao=version_dao,
        logger=logger,
    )

    data = parse_jsonb_field(db_project.get("settings"))
    storyboard = data.get("storyboard", {})
    items = storyboard.get("items", [])
    generated_images_data = data.get("generated_images", {})
    selected_item_ids = _unique_selected_items(selected_items)
    logger.info(
        "Export data: storyboard_items=%s generated_image_entries=%s selected=%s",
        len(items),
        len(generated_images_data),
        len(selected_item_ids),
    )

    video_tasks = []
    for item in _iter_selected_items(items, selected_item_ids):
        item_id = item.get("id")
        image_url, db_row = await _select_export_image_url(
            item_id=item_id,
            generated_images_data=generated_images_data,
            storyboard_dao=storyboard_dao,
            entity_file_dao=entity_file_dao,
            logger=logger,
        )
        image_url = await _persist_image_if_needed(
            image_url=image_url,
            item=item,
            username=username,
            version_id=version_id,
            file_dao=file_dao,
            logger=logger,
            persist_image=persist_image,
        )
        if not image_url:
            logger.warning("Shot %s has no image", item_id)

        resolved_bindings = await _resolve_live_bindings(
            project_id=project_id,
            item_id=item_id,
            row=db_row,
            content_workflow_dao=content_workflow_dao,
            logger=logger,
        )

        logger.info("Exporting shot %s image=%s...", item_id, image_url[:50] if image_url else "(none)")
        video_task = {
                "storyboard_id": item["id"],
                "image_url": image_url or "",
                "video_prompt": _legacy_or_db_text(item, db_row, "video_prompt", "videoPrompt"),
                "action_text": _legacy_or_db_text(item, db_row, "action_text", "actionText"),
                "dialogue": _legacy_or_db_text(item, db_row, "dialogue", "dialogue"),
                "characters": _characters_for_task(item, db_row),
                "scene": _scene_for_task(item, db_row),
            }
        # Snapshot the values resolved immediately before task creation.
        # Project defaults are overridden by shot bindings in the DAO.
        if resolved_bindings:
            video_task["resolved_bindings"] = resolved_bindings
        video_tasks.append(video_task)

    data["video_tasks"] = video_tasks
    data["stage"] = 4
    data["updated_at"] = now_provider().isoformat()
    await project_dao.save_or_update_project(
        user_id=username,
        project_id=project_id,
        project_name=db_project.get("project_name", "Untitled"),
        project_data=data,
        description=db_project.get("description", ""),
    )

    logger.info("Exported storyboard shots to video tasks: count=%s", len(video_tasks))
    return {"success": True, "exported_count": len(video_tasks), "video_tasks": video_tasks}


async def clear_project_video_tasks_response(
    project_id: str,
    *,
    username: str,
    project_dao: Any,
    logger: Any,
) -> dict[str, Any]:
    db_project = await _get_owned_project(project_id, username=username, project_dao=project_dao)
    data = parse_jsonb_field(db_project.get("settings"))

    if "video_tasks" not in data:
        return {"success": True, "cleared_count": 0}

    cleared_count = len(data["video_tasks"])
    data["video_tasks"] = []
    await project_dao.save_or_update_project(
        user_id=username,
        project_id=project_id,
        project_name=db_project.get("project_name", "Untitled"),
        project_data=data,
        description=db_project.get("description", ""),
    )

    logger.info("Cleared project video tasks: project=%s count=%s", project_id, cleared_count)
    return {"success": True, "cleared_count": cleared_count}
