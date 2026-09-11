"""Admin recycle-bin service for soft-deleted files."""
from __future__ import annotations

import mimetypes
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from dao.admin.recycle_bin import AdminRecycleBinDAO


DEPLOY_ROOT = Path(__file__).resolve().parents[1]
PURGE_ROOT = DEPLOY_ROOT / "persistent_storage"


class RecycleBinNotFound(RuntimeError):
    pass


class RecycleBinRiskNotAcknowledged(RuntimeError):
    pass


class RecycleBinUnsafePath(RuntimeError):
    pass


def _download_filename(item: Dict[str, Any], path: Path) -> str:
    name = str(item.get("media_name") or item.get("file_name") or path.name or item.get("file_id") or "download").strip()
    return name or "download"


def _jsonable_file(row: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(row)
    for key in ("created_at", "updated_at", "deleted_at"):
        value = out.get(key)
        if hasattr(value, "isoformat"):
            out[key] = value.isoformat()
    return out


def _resolve_purge_path(file_path: Optional[str]) -> Optional[Path]:
    if not file_path:
        return None
    candidate = Path(file_path)
    if not candidate.is_absolute():
        candidate = DEPLOY_ROOT / candidate
    resolved = candidate.resolve()
    try:
        resolved.relative_to(PURGE_ROOT.resolve())
    except ValueError as exc:
        raise RecycleBinUnsafePath(f"Refusing to purge path outside persistent_storage: {resolved}") from exc
    return resolved


def _attach_disk_state(row: Dict[str, Any]) -> Dict[str, Any]:
    item = _jsonable_file(row)
    try:
        path = _resolve_purge_path(item.get("file_path"))
    except RecycleBinUnsafePath:
        item["disk_exists"] = False
        item["purge_eligible"] = False
        item["purge_blocked_reason"] = "unsafe_path"
        item["download_available"] = False
        item["download_url"] = ""
        item["preview_unavailable_reason"] = "文件路径不安全，已禁止预览或下载。"
        return item

    item["purge_eligible"] = bool(path)
    item["disk_path"] = str(path) if path else ""
    if path and path.exists() and path.is_file():
        item["disk_exists"] = True
        item["disk_size_bytes"] = path.stat().st_size
        if item.get("file_id"):
            item["download_available"] = True
            item["download_url"] = f"/api/admin/trash/files/{item['file_id']}/download"
    else:
        item["disk_exists"] = False
        item["disk_size_bytes"] = 0
        item["download_available"] = False
        item["download_url"] = ""
        item["preview_unavailable_reason"] = "磁盘文件不存在，无法预览或下载。"
    return item


_REFERENCE_TARGET_LABELS = {
    "storyboard_image": "分镜画面",
    "storyboard_dialogue_audio": "分镜对白音频",
    "storyboard_narration_audio": "分镜旁白音频",
    "storyboard_sfx_audio": "分镜音效",
    "storyboard_mixed_audio": "分镜混音",
    "video_segment_video": "视频片段",
    "video_segment_thumbnail": "视频封面",
    "asset_thumbnail": "素材封面",
    "asset_reference_image": "素材参考图",
}


def _positive_int(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _restore_targets_from_counts(item: Dict[str, Any], reference_counts: Dict[str, int]) -> List[str]:
    targets: List[str] = []
    media_library_count = _positive_int(item.get("media_library_count"))
    if media_library_count:
        targets.append(f"素材库 {media_library_count} 条")

    entity_type = str(item.get("entity_type") or "").strip()
    entity_id = str(item.get("entity_id") or "").strip()
    file_role = str(item.get("file_role") or "").strip()
    if entity_type and entity_id:
        suffix = f" / {file_role}" if file_role else ""
        targets.append(f"{entity_type}:{entity_id}{suffix}")

    for key, label in _REFERENCE_TARGET_LABELS.items():
        count = _positive_int(reference_counts.get(key))
        if count:
            targets.append(f"{label} {count} 条")

    if not targets:
        targets.append("仅文件记录")
    return targets


async def _attach_restore_context(item: Dict[str, Any]) -> Dict[str, Any]:
    reference_counts = await AdminRecycleBinDAO.file_reference_counts(str(item.get("file_url") or ""))
    legacy_reference_count = sum(_positive_int(value) for value in reference_counts.values())
    media_library_count = _positive_int(item.get("media_library_count"))
    targets = _restore_targets_from_counts(item, reference_counts)

    warnings: List[str] = []
    if not item.get("disk_exists"):
        warnings.append("磁盘文件不存在：恢复后只会恢复数据库记录，原图/视频仍可能打不开。")
    if not media_library_count and not legacy_reference_count and not item.get("entity_type"):
        warnings.append("未发现素材库或业务引用：恢复后可能只在文件库中可见。")

    if not item.get("disk_exists"):
        visibility = "missing_disk"
    elif media_library_count or legacy_reference_count or item.get("entity_type"):
        visibility = "normal"
    else:
        visibility = "file_record_only"

    item["legacy_reference_counts"] = reference_counts
    item["legacy_reference_count"] = legacy_reference_count
    item["media_library_count"] = media_library_count
    item["restore_targets"] = targets
    item["restore_warnings"] = warnings
    item["restore_visibility"] = visibility
    return item


async def list_recycle_bin_files(
    *,
    user_id: Optional[str] = None,
    project_id: Optional[str] = None,
    file_type: Optional[str] = None,
    keyword: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> Dict[str, Any]:
    result = await AdminRecycleBinDAO.list_deleted_files(
        user_id=user_id,
        project_id=project_id,
        file_type=file_type,
        keyword=keyword,
        limit=max(1, min(int(limit or 50), 200)),
        offset=max(0, int(offset or 0)),
    )
    items = []
    for row in result.get("items", []):
        items.append(await _attach_restore_context(_attach_disk_state(row)))
    return {
        "success": True,
        "items": items,
        "total": result.get("total", 0),
        "limit": limit,
        "offset": offset,
        "disk_bytes": sum(int(item.get("disk_size_bytes") or 0) for item in items),
    }


async def restore_recycle_bin_file(file_id: str) -> Dict[str, Any]:
    row = await AdminRecycleBinDAO.restore_file(file_id)
    if not row:
        raise RecycleBinNotFound("Deleted file not found")
    item = await _attach_restore_context(_attach_disk_state(row))
    return {
        "success": True,
        "file": item,
        "restore_targets": item.get("restore_targets", []),
        "restore_warnings": item.get("restore_warnings", []),
        "restore_visibility": item.get("restore_visibility"),
    }


async def get_recycle_bin_download_info(file_id: str) -> Dict[str, Any]:
    row = await AdminRecycleBinDAO.get_file_any(file_id)
    if not row or row.get("is_deleted") is not True:
        raise RecycleBinNotFound("Deleted file not found")

    path = _resolve_purge_path(row.get("file_path"))
    if not path or not path.exists() or not path.is_file():
        raise RecycleBinNotFound("Disk file not found")

    filename = _download_filename(row, path)
    media_type = mimetypes.guess_type(filename or path.name)[0] or "application/octet-stream"
    return {
        "path": path,
        "filename": filename,
        "media_type": media_type,
        "file_size": path.stat().st_size,
    }


async def purge_recycle_bin_file(
    file_id: str,
    *,
    risk_ack: bool,
    delete_db_record: bool = True,
) -> Dict[str, Any]:
    if not risk_ack:
        raise RecycleBinRiskNotAcknowledged("risk_ack is required")

    row = await AdminRecycleBinDAO.get_file_any(file_id)
    if not row or row.get("is_deleted") is not True:
        raise RecycleBinNotFound("Deleted file not found")

    path = _resolve_purge_path(row.get("file_path"))
    disk_exists = bool(path and path.exists() and path.is_file())
    freed_bytes = int(path.stat().st_size) if disk_exists and path else 0
    removed_disk = False
    disk_error: Optional[str] = None
    if disk_exists and path:
        try:
            os.remove(path)
            removed_disk = True
        except OSError as exc:
            disk_error = str(exc)
            await AdminRecycleBinDAO.mark_file_purge_failed(file_id, disk_error)

    if disk_error:
        return {
            "success": False,
            "file_id": file_id,
            "removed_disk": False,
            "deleted_db_record": False,
            "freed_bytes": 0,
            "error": disk_error,
        }

    await AdminRecycleBinDAO.clear_legacy_references(str(row.get("file_url") or ""))
    deleted_db_record = False
    if delete_db_record:
        deleted_db_record = await AdminRecycleBinDAO.delete_file_record(file_id)

    return {
        "success": True,
        "file_id": file_id,
        "removed_disk": removed_disk,
        "deleted_db_record": deleted_db_record,
        "freed_bytes": freed_bytes,
        "disk_existed": disk_exists,
    }


async def purge_recycle_bin_files(
    file_ids: List[str],
    *,
    risk_ack: bool,
    delete_db_record: bool = True,
) -> Dict[str, Any]:
    if not risk_ack:
        raise RecycleBinRiskNotAcknowledged("risk_ack is required")
    unique_ids = [file_id for file_id in dict.fromkeys(file_ids or []) if file_id]
    if len(unique_ids) > 200:
        raise ValueError("Batch purge accepts at most 200 files")

    results = []
    freed_bytes = 0
    purged = 0
    errors = []
    for file_id in unique_ids:
        try:
            result = await purge_recycle_bin_file(
                file_id,
                risk_ack=True,
                delete_db_record=delete_db_record,
            )
            results.append(result)
            if result.get("success"):
                purged += 1
                freed_bytes += int(result.get("freed_bytes") or 0)
            else:
                errors.append({"file_id": file_id, "error": result.get("error")})
        except Exception as exc:
            errors.append({"file_id": file_id, "error": str(exc)})
    return {
        "success": not errors,
        "requested": len(unique_ids),
        "purged": purged,
        "freed_bytes": freed_bytes,
        "errors": errors,
        "results": results,
    }
