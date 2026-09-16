"""Persistence helpers for AI proxy generated images."""
from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional

from services.ai_proxy_image_content_service import generated_image_content
from services.ai_proxy_types import AIProxyUpstreamError


SaveGeneratedFile = Callable[..., Awaitable[Dict[str, Any]]]
GeneratedImageContentLoader = Callable[[str], bytes]
GetFileRecord = Callable[[str], Awaitable[Any]]
CreateMediaLibraryItem = Callable[..., Awaitable[Any]]


async def _default_save_generated_file_to_db(**kwargs: Any) -> Dict[str, Any]:
    from file_service import save_generated_file_to_db

    return await save_generated_file_to_db(**kwargs)


async def _default_get_file_record(file_id: str) -> Any:
    from dao_content import FileDAO

    return await FileDAO.get_file(file_id)


async def _default_create_media_library_item(**kwargs: Any) -> Any:
    import media_library_service

    return await media_library_service.create_from_file(**kwargs)


def _image_result_identity(image: str, *, include_url: bool) -> Dict[str, Optional[str]]:
    if include_url:
        return {
            "data_url": image if image.startswith("data:") else None,
            "url": None if image.startswith("data:") else image,
        }
    return {"data_url": image}


async def persist_generated_ai_images(
    images: Iterable[str],
    *,
    user_id: str,
    source: str,
    media_source: str,
    prompt: str,
    model: str,
    entity_type: Optional[str],
    entity_id: Optional[str],
    file_role: Optional[str],
    project_id: Optional[str] = None,
    episode_id: Optional[str],
    file_metadata: Dict[str, Any],
    media_metadata: Optional[Dict[str, Any]] = None,
    source_task_id: Optional[str] = None,
    include_url: bool = False,
    logger: logging.Logger,
    image_content_loader: GeneratedImageContentLoader = generated_image_content,
    save_generated_file_to_db: SaveGeneratedFile = _default_save_generated_file_to_db,
    get_file_record: GetFileRecord = _default_get_file_record,
    create_media_library_item: CreateMediaLibraryItem = _default_create_media_library_item,
) -> List[Dict[str, Any]]:
    """Persist generated image outputs and create best-effort media-library rows."""

    results: List[Dict[str, Any]] = []
    original_metadata = getattr(images, "original_metadata", None)
    protected = getattr(images, "protected", False) is True
    for image in images:
        result = _image_result_identity(image, include_url=include_url)
        try:
            content = image_content_loader(image)
            stored_metadata = {**file_metadata}
            save_options = {}
            if callable(original_metadata):
                stored_metadata.update(original_metadata(content))
                save_options["preserve_original"] = True
            saved = await save_generated_file_to_db(
                content=content,
                file_type="image",
                user_id=user_id,
                source=source,
                entity_type=entity_type,
                entity_id=entity_id,
                file_role=file_role or "generated_image",
                original_ext=".png",
                project_id=project_id,
                episode_id=episode_id,
                extra_metadata=stored_metadata,
                **save_options,
            )
            if protected and not saved.get("file_id"):
                raise RuntimeError("Seedance 原始分镜保存失败，请勿使用未登记的临时图片")

            try:
                file_id = saved.get("file_id")
                file_record = await get_file_record(file_id) if file_id else None
                if file_record:
                    await create_media_library_item(
                        file_record=file_record,
                        source=media_source,
                        project_id=project_id,
                        episode_id=episode_id,
                        source_task_id=source_task_id,
                        source_entity_type=entity_type,
                        source_entity_id=entity_id,
                        title=(prompt or "")[:80] or None,
                        metadata=stored_metadata if callable(original_metadata) else (media_metadata if media_metadata is not None else file_metadata),
                    )
            except Exception as exc:
                logger.warning("media_library sync failed (%s): %s", media_source, exc)

            result.update({"file_id": saved["file_id"], "file_url": saved["file_url"]})
            provenance = stored_metadata.get("seedance_provenance") or {}
            if provenance.get("model_verified") is True:
                result["actual_model"] = provenance.get("model")
                if provenance.get("generation_mode") == "text_to_image" and provenance.get("reference_count") == 0:
                    result["text_to_image"] = True
                    result["reference_purpose"] = provenance.get("purpose")
        except Exception as exc:
            logger.warning("Generated AI image save failed (%s): %s", source, exc)
            if protected:
                raise AIProxyUpstreamError("Seedance 分镜原图保存或登记失败，本次未标记成功；请联系管理员检查存储后再生成。", status_code=502) from exc
            result.update({"file_id": None, "file_url": None})
        results.append(result)
    return results
