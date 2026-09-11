"""Business logic for generic upload and thumbnail routes."""
from __future__ import annotations

import asyncio
import hashlib
import os
import time
import uuid
import weakref
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Optional
from urllib.parse import urlparse

from services.entity_access_service import EntityAccessDenied, require_file_access
from services.image_safety_service import UnsafeImageError, open_image_path_safely
from services.local_file_access_service import (
    configured_media_roots,
    resolve_allowed_media_file,
    resolve_storage_url_file,
)
from services.project_access_service import ProjectAccessDenied, require_project_access


THUMBNAIL_CACHE_DIR = Path("temp") / "thumbnail_cache"
DEPLOY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_THUMBNAIL_CACHE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
DEFAULT_THUMBNAIL_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024
DEFAULT_THUMBNAIL_TMP_MAX_AGE_SECONDS = 60 * 60


class _ThumbnailWork:
    def __init__(self):
        self.slots = asyncio.Semaphore(2)
        self.pending: dict[str, asyncio.Task] = {}


_thumbnail_work: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()


def _thumbnail_scheduler() -> _ThumbnailWork:
    loop = asyncio.get_running_loop()
    if loop not in _thumbnail_work:
        _thumbnail_work[loop] = _ThumbnailWork()
    return _thumbnail_work[loop]


def _render_image_thumbnail(file_path: str, output: Path, width: int, height: int):
    from PIL import Image

    try:
        with open_image_path_safely(file_path) as img:
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            img.thumbnail((width, height), Image.Resampling.LANCZOS)
            img.save(output, format="JPEG", quality=75, optimize=True)
    except UnsafeImageError as exc:
        raise ThumbnailImageUnsafe("unsafe_image_dimensions") from exc


MIME_EXTENSION_MAP = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
}
FILE_TYPE_EXTENSIONS = {
    "image": {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"},
    "video": {".mp4", ".avi", ".mov", ".mkv", ".flv", ".wmv", ".webm"},
    "audio": {".mp3", ".wav", ".m4a", ".aac", ".ogg"},
}


class FileRouteServiceError(RuntimeError):
    pass


class ThumbnailAuthRequired(FileRouteServiceError):
    pass


class ThumbnailFileNotFound(FileRouteServiceError):
    pass


class ThumbnailImageUnsafe(FileRouteServiceError):
    pass


class UploadFileTooLarge(FileRouteServiceError):
    pass


class UnsupportedUploadFileType(FileRouteServiceError):
    def __init__(self, content_type: str):
        super().__init__(content_type)
        self.content_type = content_type


class UploadFileRecordError(FileRouteServiceError):
    pass


class UploadVersionAccessDenied(FileRouteServiceError):
    pass


class _ThumbnailFileAccessDAO:
    def __init__(self, file_dao: Any):
        self.file_dao = file_dao

    async def get_by_id(self, file_id: str) -> Optional[Dict[str, Any]]:
        return await self.file_dao.get_file(file_id)


async def require_thumbnail_source_access(
    url: str,
    identity: str,
    *,
    file_dao: Any,
    file_access_checker: Callable[..., Any] = require_file_access,
) -> Dict[str, Any]:
    path = urlparse(url or "").path
    parts = [part for part in path.split("/") if part]
    file_id = parts[2] if len(parts) >= 3 and parts[:2] == ["api", "files"] else None
    record = await file_dao.get_file(file_id) if file_id else None
    if not record and hasattr(file_dao, "get_file_by_url"):
        record = await file_dao.get_file_by_url(url)
    if not record or not record.get("file_id"):
        raise ThumbnailFileNotFound("file_not_found")
    try:
        await file_access_checker(
            str(record["file_id"]),
            identity,
            "readonly",
            file_dao=_ThumbnailFileAccessDAO(file_dao),
        )
    except EntityAccessDenied as exc:
        raise ThumbnailFileNotFound("file_not_found") from exc
    return dict(record)


@dataclass(frozen=True)
class ThumbnailFile:
    path: Path
    media_type: str
    headers: Dict[str, str]


def _thumbnail_cache_limit(env_name: str, default: int, *, logger: Any) -> int:
    try:
        return max(0, int(os.getenv(env_name, str(default))))
    except (TypeError, ValueError):
        logger.warning("Invalid %s value, using default %s", env_name, default)
        return default


def cleanup_thumbnail_cache(
    *,
    cache_dir: Optional[Path] = None,
    max_age_seconds: Optional[int] = None,
    max_bytes: Optional[int] = None,
    tmp_max_age_seconds: int = DEFAULT_THUMBNAIL_TMP_MAX_AGE_SECONDS,
    logger: Any,
) -> Dict[str, int]:
    cache_path = Path(cache_dir or THUMBNAIL_CACHE_DIR)
    stats = {
        "scanned": 0,
        "removed": 0,
        "bytes_before": 0,
        "bytes_removed": 0,
        "bytes_after": 0,
    }
    if not cache_path.exists():
        return stats

    max_age = (
        _thumbnail_cache_limit("THUMBNAIL_CACHE_MAX_AGE_SECONDS", DEFAULT_THUMBNAIL_CACHE_MAX_AGE_SECONDS, logger=logger)
        if max_age_seconds is None
        else max(0, int(max_age_seconds))
    )
    byte_limit = (
        _thumbnail_cache_limit("THUMBNAIL_CACHE_MAX_BYTES", DEFAULT_THUMBNAIL_CACHE_MAX_BYTES, logger=logger)
        if max_bytes is None
        else max(0, int(max_bytes))
    )

    now = time.time()
    remaining: list[tuple[float, int, Path]] = []

    for entry in cache_path.iterdir():
        if not entry.is_file():
            continue
        if entry.suffix.lower() not in {".jpg", ".tmp"}:
            continue

        try:
            stat = entry.stat()
        except FileNotFoundError:
            continue

        stats["scanned"] += 1
        stats["bytes_before"] += stat.st_size
        age = now - stat.st_mtime
        should_remove = False
        if entry.suffix.lower() == ".tmp":
            should_remove = age > tmp_max_age_seconds
        else:
            should_remove = max_age > 0 and age > max_age

        if should_remove:
            try:
                entry.unlink(missing_ok=True)
                stats["removed"] += 1
                stats["bytes_removed"] += stat.st_size
            except Exception as exc:
                logger.warning("Failed to remove thumbnail cache file %s: %s", entry, exc)
            continue

        if entry.suffix.lower() == ".jpg":
            remaining.append((stat.st_mtime, stat.st_size, entry))
            stats["bytes_after"] += stat.st_size

    if byte_limit > 0 and stats["bytes_after"] > byte_limit:
        for _, size, entry in sorted(remaining, key=lambda item: item[0]):
            if stats["bytes_after"] <= byte_limit:
                break
            try:
                entry.unlink(missing_ok=True)
                stats["removed"] += 1
                stats["bytes_removed"] += size
                stats["bytes_after"] -= size
            except Exception as exc:
                logger.warning("Failed to trim thumbnail cache file %s: %s", entry, exc)

    return stats


def thumbnail_headers() -> Dict[str, str]:
    return {
        "Cache-Control": "public, max-age=86400",
        "Content-Disposition": "inline",
    }


def thumbnail_cache_path(
    file_path: str,
    width: int,
    height: int,
    *,
    cache_dir: Path = THUMBNAIL_CACHE_DIR,
) -> Path:
    source = Path(file_path).resolve()
    stat = source.stat()
    material = f"{source}|{stat.st_mtime_ns}|{stat.st_size}|{width}x{height}"
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()
    return cache_dir / f"{digest}.jpg"


async def resolve_thumbnail_source(
    url: str,
    *,
    file_dao: Any,
    logger: Any,
    deploy_root: Path = DEPLOY_ROOT,
    media_roots: Optional[list[Path]] = None,
) -> Optional[str]:
    url_path = urlparse(url or "").path
    roots = tuple(media_roots or configured_media_roots(deploy_root=deploy_root))
    if url_path.startswith("/uploads/"):
        uploads_root = deploy_root.resolve() / "temp" / "uploads"
        resolved = resolve_allowed_media_file(
            uploads_root / url_path[len("/uploads/"):],
            deploy_root=deploy_root,
            allowed_roots=(uploads_root,),
        )
        return str(resolved) if resolved else None
    if url_path.startswith("/storage/"):
        storage_roots = tuple(root for root in roots if root != deploy_root.resolve() / "temp" / "uploads")
        resolved = resolve_storage_url_file(
            url_path,
            deploy_root=deploy_root,
            storage_roots=storage_roots,
        )
        return str(resolved) if resolved else None
    if url_path.startswith("/api/files/"):
        parts = url_path.split("/")
        if len(parts) >= 4:
            file_id = parts[3]
            try:
                file_record = await file_dao.get_file(file_id)
                if file_record:
                    resolved = resolve_allowed_media_file(
                        file_record.get("file_path") or "",
                        deploy_root=deploy_root,
                        allowed_roots=roots,
                    )
                    return str(resolved) if resolved else None
            except Exception as exc:
                logger.warning("Failed to load thumbnail file record: %s", exc)
    return None


async def build_thumbnail_file(
    *,
    url: str,
    width: int,
    height: int,
    file_dao: Any,
    logger: Any,
    cache_dir: Path = THUMBNAIL_CACHE_DIR,
    uuid_hex_provider: Callable[[], str] = lambda: uuid.uuid4().hex,
    deploy_root: Path = DEPLOY_ROOT,
    media_roots: Optional[list[Path]] = None,
) -> ThumbnailFile:
    file_path = await resolve_thumbnail_source(
        url,
        file_dao=file_dao,
        logger=logger,
        deploy_root=deploy_root,
        media_roots=media_roots,
    )
    if not file_path or not os.path.exists(file_path):
        logger.warning("Thumbnail source file does not exist: %s", file_path)
        raise ThumbnailFileNotFound("file_not_found")

    thumb_width = max(1, int(width))
    thumb_height = max(1, int(height))
    cache_path = thumbnail_cache_path(file_path, thumb_width, thumb_height, cache_dir=cache_dir)
    if cache_path.exists():
        return ThumbnailFile(path=cache_path, media_type="image/jpeg", headers=thumbnail_headers())

    work = _thumbnail_scheduler()
    key = str(cache_path.resolve())

    async def generate():
        async with work.slots:
            if cache_path.exists():
                return
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            tmp_cache_path = cache_path.with_name(f"{cache_path.name}.{uuid_hex_provider()}.tmp")
            try:
                if Path(file_path).suffix.lower() in FILE_TYPE_EXTENSIONS["video"]:
                    from file_optimization import FileOptimizationService

                    result = await FileOptimizationService.create_video_thumbnail(
                        file_path, str(tmp_cache_path), max_size=(thumb_width, thumb_height),
                    )
                    if not result.get("success"):
                        raise ThumbnailFileNotFound("video_thumbnail_failed")
                else:
                    await asyncio.to_thread(
                        _render_image_thumbnail, file_path, tmp_cache_path, thumb_width, thumb_height,
                    )
                os.replace(tmp_cache_path, cache_path)
            finally:
                tmp_cache_path.unlink(missing_ok=True)

    task = work.pending.get(key)
    if task is None:
        task = asyncio.create_task(generate())
        work.pending[key] = task

        def finished(completed):
            work.pending.pop(key, None)
            if not work.pending:
                _thumbnail_work.pop(asyncio.get_running_loop(), None)
            if not completed.cancelled():
                completed.exception()

        task.add_done_callback(finished)
    # A disconnected viewer must not cancel work shared by other viewers.
    # Access checks and source resolution still run separately for every request.
    await asyncio.shield(task)

    return ThumbnailFile(path=cache_path, media_type="image/jpeg", headers=thumbnail_headers())


def detect_upload_file_type(filename: str, content_type: str) -> str:
    if content_type.startswith("image/"):
        return "image"
    if content_type.startswith("video/"):
        return "video"
    if content_type.startswith("audio/"):
        return "audio"

    ext = Path(filename or "").suffix.lower()
    if ext in [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]:
        return "image"
    if ext in [".mp4", ".avi", ".mov", ".mkv", ".flv", ".wmv"]:
        return "video"
    if ext in FILE_TYPE_EXTENSIONS["audio"]:
        return "audio"
    raise UnsupportedUploadFileType(content_type)


def upload_extension(filename: str, content_type: str, file_type: str) -> str:
    ext = Path(filename or "").suffix.lower()
    if ext in FILE_TYPE_EXTENSIONS.get(file_type, set()):
        return ext
    mime_ext = MIME_EXTENSION_MAP.get((content_type or "").split(";", 1)[0].lower())
    if mime_ext:
        return mime_ext
    return ext


async def _ensure_upload_version(
    *,
    username: str,
    version_id: Optional[str],
    project_dao: Any,
    version_dao: Any,
    uuid_hex_provider: Callable[[], str],
    project_access_checker: Callable[..., Any] = require_project_access,
) -> str:
    if version_id:
        version = await version_dao.get_version(version_id)
        if not version:
            raise UploadVersionAccessDenied("Version not found or access denied")
        if str(version.get("user_id") or "") == str(username):
            return version_id
        project_id = str(version.get("project_id") or "")
        if not project_id:
            raise UploadVersionAccessDenied("Version not found or access denied")
        try:
            await project_access_checker(project_id, username, "member")
        except ProjectAccessDenied as exc:
            raise UploadVersionAccessDenied("Version not found or access denied") from exc
        return version_id

    projects = await project_dao.get_user_projects(username)
    if not projects:
        project_id = f"proj_{uuid_hex_provider()[:12]}"
        await project_dao.save_or_update_project(
            user_id=username,
            project_id=project_id,
            project_name="默认项目",
            project_data={},
            description="自动创建的默认项目",
        )
    else:
        project_id = projects[0]["project_id"]

    versions = await version_dao.get_project_versions(project_id)
    if not versions:
        version = await version_dao.create_version(
            project_id=project_id,
            user_id=username,
            version_name="默认版本",
            description="自动创建",
        )
        return version["version_id"]
    return versions[0]["version_id"]


async def upload_generic_file(
    *,
    filename: str,
    content_type: str,
    content: bytes,
    version_id: Optional[str],
    username: str,
    max_upload_size: int,
    file_dao: Any,
    project_dao: Any,
    version_dao: Any,
    logger: Any,
    storage_root: Path = Path("persistent_storage"),
    now_provider: Callable[[], datetime] = datetime.now,
    uuid_hex_provider: Callable[[], str] = lambda: uuid.uuid4().hex,
    project_access_checker: Callable[..., Any] = require_project_access,
) -> Dict[str, Any]:
    if len(content) > max_upload_size:
        raise UploadFileTooLarge("file_too_large")

    safe_filename = filename or "upload"
    file_type = detect_upload_file_type(safe_filename, content_type)
    file_id = f"file_{uuid_hex_provider()[:12]}"
    ext = upload_extension(safe_filename, content_type, file_type)
    server_filename = f"{file_id}{ext}"
    resolved_version_id = await _ensure_upload_version(
        username=username,
        version_id=version_id,
        project_dao=project_dao,
        version_dao=version_dao,
        uuid_hex_provider=uuid_hex_provider,
        project_access_checker=project_access_checker,
    )
    year_month = now_provider().strftime("%Y%m")
    storage_dir = storage_root / f"{file_type}s" / username / year_month
    storage_dir.mkdir(parents=True, exist_ok=True)
    file_path = storage_dir / server_filename

    file_path.write_bytes(content)

    try:
        file_record = await file_dao.create_file(
            version_id=resolved_version_id,
            user_id=username,
            file_type=file_type,
            file_name=safe_filename,
            file_path=str(file_path),
            file_url=f"/api/files/{file_id}/download",
            file_size_bytes=len(content),
            mime_type=content_type or f"{file_type}/*",
            metadata={"source": "upload_api"},
            file_id=file_id,
        )
    except Exception as exc:
        try:
            file_path.unlink(missing_ok=True)
            logger.info("Rolled back physical file after DB write failure: %s", file_path)
        except Exception:
            logger.error("Failed to roll back physical file: %s", file_path)
        raise UploadFileRecordError(str(exc)) from exc

    logger.info("User %s uploaded %s: %s, file_id=%s", username, file_type, safe_filename, file_id)
    return {
        "success": True,
        "file_id": file_record["file_id"],
        "filename": server_filename,
        "server_filename": server_filename,
        "original_filename": safe_filename,
        "storage_url": file_record["file_url"],
        "url": file_record["file_url"],
        "path": str(file_path),
        "file_type": file_type,
        "size": len(content),
    }
