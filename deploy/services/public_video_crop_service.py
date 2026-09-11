"""Source-edition video cropping without local-node or ComfyUI transports."""
from __future__ import annotations

import hashlib
import math
import os
import shutil
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional
from urllib.parse import urlparse

from services.entity_access_service import EntityAccessDenied, require_file_access
from services.local_file_access_service import configured_media_roots, resolve_allowed_media_file


class PublicVideoCropError(RuntimeError):
    pass


class PublicVideoCropAccessDenied(PublicVideoCropError):
    pass


class PublicVideoCropInvalidRequest(PublicVideoCropError):
    pass


class PublicVideoCropUnavailable(PublicVideoCropError):
    pass


class PublicVideoCropFailed(PublicVideoCropError):
    pass


class _FileAccessDAO:
    def __init__(self, file_dao: Any):
        self.file_dao = file_dao

    async def get_by_id(self, file_id: str) -> Optional[Dict[str, Any]]:
        return await self.file_dao.get_file(file_id)


def _extract_file_id(value: str) -> Optional[str]:
    path = urlparse(value or "").path
    parts = [part for part in path.split("/") if part]
    if len(parts) >= 3 and parts[:2] == ["api", "files"]:
        return parts[2]
    name = Path(path).name
    return name if name.startswith("file_") and not Path(name).suffix else None


async def require_public_video_source(
    video_ref: str,
    identity: str,
    *,
    file_dao: Any,
    file_access_checker: Callable[..., Any] = require_file_access,
) -> Dict[str, Any]:
    file_id = _extract_file_id(video_ref)
    record = await file_dao.get_file(file_id) if file_id else None
    if not record and hasattr(file_dao, "get_file_by_url"):
        record = await file_dao.get_file_by_url(video_ref)
    if not record or not record.get("file_id"):
        raise PublicVideoCropAccessDenied("Video source not found or access denied")
    try:
        return dict(
            await file_access_checker(
                str(record["file_id"]),
                identity,
                "readonly",
                file_dao=_FileAccessDAO(file_dao),
            )
        )
    except EntityAccessDenied as exc:
        raise PublicVideoCropAccessDenied("Video source not found or access denied") from exc


def resolve_public_video_path(
    record: Dict[str, Any],
    *,
    deploy_root: Path,
    media_roots: Optional[tuple[Path, ...]] = None,
) -> Path:
    file_path = str(record.get("file_path") or "").strip()
    if not file_path or file_path.lower().startswith("comfyui://"):
        raise PublicVideoCropAccessDenied("Video source not found or access denied")
    roots = media_roots or configured_media_roots(deploy_root=deploy_root)
    resolved = resolve_allowed_media_file(
        file_path,
        deploy_root=deploy_root,
        allowed_roots=roots,
    )
    if resolved is None:
        raise PublicVideoCropAccessDenied("Video source not found or access denied")
    return resolved


def _limit_from_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def _storage_owner_key(identity: str) -> str:
    """Keep authenticated identities out of filesystem path semantics."""
    digest = hashlib.sha256(str(identity).encode("utf-8")).hexdigest()
    return f"user_{digest[:24]}"


async def crop_public_video_file(
    *,
    video_ref: str,
    start_time: float,
    end_time: float,
    identity: str,
    file_dao: Any,
    deploy_root: Path,
    logger: Any,
    file_access_checker: Callable[..., Any] = require_file_access,
    media_roots: Optional[tuple[Path, ...]] = None,
    storage_root: Optional[Path] = None,
    ffmpeg_available: Callable[[str], Optional[str]] = shutil.which,
    ffmpeg_runner: Callable[..., Any] = subprocess.run,
    uuid_hex_provider: Callable[[], str] = lambda: uuid.uuid4().hex,
    now_provider: Callable[[], datetime] = datetime.now,
) -> Dict[str, Any]:
    max_duration = _limit_from_env("PUBLIC_VIDEO_CROP_MAX_DURATION_SECONDS", 3600, 1, 86400)
    if (not math.isfinite(start_time) or not math.isfinite(end_time)
            or start_time < 0 or end_time <= start_time or end_time - start_time > max_duration):
        raise PublicVideoCropInvalidRequest(
            f"裁剪时间无效，片段必须大于 0 秒且不超过 {max_duration} 秒"
        )
    ffmpeg_command = os.getenv("FFMPEG_BIN", "ffmpeg").strip() or "ffmpeg"
    ffmpeg_path = ffmpeg_available(ffmpeg_command)
    if not ffmpeg_path:
        raise PublicVideoCropUnavailable("服务器未安装 FFmpeg，无法进行视频裁剪")

    record = await require_public_video_source(
        video_ref,
        identity,
        file_dao=file_dao,
        file_access_checker=file_access_checker,
    )
    if str(record.get("file_type") or "").strip().lower() != "video":
        raise PublicVideoCropAccessDenied("Video source not found or access denied")
    source = resolve_public_video_path(record, deploy_root=deploy_root, media_roots=media_roots)
    max_bytes = _limit_from_env(
        "PUBLIC_VIDEO_CROP_MAX_SOURCE_BYTES",
        512 * 1024 * 1024,
        1024 * 1024,
        2 * 1024 * 1024 * 1024,
    )
    if source.stat().st_size > max_bytes:
        raise PublicVideoCropInvalidRequest("视频文件超过公开版裁剪大小上限")

    output_base = Path(
        storage_root
        or os.getenv("STORAGE_BASE_PATH", str(deploy_root / "persistent_storage"))
    ).expanduser()
    if not output_base.is_absolute():
        output_base = deploy_root / output_base
    output_dir = (
        output_base.resolve()
        / "videos"
        / _storage_owner_key(identity)
        / now_provider().strftime("%Y%m")
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    file_id = f"file_{uuid_hex_provider()[:12]}"
    filename = f"cropped_{uuid_hex_provider()[:12]}.mp4"
    final_path = output_dir / filename
    temporary_path = output_dir / f".{filename}.{uuid_hex_provider()[:8]}.tmp"

    command = [
        str(ffmpeg_path),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(source),
        "-ss",
        str(start_time),
        "-t",
        str(end_time - start_time),
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        # The atomic staging suffix is .tmp, so FFmpeg cannot infer the muxer.
        "-f",
        "mp4",
        "-y",
        str(temporary_path),
    ]
    timeout_seconds = _limit_from_env("PUBLIC_VIDEO_CROP_TIMEOUT_SECONDS", 180, 10, 1800)
    persisted = False
    try:
        logger.info("Cropping authorized source-edition video file_id=%s", record["file_id"])
        result = ffmpeg_runner(
            command,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
        if result.returncode != 0 or not temporary_path.is_file() or temporary_path.stat().st_size == 0:
            logger.warning(
                "Source-edition video crop failed file_id=%s return_code=%s",
                record["file_id"],
                result.returncode,
            )
            raise PublicVideoCropFailed("FFmpeg 未能生成有效视频")
        os.replace(temporary_path, final_path)

        created = await file_dao.create_file(
            version_id=record.get("version_id"),
            user_id=identity,
            file_type="video",
            file_name=filename,
            file_path=str(final_path),
            file_url=f"/api/files/{file_id}/download",
            file_size_bytes=final_path.stat().st_size,
            mime_type="video/mp4",
            metadata={
                "source": "public_video_crop",
                "source_file_id": record["file_id"],
                "start_time": start_time,
                "end_time": end_time,
                "duration": end_time - start_time,
                "cropped_at": datetime.now(timezone.utc).isoformat(),
            },
            file_id=file_id,
        )
        if not created:
            raise PublicVideoCropFailed("裁剪结果未能写入文件记录")
        persisted = True
        return {
            "success": True,
            "file_id": file_id,
            "filename": filename,
            "url": f"/api/files/{file_id}/download",
            "start_time": start_time,
            "end_time": end_time,
            "duration": end_time - start_time,
            "size": final_path.stat().st_size,
        }
    except subprocess.TimeoutExpired as exc:
        raise PublicVideoCropFailed("视频裁剪超时") from exc
    except PublicVideoCropError:
        raise
    except Exception as exc:
        logger.error("Source-edition video crop failed: %s", type(exc).__name__, exc_info=True)
        raise PublicVideoCropFailed("视频裁剪失败") from exc
    finally:
        temporary_path.unlink(missing_ok=True)
        if final_path.exists() and not persisted:
            final_path.unlink(missing_ok=True)
