"""Entity file business logic for shared file attachments."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Optional


class EntityFileServiceError(RuntimeError):
    pass


class EntityFileNotFound(EntityFileServiceError):
    pass


class EntityFileBatchTooLarge(EntityFileServiceError):
    pass


class EntityFileDeleteRiskNotAcknowledged(EntityFileServiceError):
    pass


class EntityFilePhysicalDeleteFailed(EntityFileServiceError):
    pass


class EntityFileMigrationFailed(EntityFileServiceError):
    pass


class EntityFileTransformInvalid(EntityFileServiceError):
    pass


def _normalize_file_rows(rows: Iterable[Any]) -> list[Dict[str, Any]]:
    items = []
    for row in rows:
        item = dict(row)
        if isinstance(item.get("metadata"), str):
            try:
                item["metadata"] = json.loads(item["metadata"])
            except Exception:
                item["metadata"] = {}
        items.append(item)
    return items


def _detect_file_type(content_type: Optional[str]) -> str:
    if content_type and content_type.startswith("image"):
        return "image"
    if content_type and content_type.startswith("audio"):
        return "audio"
    if content_type and content_type.startswith("video"):
        return "video"
    return "other"


async def list_user_files(
    *,
    user_id: str,
    file_type: Optional[str],
    limit: int,
    offset: int,
    file_dao: Any,
    entity_file_dao: Any,
) -> Dict[str, Any]:
    capped_limit = min(limit, 500)
    rows = await file_dao.get_user_files(user_id, file_type, capped_limit, offset)
    total = await entity_file_dao.count_user_files(user_id, file_type)
    return {"success": True, "items": _normalize_file_rows(rows), "total": total}


async def list_deleted_user_files(
    *,
    user_id: str,
    file_type: Optional[str],
    limit: int,
    offset: int,
    entity_file_dao: Any,
) -> Dict[str, Any]:
    capped_limit = min(limit, 500)
    rows = await entity_file_dao.get_deleted_user_files(
        user_id,
        file_type,
        capped_limit,
        offset,
    )
    total = await entity_file_dao.count_deleted_user_files(user_id, file_type)
    return {"success": True, "items": _normalize_file_rows(rows), "total": total}


async def get_deleted_user_file(
    *,
    file_id: str,
    user_id: str,
    entity_file_dao: Any,
) -> Dict[str, Any]:
    row = await entity_file_dao.get_deleted_user_file(file_id, user_id)
    if not row:
        raise EntityFileNotFound("Deleted file not found or access denied")
    return _normalize_file_rows([row])[0]


async def list_entity_files(
    *,
    entity_type: str,
    entity_id: str,
    file_role: Optional[str],
    limit: int,
    offset: int,
    entity_file_dao: Any,
) -> Dict[str, Any]:
    capped_limit = min(limit, 200)
    result = await entity_file_dao.get_entity_files(
        entity_type,
        entity_id,
        file_role,
        capped_limit,
        offset,
    )
    return {"success": True, **result}


async def link_entity_file(
    *,
    file_id: str,
    entity_type: str,
    entity_id: str,
    file_role: str,
    is_selected: bool,
    entity_file_dao: Any,
) -> Dict[str, Any]:
    row = await entity_file_dao.link_file(
        file_id,
        entity_type,
        entity_id,
        file_role,
        is_selected,
    )
    if not row:
        raise EntityFileNotFound("File not found or deleted")
    return {"success": True, "file": row}


async def select_entity_file(
    *,
    file_id: str,
    entity_type: str,
    entity_id: str,
    file_role: str,
    entity_file_dao: Any,
    logger: Optional[logging.Logger] = None,
    selected_by: Optional[str] = None,
    content_workflow_dao: Any = None,
) -> Dict[str, Any]:
    row = await entity_file_dao.select_file(file_id, entity_type, entity_id, file_role)
    if not row:
        raise EntityFileNotFound("File not found or not linked to entity")

    try:
        await entity_file_dao.sync_legacy_url(entity_type, entity_id, file_role, row["file_url"])
    except Exception as exc:
        if logger:
            logger.warning("同步旧URL字段失败: %s", exc)

    # Keep old file selection and the new type-agnostic selection in one user
    # action.  During a rolling migration this remains best-effort.
    try:
        if content_workflow_dao is None:
            from dao.creative.content_workflow import ContentWorkflowDAO

            content_workflow_dao = ContentWorkflowDAO
        from services.content_workflow_service import (
            list_content_takes,
            normalize_entity_type,
            select_content_take,
            slot_for_file,
        )

        slot = slot_for_file(str(row.get("file_type") or ""), file_role)
        if slot:
            normalized_type = normalize_entity_type(entity_type)
            takes_result = await list_content_takes(
                entity_type=normalized_type,
                entity_id=entity_id,
                slot=slot,
                workflow_dao=content_workflow_dao,
            )
            take = next(
                (item for item in takes_result["items"] if item.get("file_id") == file_id),
                None,
            )
            if take:
                await select_content_take(
                    entity_type=normalized_type,
                    entity_id=entity_id,
                    slot=slot,
                    take_id=take["take_id"],
                    selected_by=selected_by,
                    workflow_dao=content_workflow_dao,
                )
    except Exception as exc:
        if logger:
            logger.warning("统一候选选择同步失败（旧选择已生效）: %s", exc)
    return {"success": True, "file": row}


async def upload_entity_file(
    *,
    content: bytes,
    filename: Optional[str],
    content_type: Optional[str],
    entity_type: Optional[str],
    entity_id: Optional[str],
    file_role: Optional[str],
    episode_id: Optional[str],
    user_id: str,
    save_generated_file_to_db: Callable[..., Any],
    project_id: Optional[str] = None,
    media_library_create_from_file: Optional[Callable[..., Any]] = None,
    logger: Optional[logging.Logger] = None,
    source: str = "upload",
    transform: Optional[str] = None,
) -> Dict[str, Any]:
    original_ext = Path(filename).suffix if filename else ".bin"
    file_type = _detect_file_type(content_type)
    normalized_source = str(source or "upload").strip().lower()
    normalized_transform = str(transform or "").strip().lower()
    is_horizontal_mirror = (
        normalized_source == "local_transform"
        and normalized_transform == "horizontal_mirror"
        and file_type == "image"
        and file_role == "generated_image"
        and entity_type == "storyboard_item"
    )
    if normalized_source != "upload" and not is_horizontal_mirror:
        raise EntityFileTransformInvalid("Unsupported local file transform")
    if normalized_transform and not is_horizontal_mirror:
        raise EntityFileTransformInvalid("Unsupported local file transform")

    metadata = (
        {"model": "horizontal_mirror", "transform": "horizontal_mirror"}
        if is_horizontal_mirror
        else None
    )

    saved = await save_generated_file_to_db(
        content=content,
        file_type=file_type,
        user_id=user_id,
        source=normalized_source,
        entity_type=entity_type,
        entity_id=entity_id,
        file_role=file_role,
        original_ext=original_ext,
        project_id=project_id,
        episode_id=episode_id,
        extra_metadata=metadata,
    )

    if file_type in ("image", "video", "audio"):
        try:
            create_from_file = media_library_create_from_file
            if create_from_file is None:
                import media_library_service

                create_from_file = media_library_service.create_from_file
            await create_from_file(
                file_record=saved,
                source=normalized_source,
                episode_id=episode_id,
                source_entity_type=entity_type,
                source_entity_id=entity_id,
                title=(filename or "")[:80] or None,
            )
        except Exception as exc:
            if logger:
                logger.warning("media_library 同步失败 (entity-files upload): %s", exc)

    return {"success": True, "file_id": saved["file_id"], "file_url": saved["file_url"]}


async def soft_delete_entity_file(
    *,
    file_id: str,
    entity_file_dao: Any,
) -> Dict[str, Any]:
    ok = await entity_file_dao.soft_delete(file_id)
    if not ok:
        raise EntityFileNotFound("File not found or deleted")
    return {"success": True}


async def restore_entity_file(
    *,
    file_id: str,
    user_id: str,
    entity_file_dao: Any,
) -> Dict[str, Any]:
    row = await entity_file_dao.restore(file_id, user_id)
    if not row:
        raise EntityFileNotFound("Deleted file not found or access denied")
    return {"success": True, "file": row}


async def hard_delete_entity_file(
    *,
    file_id: str,
    user_id: str,
    risk_ack: bool,
    entity_file_dao: Any,
    node_output_deleter: Optional[Callable[..., Any]] = None,
) -> Dict[str, Any]:
    if not risk_ack:
        raise EntityFileDeleteRiskNotAcknowledged("Permanent deletion must be acknowledged")

    row = await entity_file_dao.get_deleted_user_file(file_id, user_id)
    if not row:
        raise EntityFileNotFound("Deleted file not found or access denied")
    normalized = _normalize_file_rows([row])[0]
    metadata = normalized.get("metadata") if isinstance(normalized.get("metadata"), dict) else {}
    node_output_id = str(metadata.get("node_output_id") or "").strip()
    node_agent_id = str(metadata.get("node_agent_id") or "").strip()
    is_node_local = str(normalized.get("file_path") or "").startswith("agent://") or (
        str(metadata.get("source") or "") == "node_local_output"
    )

    try:
        if is_node_local:
            if not node_output_id or not node_agent_id or node_output_deleter is None:
                raise EntityFilePhysicalDeleteFailed("Local node deletion information is unavailable")
            remote = await node_output_deleter(
                agent_id=node_agent_id,
                output_id=node_output_id,
            )
            deleted = await entity_file_dao.delete_deleted_user_file_record(file_id, user_id)
            if not deleted:
                raise EntityFilePhysicalDeleteFailed("File record changed during permanent deletion")
            freed_bytes = max(0, int((remote or {}).get("freed_bytes") or 0))
        else:
            result = await entity_file_dao.hard_delete(file_id, user_id)
            if not result:
                raise EntityFileNotFound("Deleted file not found or access denied")
            freed_bytes = max(0, int(result.get("freed_bytes") or 0))
    except EntityFileServiceError:
        raise
    except (OSError, RuntimeError, ValueError) as exc:
        raise EntityFilePhysicalDeleteFailed(str(exc)) from exc

    return {"success": True, "file_id": file_id, "freed_bytes": freed_bytes}


async def hard_delete_entity_files_batch(
    *,
    file_ids: list[str],
    user_id: str,
    risk_ack: bool,
    entity_file_dao: Any,
    node_output_deleter: Optional[Callable[..., Any]] = None,
) -> Dict[str, Any]:
    if not risk_ack:
        raise EntityFileDeleteRiskNotAcknowledged("Permanent deletion must be acknowledged")
    unique_ids = [file_id for file_id in dict.fromkeys(file_ids or []) if file_id]
    if len(unique_ids) > 200:
        raise EntityFileBatchTooLarge("Batch hard delete accepts at most 200 files")

    deleted = 0
    freed_bytes = 0
    errors = []
    for file_id in unique_ids:
        try:
            result = await hard_delete_entity_file(
                file_id=file_id,
                user_id=user_id,
                risk_ack=True,
                entity_file_dao=entity_file_dao,
                node_output_deleter=node_output_deleter,
            )
            deleted += 1
            freed_bytes += int(result.get("freed_bytes") or 0)
        except EntityFileServiceError as exc:
            errors.append({"file_id": file_id, "error": str(exc)})
    return {
        "success": not errors,
        "requested": len(unique_ids),
        "deleted": deleted,
        "freed_bytes": freed_bytes,
        "errors": errors,
    }


async def run_entity_file_migration(
    *,
    migration_runner: Optional[Callable[[], Any]] = None,
) -> Dict[str, Any]:
    try:
        if migration_runner is not None:
            recovered = await migration_runner()
            return {"success": True, "recovered": recovered}

        from migrate_existing_files import (
            migrate_assets,
            migrate_storyboard_items,
            migrate_video_segments,
            recover_orphan_files,
        )

        await migrate_storyboard_items()
        await migrate_assets()
        await migrate_video_segments()
        recovered = await recover_orphan_files()
        return {"success": True, "recovered": recovered}
    except Exception as exc:
        raise EntityFileMigrationFailed(str(exc)) from exc
