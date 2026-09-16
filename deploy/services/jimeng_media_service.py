"""Read authorized original files; never send thumbnails or arbitrary URLs to CLI."""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from services.generation_access_service import generation_source_references, require_generation_request_access
from services.jimeng_contract import JimengError, normalize_jimeng_options
from services.media_reference_service import resolve_media_file_record
from services.provider_media_input_service import _read_local_record, _validated_image_payload, ProviderMediaInputError

LIMITS = {"image": 20 * 1024**2, "audio": 20 * 1024**2, "video": 50 * 1024**2}


def probe_media(path: Path, kind: str) -> dict:
    """Restricted local-file probing: no playlists, remote protocols or fallback duration."""
    try:
        result = subprocess.run([
            os.getenv("FFPROBE_BIN", "ffprobe"), "-v", "error", "-protocol_whitelist", "file",
            "-format_whitelist", "mov,mp3,wav,aac,flac,ogg", "-show_entries",
            "format=duration:stream=codec_type,codec_name,width,height,duration,avg_frame_rate",
            "-of", "json", str(path),
        ], capture_output=True, timeout=15, check=True)
        info = json.loads(result.stdout)
        streams = [s for s in info.get("streams", []) if s.get("codec_type") == kind]
        if not streams:
            raise ValueError("Missing expected stream")
        duration = max(float(s["duration"]) for s in [info.get("format", {}), *streams]
                       if s.get("duration") not in (None, "N/A"))
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError("Invalid duration")
        return {"duration_seconds": duration, "streams": streams}
    except (OSError, subprocess.SubprocessError, ValueError, KeyError) as exc:
        raise JimengError("无法校验素材的真实格式或时长，请重新上传可播放的原文件。") from exc


async def inspect_inputs(data: dict, user_id: str, *, file_dao: Any, directory: Path) -> list[dict]:
    normalized = normalize_jimeng_options(data)
    request = SimpleNamespace(**normalized)
    await require_generation_request_access(request, user_id, generation_source_references(request), file_dao=file_dao)
    verified, durations = [], {"video": 0.0, "audio": 0.0}
    for index, item in enumerate(normalized["media_inputs"]):
        kind = item["kind"]
        reference = str(item.get("file_id") or item.get("url") or "")
        record = await resolve_media_file_record(reference, file_dao)
        if not record or not record.get("file_id"):
            raise JimengError("即梦只接受有访问权限的已上传原素材，请先将外链素材上传到项目。")
        # Use only the registered original path, never any thumbnail URL/path.
        try:
            content = await asyncio.to_thread(_read_local_record, record, max_bytes=LIMITS[kind])
        except ProviderMediaInputError as exc:
            raise JimengError("参考原文件不可用，请重新上传或选择有访问权限的原素材。") from exc
        suffix = Path(str(record.get("file_name") or record.get("file_path") or "")).suffix.lower()
        allowed = {"image": {".jpg", ".jpeg", ".png", ".webp"},
                   "video": {".mp4", ".mov"}, "audio": {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"}}
        if suffix not in allowed[kind]:
            raise JimengError("参考素材格式不受即梦通道支持，请上传常见图片、MP4 或音频原文件。")
        target = directory / f"reference-{index}{suffix}"
        if target.is_symlink() or not target.resolve().is_relative_to(directory.resolve()):
            raise JimengError("参考素材临时文件校验失败。")
        target.write_bytes(content)
        os.chmod(target, 0o600)
        entry = {"index": index, "kind": kind, "file_id": str(record["file_id"]),
                 "sha256": hashlib.sha256(content).hexdigest(), "size": len(content), "path": str(target)}
        if kind == "image":
            # This validation has no optimization threshold: original bytes stay exact.
            try:
                await asyncio.to_thread(_validated_image_payload, content)
            except ProviderMediaInputError as exc:
                raise JimengError("参考图片格式无法识别，请重新上传可打开的原图。") from exc
        else:
            probe = await asyncio.to_thread(probe_media, target, kind)
            duration = probe["duration_seconds"]
            if duration < 2 or duration > 15:
                raise JimengError(f"参考{'视频' if kind == 'video' else '音频'} {index + 1} 为 {duration:.3f} 秒，需为 2–15 秒；请手动裁剪参考副本。")
            durations[kind] += duration
            entry["duration_seconds"] = duration
        verified.append(entry)
    if any(value > 15 for value in durations.values()):
        raise JimengError("参考视频及参考音频各自的总时长不能超过 15 秒；不会自动丢弃或裁剪台词。")
    return verified


def trace_inputs(inputs: list[dict]) -> list[dict]:
    """Public-safe trace: the CLI's private input paths are not task metadata."""
    return [{k: v for k, v in item.items() if k != "path"} for item in inputs]
