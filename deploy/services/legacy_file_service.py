"""Business logic for legacy version-scoped file APIs."""
from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Optional
from urllib.parse import quote

import aiofiles

from services.entity_access_service import EntityAccessDenied, require_file_access
from services.local_file_access_service import configured_media_roots, resolve_allowed_media_file
from services.media_response_policy import safe_content_disposition


class LegacyFileServiceError(RuntimeError):
    pass


class LegacyFileForbidden(LegacyFileServiceError):
    pass


class LegacyStorageQuotaExceeded(LegacyFileServiceError):
    pass


class LegacyFileNotFound(LegacyFileServiceError):
    pass


class _LegacyFileAccessDAO:
    def __init__(self, file_dao: Any):
        self.file_dao = file_dao

    async def get_by_id(self, file_id: str) -> Optional[Dict[str, Any]]:
        return await self.file_dao.get_file(file_id)


@dataclass(frozen=True)
class LegacyDownloadInfo:
    file_path: str
    filename: str
    encoded_filename: str
    mime_type: str
    content_disposition: str
    extra_headers: Dict[str, str]
    file_size: int
    range_start: Optional[int] = None
    range_end: Optional[int] = None
    content_length: Optional[int] = None

    @property
    def is_range(self) -> bool:
        return self.range_start is not None and self.range_end is not None


def _file_type_for_name(filename: str) -> str:
    file_ext = Path(filename or "").suffix.lower()
    if file_ext in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
        return "image"
    if file_ext in [".mp4", ".avi", ".mov", ".mkv"]:
        return "video"
    return "other"


def _possible_download_paths(file_path: str, *, deploy_root: Path) -> list[str]:
    if os.path.isabs(file_path):
        return [file_path]

    possible_paths = [os.path.join(str(deploy_root), file_path)]
    if "persistent_storage" in file_path:
        possible_paths.append(os.path.join(str(deploy_root), file_path.replace("persistent_storage/", "temp/uploads/")))
        possible_paths.append(
            os.path.join(str(deploy_root), file_path.replace("persistent_storage/videos/", "temp/uploads/video/"))
        )
        possible_paths.append(
            os.path.join(str(deploy_root), file_path.replace("persistent_storage/images/", "temp/uploads/images/"))
        )
    return possible_paths


def _parse_range(range_header: Optional[str], *, file_size: int, mime_type: str) -> tuple[Optional[int], Optional[int]]:
    if not range_header or ("video" not in mime_type and "audio" not in mime_type):
        return None, None

    range_spec = range_header.replace("bytes=", "")
    parts = range_spec.split("-")
    start = int(parts[0]) if parts and parts[0] else 0
    end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
    return start, min(end, file_size - 1)


async def ranged_file_reader(file_path: str, *, start: int, content_length: int):
    async with aiofiles.open(file_path, "rb") as f:
        await f.seek(start)
        remaining = content_length
        while remaining > 0:
            chunk_size = min(65536, remaining)
            chunk = await f.read(chunk_size)
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


async def upload_legacy_file(
    *,
    version_id: str,
    filename: str,
    content_type: Optional[str],
    content: bytes,
    user_id: str,
    user_dao: Any,
    version_dao: Any,
    file_dao: Any,
    activity_log_dao: Any,
    file_optimization_service: Any,
    file_deduplication_service: Any,
    storage_root: Path = Path("persistent_storage"),
    now_provider: Callable[[], datetime] = datetime.now,
    uuid_hex_provider: Callable[[], str] = lambda: uuid.uuid4().hex,
) -> Dict[str, Any]:
    version = await version_dao.get_version(version_id)
    if not version or version["user_id"] != user_id:
        raise LegacyFileForbidden("无权操作")

    user = await user_dao.get_user_by_id(user_id)
    quota_bytes = user["storage_quota_gb"] * 1024 * 1024 * 1024
    if user["used_storage_bytes"] + len(content) > quota_bytes:
        raise LegacyStorageQuotaExceeded("存储空间不足")

    file_id = f"file_{uuid_hex_provider()[:12]}"
    file_ext = Path(filename or "").suffix
    file_type = _file_type_for_name(filename)
    storage_month = now_provider().strftime("%Y%m")
    storage_base = storage_root / f"{file_type}s" / user_id / storage_month
    storage_base.mkdir(parents=True, exist_ok=True)

    file_path = storage_base / f"{file_id}{file_ext}"
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    file_size = len(content)
    file_url = f"/storage/{file_type}s/{user_id}/{storage_month}/{file_id}{file_ext}"
    file_hash = await file_optimization_service.calculate_file_hash(str(file_path))

    duplicate = await file_deduplication_service.check_duplicate(file_hash, user_id)
    if duplicate:
        file_record = await file_deduplication_service.link_duplicate_file(duplicate, version_id, user_id)
    else:
        file_record = await file_dao.create_file(
            version_id=version_id,
            user_id=user_id,
            file_type=file_type,
            file_name=filename,
            file_path=str(file_path),
            file_url=file_url,
            file_size_bytes=file_size,
            mime_type=content_type,
            metadata={"file_hash": file_hash},
        )

        if file_type == "image":
            thumbnail_path = storage_base / f"{file_id}_thumb.jpg"
            await file_optimization_service.create_thumbnail(str(file_path), str(thumbnail_path))

    await activity_log_dao.log_activity(
        user_id=user_id,
        action="upload_file",
        resource_type="file",
        resource_id=file_record["file_id"],
    )

    return {"success": True, "file": file_record}


async def get_legacy_download_info(
    *,
    file_id: str,
    range_header: Optional[str],
    identity: str,
    deploy_root: Path,
    file_dao: Any,
    logger: Any,
    file_access_checker: Callable[..., Any] = require_file_access,
    media_roots: Optional[list[Path]] = None,
) -> LegacyDownloadInfo:
    logger.info("Legacy file download request: file_id=%s", file_id)
    file_record = await file_dao.get_file(file_id)
    if not file_record:
        logger.error("文件记录不存在: file_id=%s", file_id)
        raise LegacyFileNotFound("文件不存在")

    try:
        await file_access_checker(
            file_id,
            identity,
            "readonly",
            file_dao=_LegacyFileAccessDAO(file_dao),
        )
    except EntityAccessDenied as exc:
        raise LegacyFileNotFound("File not found or access denied") from exc

    file_path = file_record["file_path"]
    possible_paths = _possible_download_paths(file_path, deploy_root=deploy_root)
    allowed_roots = tuple(media_roots or configured_media_roots(deploy_root=deploy_root))
    actual_file_path = next(
        (
            str(resolved)
            for path in possible_paths
            if (
                resolved := resolve_allowed_media_file(
                    path,
                    deploy_root=deploy_root,
                    allowed_roots=allowed_roots,
                )
            )
        ),
        None,
    )
    if not actual_file_path:
        logger.error("文件不存在于磁盘，尝试的路径: %s", possible_paths)
        logger.error("当前工作目录: %s", os.getcwd())
        logger.error("legacy files deploy root: %s", deploy_root)
        raise LegacyFileNotFound("文件不存在")

    filename = file_record.get("file_name", "download")
    mime_type, content_disposition, extra_headers = safe_content_disposition(
        actual_file_path,
        download_name=filename,
    )
    file_size = os.path.getsize(actual_file_path)
    range_start, range_end = _parse_range(range_header, file_size=file_size, mime_type=mime_type)
    content_length = (range_end - range_start + 1) if range_start is not None and range_end is not None else None

    return LegacyDownloadInfo(
        file_path=actual_file_path,
        filename=filename,
        encoded_filename=quote(filename),
        mime_type=mime_type,
        content_disposition=content_disposition,
        extra_headers=extra_headers,
        file_size=file_size,
        range_start=range_start,
        range_end=range_end,
        content_length=content_length,
    )


async def delete_legacy_file(
    *,
    file_id: str,
    user_id: str,
    file_dao: Any,
    activity_log_dao: Any,
) -> Dict[str, Any]:
    file_record = await file_dao.get_file(file_id)
    if not file_record or file_record["user_id"] != user_id:
        raise LegacyFileForbidden("无权操作")

    await file_dao.delete_file(file_id)
    await activity_log_dao.log_activity(
        user_id=user_id,
        action="delete_file",
        resource_type="file",
        resource_id=file_id,
    )
    return {"success": True, "message": "文件已删除"}
