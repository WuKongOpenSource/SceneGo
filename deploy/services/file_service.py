"""
Unified file service — single entry point for registering output files.

Usage:
    from file_service import FileService
    result_entry = await FileService.register_output(
        content=raw_bytes,
        original_filename="ComfyUI_00001_.png",
        content_type="image/png",
        task_id="abc-123",
        user_id="admin",
        source="agent_complete",
    )
    # result_entry = {"file_id": "file_xxx", "url": "/storage/...", "filename": "...", "size": 123}
"""
import logging
import mimetypes
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from dao_file import FileDAO
from services.image_safety_service import open_image_bytes_safely
from utils.storage_layout import (
    build_storage_relative_path,
    canonical_file_type,
    storage_url_for,
    year_month_from,
)

logger = logging.getLogger(__name__)

STORAGE_ROOT = Path("persistent_storage")

MIME_TO_CATEGORY = {
    "image": "image",
    "video": "video",
    "audio": "audio",
}

MIME_FALLBACK_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "application/octet-stream": ".bin",
}


class FileService:

    @staticmethod
    def _detect_category(content_type: str) -> str:
        """image/png -> 'image', video/mp4 -> 'video', etc."""
        major = content_type.split("/")[0] if content_type else "other"
        return MIME_TO_CATEGORY.get(major, "other")

    @staticmethod
    def _ensure_extension(filename: str, content_type: str) -> str:
        """Ensure filename has a proper extension based on content_type."""
        p = Path(filename)
        if p.suffix and len(p.suffix) <= 5:
            return filename
        ext = MIME_FALLBACK_EXT.get(content_type)
        if not ext:
            ext = mimetypes.guess_extension(content_type) or ".bin"
        return f"{filename}{ext}"

    @staticmethod
    async def register_output(
        content: bytes,
        original_filename: str,
        content_type: str,
        task_id: str,
        user_id: str = "system",
        source: str = "agent_complete",
    ) -> Dict[str, Any]:
        """
        Save a generated file to disk and register it in the database.

        Returns a standardized entry:
            {"file_id": "file_xxx", "url": "/storage/...", "filename": "...", "size": 123}
        """
        category = FileService._detect_category(content_type)
        safe_filename = FileService._ensure_extension(original_filename, content_type)

        year_month = datetime.now().strftime("%Y%m")
        file_id = FileDAO.generate_file_id()
        disk_filename = f"{task_id}_{safe_filename}"

        sub_dir = f"{category}s" if not category.endswith("s") else category
        rel_dir = Path(sub_dir) / source / year_month
        output_dir = STORAGE_ROOT / rel_dir
        output_dir.mkdir(parents=True, exist_ok=True)

        file_path = output_dir / disk_filename
        file_path.write_bytes(content)

        file_url = f"/storage/{rel_dir}/{disk_filename}"

        try:
            await FileDAO.create(
                file_id=file_id,
                user_id=user_id,
                file_type=category,
                file_name=safe_filename,
                file_path=str(file_path),
                file_url=file_url,
                file_size_bytes=len(content),
                mime_type=content_type,
                metadata={"task_id": task_id, "source": source},
                source=source,
            )
        except Exception as e:
            logger.warning(f"Failed to create file DB record (non-fatal): {e}")

        return {
            "file_id": file_id,
            "url": file_url,
            "filename": safe_filename,
            "size": len(content),
        }

    @staticmethod
    def build_result(
        file_entries: List[Dict[str, Any]],
        duration: float = 0.0,
    ) -> Dict[str, Any]:
        """
        Build a standardized task result from a list of file entries.
        Splits into images / videos based on URL extension.
        """
        images = []
        videos = []
        for entry in file_entries:
            fname = entry.get("filename", "").lower()
            if any(fname.endswith(ext) for ext in (".mp4", ".webm", ".mov", ".avi")):
                videos.append(entry)
            else:
                images.append(entry)
        return {
            "images": images,
            "videos": videos,
            "output_files": file_entries,
            "duration": duration,
        }



from dao_content import FileDAO as ContentFileDAO
from dao_entity_file import EntityFileDAO


async def _resolve_project_id_for_storage(project_id: Optional[str], episode_id: Optional[str]) -> Optional[str]:
    if project_id or not episode_id:
        return project_id
    try:
        from dao_episode import EpisodeDAO
        return await EpisodeDAO.get_project_id(episode_id)
    except Exception as e:
        logger.debug("episode->project lookup failed for storage path (episode_id=%s): %s", episode_id, e)
        return None


async def save_generated_file_to_db(
    content: bytes,
    file_type: str,
    user_id: str,
    source: str,
    entity_type: str = None,
    entity_id: str = None,
    file_role: str = None,
    original_ext: str = '.png',
    is_selected: bool = False,
    project_id: str = None,
    episode_id: str = None,
    extra_metadata: dict = None,
    preserve_original: bool = False,
) -> dict:





    import io
    import uuid as _uuid

    metadata = {**({'source': source, 'project_id': project_id, 'episode_id': episode_id}), **(extra_metadata or {})}
    project_id = project_id or metadata.get('project_id')
    episode_id = episode_id or metadata.get('episode_id')
    project_id = await _resolve_project_id_for_storage(project_id, episode_id)
    metadata['project_id'] = project_id
    metadata['episode_id'] = episode_id
    file_type = canonical_file_type(file_type)
    year_month = year_month_from()
    file_id = str(_uuid.uuid4())

    if file_type == 'image' and preserve_original:
        with open_image_bytes_safely(content) as img:
            img.load()
            original_ext = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp"}.get(img.format)
            if not original_ext:
                raise ValueError("Unsupported generated original image format")
    elif file_type == 'image' and original_ext.lower() in ('.png', '.jpg', '.jpeg'):
        try:
            with open_image_bytes_safely(content) as img:
                buf = io.BytesIO()
                img.save(buf, format='WEBP', lossless=True)
                content = buf.getvalue()
                original_ext = '.webp'
        except Exception as e:
            logger.warning(f"WebP 转换失败，使用原始格式: {e}")

    rel_path = build_storage_relative_path(
        file_type=file_type,
        user_id=user_id,
        project_id=project_id,
        episode_id=episode_id,
        year_month=year_month,
        file_id=file_id,
        extension=original_ext,
    )
    local_path = STORAGE_ROOT / rel_path
    local_path.parent.mkdir(parents=True, exist_ok=True)
    local_path.write_bytes(content)

    safe_filename = local_path.name
    file_url = storage_url_for(rel_path)

    _MIME_MAP = {
        '.webp': 'image/webp', '.png': 'image/png',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
        '.mp4': 'video/mp4', '.txt': 'text/plain',
    }
    mime_type = _MIME_MAP.get(original_ext.lower(), f'{file_type}/{original_ext.lstrip(".")}')

    db_record = None
    try:
        db_record = await ContentFileDAO.create_file(
            version_id=None,
            user_id=user_id,
            file_type=file_type,
            file_name=safe_filename,
            file_path=str(local_path),
            file_url=file_url,
            file_size_bytes=len(content),
            mime_type=mime_type,
            metadata=metadata,
            file_id=file_id,
            entity_type=entity_type,
            entity_id=entity_id,
            file_role=file_role,
            is_selected=is_selected,
            project_id=project_id,
            episode_id=episode_id,
            source=source,
        )
    except Exception as e:
        logger.error(f"save_generated_file_to_db DB 写入失败: {e}", exc_info=True)

    if db_record and entity_type and entity_id and file_role:
        # Register every generated image/video/audio in the shared candidate
        # model.  This is deliberately best-effort: legacy URL persistence must
        # keep working while a deployment is rolling through the new migration.
        registered_take = None
        try:
            from dao.creative.content_workflow import ContentWorkflowDAO
            from services.content_workflow_service import register_generated_take

            registered_take = await register_generated_take(
                user_id=user_id,
                file_id=db_record.get('file_id'),
                file_type=file_type,
                entity_type=entity_type,
                entity_id=entity_id,
                file_role=file_role,
                source=source,
                project_id=project_id,
                episode_id=episode_id,
                metadata=metadata,
                workflow_dao=ContentWorkflowDAO,
            )
        except Exception as e:
            logger.warning("content take registration failed (non-fatal): %s", e)

        # A late result or a newly generated unselected candidate must not
        # overwrite an explicit user selection in legacy URL columns.  Legacy
        # sync remains as a compatibility fallback when no selection exists.
        should_sync_legacy = not bool(registered_take and registered_take.get("is_late"))
        if should_sync_legacy and registered_take:
            try:
                takes = await ContentWorkflowDAO.list_takes(
                    registered_take["entity_type"],
                    registered_take["entity_id"],
                    registered_take["slot"],
                )
                selected_take = next((take for take in takes if take.get("is_selected")), None)
                if selected_take and selected_take.get("take_id") != registered_take.get("take_id"):
                    should_sync_legacy = False
            except Exception as e:
                logger.warning("Selected-take lookup before legacy sync failed (non-fatal): %s", e)
        if should_sync_legacy:
            try:
                selected = await EntityFileDAO.get_selected_file(entity_type, entity_id, file_role)
                if selected and selected.get("file_id") != db_record.get("file_id"):
                    should_sync_legacy = False
            except Exception as e:
                logger.warning("Selected-file lookup before legacy sync failed (non-fatal): %s", e)
        if should_sync_legacy:
            try:
                await _sync_legacy_on_file_create(entity_type, entity_id, file_role, file_url)
            except Exception as e:
                logger.warning(f"Legacy field sync failed (non-fatal): {e}")




    if db_record and file_type in ('image', 'video', 'audio'):
        try:
            import media_library_service
            await media_library_service.create_from_file(
                file_record={**db_record, 'user_id': user_id, 'file_type': file_type},
                source=source or f'generated_{file_type}',
                item_type=file_type,
                project_id=project_id,
                episode_id=episode_id,
                source_entity_type=entity_type,
                source_entity_id=entity_id,
            )
        except Exception as e:
            logger.warning(f"media_library 兜底同步失败 (non-fatal): {e}")

    return {
        'file_id': db_record['file_id'] if db_record else None,
        'file_url': file_url,
        'file_path': str(local_path),
    }


async def _sync_legacy_on_file_create(entity_type: str, entity_id: str, file_role: str, file_url: str):

    await EntityFileDAO.sync_legacy_url(entity_type, entity_id, file_role, file_url)
