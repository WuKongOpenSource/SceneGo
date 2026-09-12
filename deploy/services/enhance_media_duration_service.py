"""Read the selected local media clock without loading or modifying its bytes."""
import asyncio
import json
import subprocess
from functools import lru_cache
from pathlib import Path
from services.local_file_access_service import resolve_allowed_media_file

DEPLOY_ROOT = Path(__file__).resolve().parents[1]


@lru_cache(maxsize=256)
def _probe(path, size, modified_ns):
    result = subprocess.run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe',
                             '-format_whitelist', 'mov,matroska,webm,avi,mpeg,mpegts,asf',
                             '-show_entries', 'format=duration', '-of', 'json', path],
                            capture_output=True, check=True, timeout=10)
    duration = float(json.loads(result.stdout)['format']['duration'])
    if not .1 <= duration <= 3600:
        raise ValueError('Selected video duration is invalid')
    return round(duration * 1000)


async def selected_video_duration(record):
    path = resolve_allowed_media_file(record.get('file_path'), deploy_root=DEPLOY_ROOT)
    if path is None:
        raise ValueError('选中的视频文件缺失或不在媒体存储内，请重新保存素材')
    try:
        stat = path.stat()
        return await asyncio.to_thread(_probe, str(path), stat.st_size, stat.st_mtime_ns)
    except (OSError, subprocess.SubprocessError, ValueError, KeyError) as exc:
        raise ValueError('无法读取选中视频的实际时长，已停止导出，请检查素材') from exc
