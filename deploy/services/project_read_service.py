"""Read-side helpers for legacy project routes."""
from __future__ import annotations

from typing import Any

from utils.json_helpers import parse_jsonb_field


class ProjectReadError(RuntimeError):
    pass


class ProjectReadNotFound(ProjectReadError):
    pass


class ProjectReadForbidden(ProjectReadError):
    pass


async def can_read_project(
    db_project: dict[str, Any],
    username: str,
    *,
    project_member_dao: Any,
    user_dao: Any,
) -> bool:
    project_id = db_project.get("project_id")
    if db_project.get("user_id") == username:
        return True
    if project_id and await project_member_dao.check_permission(project_id, username, "readonly"):
        return True
    return await user_dao.is_admin_user(username)


def build_thumbnail_generated_images(generated_images: Any) -> dict[str, Any]:
    thumbnail_data: dict[str, Any] = {}
    if not isinstance(generated_images, dict):
        return thumbnail_data

    for shot_id, img_data in generated_images.items():
        if isinstance(img_data, dict) and "images" in img_data:
            thumbnail_images = []
            for img in img_data["images"]:
                has_url = bool(img.get("url")) or bool(img.get("thumbnail"))
                thumbnail_images.append(
                    {
                        "id": img.get("id"),
                        "thumbnail": img.get("thumbnail"),
                        "timestamp": img.get("timestamp"),
                        "hasFullImage": has_url,
                    }
                )
            thumbnail_data[shot_id] = {
                "images": thumbnail_images,
                "selectedImageId": img_data.get("selectedImageId"),
                "count": len(thumbnail_images),
            }
        elif isinstance(img_data, list):
            thumbnail_images = []
            for img in img_data:
                has_url = bool(img.get("url")) or bool(img.get("thumbnail"))
                thumbnail_images.append(
                    {
                        "id": img.get("id"),
                        "thumbnail": img.get("thumbnail"),
                        "timestamp": img.get("timestamp"),
                        "hasFullImage": has_url,
                    }
                )
            thumbnail_data[shot_id] = thumbnail_images
    return thumbnail_data


def _fix_image_urls(images_list: list[Any], logger: Any) -> list[Any]:
    fixed_images = []
    for img in images_list:
        if isinstance(img, dict):
            if "thumbnail" in img and not img.get("url"):
                img["url"] = img["thumbnail"]
                logger.debug("Filled missing image url from thumbnail: %s", img.get("id", "unknown"))
            fixed_images.append(img)
        else:
            fixed_images.append(img)
    return fixed_images


async def get_project_response(
    project_id: str,
    *,
    username: str,
    thumbnail_only: bool,
    project_dao: Any,
    project_member_dao: Any,
    user_dao: Any,
    logger: Any,
) -> dict[str, Any]:
    logger.info("Reading project: %s user=%s thumbnail_only=%s", project_id, username, thumbnail_only)
    db_project = await project_dao.get_project(project_id)
    if not db_project:
        raise ProjectReadNotFound("project not found")
    if not await can_read_project(
        db_project,
        username,
        project_member_dao=project_member_dao,
        user_dao=user_dao,
    ):
        raise ProjectReadForbidden("project access denied")

    data = parse_jsonb_field(db_project.get("settings"))
    if thumbnail_only and data.get("generated_images"):
        data["generated_images"] = build_thumbnail_generated_images(data["generated_images"])
        logger.info("Project thumbnail mode simplified generated_images: %s", len(data["generated_images"]))

    logger.info("Project data keys: %s", list(data.keys()))
    logger.info("Project stage: %s", data.get("stage"))

    video_tasks = data.get("video_tasks")
    if video_tasks and isinstance(video_tasks, list) and len(video_tasks) > 0:
        logger.info("Project includes %s video tasks", len(video_tasks))
        for task in video_tasks[:3]:
            logger.info(
                "  - storyboard=%s image=%s...",
                task.get("storyboard_id"),
                str(task.get("image_url", ""))[:50],
            )
    else:
        logger.debug("Project has no video tasks yet")

    if data.get("generated_images"):
        logger.info("Project includes generated_images shots=%s", len(data["generated_images"]))
        for shot_id, img_data in list(data["generated_images"].items())[:3]:
            if isinstance(img_data, dict) and "images" in img_data:
                logger.debug("  - shot %s images=%s", shot_id, len(img_data["images"]))

    await project_dao.update_project_access(project_id)
    return {"success": True, "project": data}


async def get_shot_images_response(
    project_id: str,
    shot_id: str,
    *,
    username: str,
    project_dao: Any,
    project_member_dao: Any,
    user_dao: Any,
    logger: Any,
) -> dict[str, Any]:
    logger.info("Loading project shot images: project=%s shot=%s", project_id, shot_id)
    db_project = await project_dao.get_project(project_id)
    if not db_project:
        raise ProjectReadNotFound("project not found")
    if not await can_read_project(
        db_project,
        username,
        project_member_dao=project_member_dao,
        user_dao=user_dao,
    ):
        raise ProjectReadForbidden("project access denied")

    data = parse_jsonb_field(db_project.get("settings"))
    if not data:
        logger.warning("Project settings are empty: %s", project_id)
        return {"success": True, "images": []}

    generated_images = data.get("generated_images")
    if not generated_images or not isinstance(generated_images, dict):
        logger.warning("Project generated_images are empty or invalid: %s", project_id)
        return {"success": True, "images": []}

    shot_data = generated_images.get(shot_id)
    if not shot_data:
        return {"success": True, "images": []}

    if isinstance(shot_data, dict) and "images" in shot_data:
        fixed_images = _fix_image_urls(shot_data["images"], logger)
        logger.info("Returning shot images: shot=%s count=%s", shot_id, len(fixed_images))
        return {
            "success": True,
            "images": fixed_images,
            "selectedImageId": shot_data.get("selectedImageId"),
        }
    if isinstance(shot_data, list):
        fixed_images = _fix_image_urls(shot_data, logger)
        logger.info("Returning legacy shot images: shot=%s count=%s", shot_id, len(fixed_images))
        return {"success": True, "images": fixed_images}

    return {"success": True, "images": []}
