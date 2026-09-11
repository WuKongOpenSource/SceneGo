"""Project save workflow service."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Awaitable, Callable

from services.project_image_service import (
    is_data_image,
    persist_project_embedded_base64_image,
)
from utils.json_helpers import parse_jsonb_field


ImagePersister = Callable[..., Awaitable[Any]]


class ProjectSaveForbidden(PermissionError):
    """The legacy snapshot may only be replaced by its existing owner."""


def _is_existing_image_url(value: str) -> bool:
    return value.startswith("/api/files/") or value.startswith("http://") or value.startswith("https://")


async def _convert_image_value(
    value: Any,
    *,
    context: str,
    username: str,
    file_dao: Any,
    project_dao: Any,
    version_dao: Any,
    logger: Any,
    persist_image: ImagePersister,
) -> Any:
    if not value or not isinstance(value, str) or _is_existing_image_url(value) or not is_data_image(value):
        return value

    try:
        persisted = await persist_image(
            username=username,
            image_data=value,
            context=context,
            file_dao=file_dao,
            project_dao=project_dao,
            version_dao=version_dao,
            logger=logger,
        )
        logger.info("Base64 project image persisted: %s -> %s", context, persisted.file_url)
        return persisted.file_url
    except Exception as exc:
        logger.error("Base64 project image conversion failed: %s - %s", context, exc)
        return value


async def _convert_image_fields(
    item: dict[str, Any],
    *,
    url_context: str,
    thumb_context: str | None,
    username: str,
    file_dao: Any,
    project_dao: Any,
    version_dao: Any,
    logger: Any,
    persist_image: ImagePersister,
) -> None:
    if "url" in item:
        item["url"] = await _convert_image_value(
            item["url"],
            context=url_context,
            username=username,
            file_dao=file_dao,
            project_dao=project_dao,
            version_dao=version_dao,
            logger=logger,
            persist_image=persist_image,
        )
    if thumb_context and "thumbnail" in item:
        item["thumbnail"] = await _convert_image_value(
            item["thumbnail"],
            context=thumb_context,
            username=username,
            file_dao=file_dao,
            project_dao=project_dao,
            version_dao=version_dao,
            logger=logger,
            persist_image=persist_image,
        )


async def convert_base64_images_in_project_data(
    project_data: dict[str, Any],
    *,
    username: str,
    file_dao: Any,
    project_dao: Any,
    version_dao: Any,
    logger: Any,
    persist_image: ImagePersister = persist_project_embedded_base64_image,
) -> dict[str, Any]:
    material_library = project_data.get("material_library")
    if isinstance(material_library, dict):
        for tag_name, materials in material_library.items():
            if not isinstance(materials, list):
                continue
            for idx, material in enumerate(materials):
                if isinstance(material, dict):
                    await _convert_image_fields(
                        material,
                        url_context=f"material_{tag_name}_{idx}_full",
                        thumb_context=f"material_{tag_name}_{idx}_thumb",
                        username=username,
                        file_dao=file_dao,
                        project_dao=project_dao,
                        version_dao=version_dao,
                        logger=logger,
                        persist_image=persist_image,
                    )

    generated_images = project_data.get("generated_images")
    if isinstance(generated_images, dict):
        for shot_id, images in generated_images.items():
            if isinstance(images, dict) and isinstance(images.get("images"), list):
                for idx, img_data in enumerate(images["images"]):
                    if isinstance(img_data, dict):
                        await _convert_image_fields(
                            img_data,
                            url_context=f"generated_{shot_id}_{idx}_full",
                            thumb_context=f"generated_{shot_id}_{idx}_thumb",
                            username=username,
                            file_dao=file_dao,
                            project_dao=project_dao,
                            version_dao=version_dao,
                            logger=logger,
                            persist_image=persist_image,
                        )
            elif isinstance(images, list):
                for idx, img_data in enumerate(images):
                    if isinstance(img_data, dict):
                        await _convert_image_fields(
                            img_data,
                            url_context=f"generated_{shot_id}_{idx}_full",
                            thumb_context=f"generated_{shot_id}_{idx}_thumb",
                            username=username,
                            file_dao=file_dao,
                            project_dao=project_dao,
                            version_dao=version_dao,
                            logger=logger,
                            persist_image=persist_image,
                        )
                    elif isinstance(img_data, str):
                        images[idx] = await _convert_image_value(
                            img_data,
                            context=f"generated_{shot_id}_{idx}",
                            username=username,
                            file_dao=file_dao,
                            project_dao=project_dao,
                            version_dao=version_dao,
                            logger=logger,
                            persist_image=persist_image,
                        )

    storyboard = project_data.get("storyboard")
    items = storyboard.get("items") if isinstance(storyboard, dict) else None
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            references = item.get("references")
            if isinstance(references, list):
                for idx, ref in enumerate(references):
                    if isinstance(ref, dict):
                        await _convert_image_fields(
                            ref,
                            url_context=f"ref_{item.get('id', 'unknown')}_{idx}_full",
                            thumb_context=f"ref_{item.get('id', 'unknown')}_{idx}_thumb",
                            username=username,
                            file_dao=file_dao,
                            project_dao=project_dao,
                            version_dao=version_dao,
                            logger=logger,
                            persist_image=persist_image,
                        )
            generated_item_images = item.get("generatedImages")
            if isinstance(generated_item_images, list):
                for idx, gen_img in enumerate(generated_item_images):
                    if isinstance(gen_img, dict):
                        await _convert_image_fields(
                            gen_img,
                            url_context=f"item_{item.get('id', 'unknown')}_gen_{idx}_full",
                            thumb_context=f"item_{item.get('id', 'unknown')}_gen_{idx}_thumb",
                            username=username,
                            file_dao=file_dao,
                            project_dao=project_dao,
                            version_dao=version_dao,
                            logger=logger,
                            persist_image=persist_image,
                        )
                    elif isinstance(gen_img, str):
                        generated_item_images[idx] = await _convert_image_value(
                            gen_img,
                            context=f"item_{item.get('id', 'unknown')}_gen_{idx}",
                            username=username,
                            file_dao=file_dao,
                            project_dao=project_dao,
                            version_dao=version_dao,
                            logger=logger,
                            persist_image=persist_image,
                        )

    versions = project_data.get("versions")
    if isinstance(versions, list):
        for version_idx, version in enumerate(versions):
            if not isinstance(version, dict) or not isinstance(version.get("data"), dict):
                continue
            version_data = version["data"]
            version_materials = version_data.get("materialLibrary")
            if isinstance(version_materials, dict):
                for tag_name, materials in version_materials.items():
                    if not isinstance(materials, list):
                        continue
                    for idx, material in enumerate(materials):
                        if isinstance(material, dict) and "url" in material:
                            material["url"] = await _convert_image_value(
                                material["url"],
                                context=f"v{version_idx}_material_{tag_name}_{idx}",
                                username=username,
                                file_dao=file_dao,
                                project_dao=project_dao,
                                version_dao=version_dao,
                                logger=logger,
                                persist_image=persist_image,
                            )

            version_storyboard = version_data.get("storyboard")
            version_items = version_storyboard.get("items") if isinstance(version_storyboard, dict) else None
            if isinstance(version_items, list):
                for item in version_items:
                    if not isinstance(item, dict):
                        continue
                    references = item.get("references")
                    if isinstance(references, list):
                        for idx, ref in enumerate(references):
                            if isinstance(ref, dict) and "url" in ref:
                                ref["url"] = await _convert_image_value(
                                    ref["url"],
                                    context=f"v{version_idx}_ref_{item.get('id', 'unknown')}_{idx}",
                                    username=username,
                                    file_dao=file_dao,
                                    project_dao=project_dao,
                                    version_dao=version_dao,
                                    logger=logger,
                                    persist_image=persist_image,
                                )
                    generated_item_images = item.get("generatedImages")
                    if isinstance(generated_item_images, list):
                        for idx, gen_img in enumerate(generated_item_images):
                            if isinstance(gen_img, dict) and "url" in gen_img:
                                gen_img["url"] = await _convert_image_value(
                                    gen_img["url"],
                                    context=f"v{version_idx}_gen_{item.get('id', 'unknown')}_{idx}",
                                    username=username,
                                    file_dao=file_dao,
                                    project_dao=project_dao,
                                    version_dao=version_dao,
                                    logger=logger,
                                    persist_image=persist_image,
                                )

    return project_data


async def require_project_save_owner(project_id: str, *, username: str, project_dao: Any) -> Any:
    """Allow creation or owner replacement, without treating lookup failure as absence."""
    db_project = await project_dao.get_project(project_id)
    if db_project is None:
        return None
    # Authorize before reading saved collections or persisting submitted images.
    # Whole-snapshot replacement is owner-only; entity routes handle collaboration.
    if not username or db_project.get("user_id") != username:
        raise ProjectSaveForbidden("No permission to save this project")
    return db_project


def _preserve_existing_collections(project_data: dict[str, Any], existing_data: dict[str, Any], logger: Any) -> None:
    if project_data.get("video_tasks") is None:
        existing_video_tasks = existing_data.get("video_tasks")
        if existing_video_tasks:
            project_data["video_tasks"] = existing_video_tasks
            logger.info("Preserved existing video_tasks: %s", len(existing_video_tasks))

    if project_data.get("generated_images") is None:
        existing_generated_images = existing_data.get("generated_images")
        if existing_generated_images:
            project_data["generated_images"] = existing_generated_images
            logger.info("Preserved existing generated_images: %s", len(existing_generated_images))


def _recover_generated_image_urls(project_data: dict[str, Any], existing_data: dict[str, Any], logger: Any) -> None:
    generated_images = project_data.get("generated_images")
    if not isinstance(generated_images, dict):
        return

    try:
        existing_generated_images = existing_data.get("generated_images", {})
        recovered_count = 0
        thumbnail_fallback_count = 0

        for shot_id, img_data in generated_images.items():
            if not isinstance(img_data, dict) or not isinstance(img_data.get("images"), list):
                continue

            existing_shot_data = existing_generated_images.get(shot_id, {})
            existing_images_list = []
            if isinstance(existing_shot_data, dict) and isinstance(existing_shot_data.get("images"), list):
                existing_images_list = existing_shot_data["images"]
            elif isinstance(existing_shot_data, list):
                existing_images_list = existing_shot_data

            for idx, img in enumerate(img_data["images"]):
                if not isinstance(img, dict) or img.get("url"):
                    continue
                if idx < len(existing_images_list):
                    existing_img = existing_images_list[idx]
                    if isinstance(existing_img, dict) and existing_img.get("url"):
                        img["url"] = existing_img["url"]
                        recovered_count += 1
                        continue
                if img.get("thumbnail"):
                    img["url"] = img["thumbnail"]
                    thumbnail_fallback_count += 1

        if recovered_count:
            logger.info("Recovered generated image URLs from existing project data: %s", recovered_count)
        if thumbnail_fallback_count:
            logger.info("Used thumbnails as generated image URL fallback: %s", thumbnail_fallback_count)
    except Exception as exc:
        logger.error("Failed to recover generated image URLs: %s", exc)


def _log_generated_image_summary(project_data: dict[str, Any], logger: Any, *, label: str) -> None:
    generated_images = project_data.get("generated_images")
    if not isinstance(generated_images, dict):
        return
    for shot_id, img_data in list(generated_images.items())[:3]:
        if isinstance(img_data, dict) and isinstance(img_data.get("images"), list):
            url_count = sum(1 for img in img_data["images"] if isinstance(img, dict) and img.get("url"))
            logger.info(
                "%s shot=%s images=%s urls=%s selected=%s",
                label,
                shot_id,
                len(img_data["images"]),
                url_count,
                img_data.get("selectedImageId"),
            )


async def save_project_response(
    project: Any,
    *,
    username: str,
    project_dao: Any,
    file_dao: Any,
    version_dao: Any,
    logger: Any,
    now_provider: Callable[[], datetime] = datetime.now,
    persist_image: ImagePersister = persist_project_embedded_base64_image,
) -> dict[str, Any]:
    existing_data = {}
    if project.project_id:
        existing_project = await require_project_save_owner(
            project.project_id, username=username, project_dao=project_dao,
        )
        if existing_project is not None:
            existing_data = parse_jsonb_field(existing_project.get("settings"))

    project.user_id = username
    project.updated_at = now_provider().isoformat()
    if not project.created_at:
        project.created_at = project.updated_at

    project_data = project.model_dump()
    _preserve_existing_collections(project_data, existing_data, logger)
    _recover_generated_image_urls(project_data, existing_data, logger)
    _log_generated_image_summary(project_data, logger, label="before_base64_conversion")

    project_data = await convert_base64_images_in_project_data(
        project_data,
        username=username,
        file_dao=file_dao,
        project_dao=project_dao,
        version_dao=version_dao,
        logger=logger,
        persist_image=persist_image,
    )
    _log_generated_image_summary(project_data, logger, label="after_base64_conversion")

    result = await project_dao.save_or_update_project(
        user_id=username,
        project_id=project.project_id,
        project_name=project.name,
        project_data=project_data,
        description=project_data.get("description", ""),
    )
    if not result:
        # The conditional DAO write remains authoritative if ownership changed
        # after the initial lookup. Never report a skipped write as success.
        raise ProjectSaveForbidden("No permission to save this project")
    logger.info("Saved project to database: %s (%s)", project.name, project.project_id)

    return {
        "success": True,
        "project_id": project.project_id,
        "message": "\u9879\u76ee\u4fdd\u5b58\u6210\u529f",
        "material_library": project_data.get("material_library", {}),
    }
