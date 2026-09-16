"""Validate and persist one paid result, replaying the same file/entity identity."""
from __future__ import annotations

import asyncio
import hashlib
import os
import re
import shutil
from pathlib import Path

from services.jimeng_contract import EXECUTION_MODEL, MODEL_KEY, TASK_TYPE, JimengError
from services.jimeng_media_service import probe_media


def inspect_result(response: dict, directory: Path, expected_duration: int) -> tuple[Path, dict]:
    videos = (response.get("result_json") or {}).get("videos")
    if not isinstance(videos, list) or len(videos) != 1 or not isinstance(videos[0], dict):
        raise JimengError("即梦结果文件暂不可用，继续查询原任务，不会重新生成。")
    path = Path(str(videos[0].get("path") or ""))
    # A CLI download must be an ordinary local MP4 inside this task's directory.
    if not path.is_absolute() or path.is_symlink() or path.suffix.lower() != ".mp4":
        raise JimengError("即梦下载文件校验失败，需要核查原任务。")
    root = directory.resolve(strict=True)
    if not path.resolve(strict=True).is_relative_to(root):
        raise JimengError("即梦下载文件不属于当前任务。")
    if any(p.is_symlink() for p in [path, *path.parents] if p != root and p.is_relative_to(root)):
        raise JimengError("即梦下载文件路径校验失败。")
    size = path.stat().st_size
    if size <= 0 or size > 512 * 1024**2 or path.stat().st_nlink != 1:
        raise JimengError("即梦结果文件大小或文件类型异常。")
    probe = probe_media(path, "video")
    duration = probe["duration_seconds"]
    stream = probe["streams"][0]
    width, height = int(stream.get("width") or 0), int(stream.get("height") or 0)
    if abs(duration - expected_duration) > 0.5 or min(width, height) != 720:
        raise JimengError("即梦结果时长或分辨率与请求不符，已保留原任务等待核查。")
    return path, {"duration_seconds": duration, "duration_ms": round(duration * 1000),
                  "width": width, "height": height, "codec": stream.get("codec_name"),
                  "frame_rate": stream.get("avg_frame_rate"), "size": size,
                  "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


async def persist_result(task, path: Path, metadata: dict, job: dict) -> dict:
    from db_manager import get_db_manager
    from dao.content.content import FileDAO
    from services.generation_access_service import require_generation_request_access
    from types import SimpleNamespace

    data, user_id = task.data, str(task.user_id)
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", user_id + "") or not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", task.task_id):
        raise JimengError("任务归属校验失败。")
    # Recheck membership before writing a result into its target episode.
    await require_generation_request_access(SimpleNamespace(**data), user_id, [], file_dao=FileDAO)
    root = Path("persistent_storage/video").resolve()
    directory = root / user_id / "jimeng"
    directory.mkdir(parents=True, exist_ok=True)
    if directory.is_symlink() or not directory.resolve().is_relative_to(root):
        raise JimengError("成片保存位置校验失败。")
    filename = "jimeng_" + task.task_id + ".mp4"
    target = directory / filename
    if target.is_symlink():
        raise JimengError("成片文件校验失败。")
    if not target.exists():
        temporary = directory / (filename + ".partial")
        if temporary.is_symlink():
            raise JimengError("成片临时文件校验失败。")
        await asyncio.to_thread(shutil.copyfile, path, temporary)
        os.replace(temporary, target)
    if await asyncio.to_thread(lambda: hashlib.sha256(target.read_bytes()).hexdigest()) != metadata["sha256"]:
        raise JimengError("成片文件内容与已验证结果不一致，需人工核查。")
    file_id = "file_" + hashlib.sha256(("jimeng:" + task.task_id).encode()).hexdigest()[:24]
    url = f"/storage/video/{user_id}/jimeng/{filename}"
    meta = {**metadata, "task_id": task.task_id, "task_type": TASK_TYPE, "model": MODEL_KEY,
            "execution_model": EXECUTION_MODEL, "source": "jimeng", "submit_id": job["submit_id"],
            "input_trace": job["input_trace"], "prompt": data["prompt"],
            "project_id": data.get("project_id"), "episode_id": data.get("episode_id")}
    record = await FileDAO.get_file(file_id)
    if not record:
        # A soft-deleted prior output is not silently resurrected by recovery.
        if await get_db_manager().fetchval("SELECT EXISTS(SELECT 1 FROM files WHERE file_id=$1)", file_id):
            raise JimengError("本任务结果已删除，需要人工核查，不能自动恢复或重新生成。")
        record = await FileDAO.create_file(version_id=data.get("version_id"), user_id=user_id,
            file_id=file_id, file_type="video", file_name=filename, file_path=str(target),
            file_url=url, file_size_bytes=metadata["size"], mime_type="video/mp4", metadata=meta,
            entity_type=data.get("entity_type"), entity_id=data.get("entity_id"), file_role="video",
            project_id=data.get("project_id"), episode_id=data.get("episode_id"), source="jimeng")
    if not record or record["user_id"] != user_id or record["file_url"] != url:
        raise JimengError("即梦成片记录校验失败。")
    if data.get("entity_type") == "video_segment" and data.get("entity_id"):
        await attach_generated_result(get_db_manager(), data["entity_id"], data.get("episode_id"),
            task.task_id, file_id, url, metadata["duration_ms"])
    import media_library_service
    library = await media_library_service.create_from_file(file_record=record,
        source="generated_video_jimeng", project_id=data.get("project_id"), episode_id=data.get("episode_id"),
        source_task_id=task.task_id, source_entity_type=data.get("entity_type"),
        source_entity_id=data.get("entity_id"), title=data["prompt"][:80], metadata={"model": MODEL_KEY})
    if not library:
        raise JimengError("即梦成片尚未写入素材库，稍后继续保存原任务。")
    return {"videos": [{"file_id": file_id, "url": url, "filename": filename, "model": MODEL_KEY,
                         "execution_model": EXECUTION_MODEL, **metadata}], "images": []}


async def attach_generated_result(db, entity_id, episode_id, task_id, file_id, url, duration_ms):
    """Bind once in the segment lock domain; delayed recovery never reselects a take."""
    async with db.acquire() as conn:
        async with conn.transaction():
            segment = await conn.fetchrow(
                "SELECT segment_id,episode_id FROM video_segments WHERE segment_id=$1 FOR UPDATE", entity_id)
            if not segment or (episode_id and segment["episode_id"] != episode_id):
                raise JimengError("成片目标分集已变化，需要人工核查。")
            file = await conn.fetchrow("""
                SELECT file_id,is_selected,metadata->>'jimeng_attached' AS attached FROM files
                WHERE file_id=$1 AND entity_type='video_segment' AND entity_id=$2
                  AND file_role='video' AND is_deleted=FALSE FOR UPDATE
            """, file_id, entity_id)
            if not file:
                raise JimengError("即梦成片尚未绑定镜头。")
            if file["attached"] == "true":
                return bool(file["is_selected"])
            newest = await conn.fetchval("""
                SELECT task_id FROM tasks
                WHERE task_data->>'entity_type'='video_segment' AND task_data->>'entity_id'=$1
                  AND status NOT IN ('failed','cancelled','timeout')
                ORDER BY created_at DESC,task_id DESC LIMIT 1
            """, entity_id)
            selected = newest == task_id
            if selected:
                await conn.execute("""
                    UPDATE video_segments SET video_url=$2,thumbnail_url=NULL,model=$3,duration_ms=$4,
                        task_id=$5,status='completed' WHERE segment_id=$1
                """, entity_id, url, MODEL_KEY, duration_ms, task_id)
                await conn.execute("""
                    UPDATE files SET is_selected=FALSE WHERE entity_type='video_segment'
                      AND entity_id=$1 AND file_role='video' AND is_deleted=FALSE
                """, entity_id)
            await conn.execute("""
                UPDATE files SET is_selected=$2,metadata=COALESCE(metadata,'{}'::jsonb)
                    || '{"jimeng_attached":true}'::jsonb WHERE file_id=$1
            """, file_id, selected)
            return selected
