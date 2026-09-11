"""Backend audio mixing for storyboard reference_audio.

Combines dialogue / narration / sfx tracks via ffmpeg ``amix``, caching results
by SHA-256 hash of (urls + gains) on ``storyboard_items.mixed_audio_*`` columns.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import shutil
import tempfile
from dataclasses import dataclass
from typing import List, Optional, Tuple

import aiohttp

from dao_storyboard import StoryboardDAO
from file_service import save_generated_file_to_db
from services.remote_content_service import configured_download_limit, write_aiohttp_response_limited
from utils.net_guard import assert_public_http_url, safe_storage_path

logger = logging.getLogger(__name__)




_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@dataclass(frozen=True)
class MixInput:
    dialogue_url: Optional[str]
    narration_url: Optional[str]
    sfx_url: Optional[str]
    dialogue_gain_db: float = 0.0
    narration_gain_db: float = -3.0
    sfx_gain_db: float = -8.0


@dataclass
class MixResult:
    success: bool
    mixed_audio_url: str
    cached: bool
    duration_ms: int


def compute_mix_hash(inp: MixInput) -> str:
    """SHA-256 of canonical URL/gain input, used only as a stable cache key."""
    parts = [
        inp.dialogue_url or "",
        inp.narration_url or "",
        inp.sfx_url or "",
        f"{inp.dialogue_gain_db:.2f}",
        f"{inp.narration_gain_db:.2f}",
        f"{inp.sfx_gain_db:.2f}",
    ]
    payload = "|".join(parts).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _storage_url_to_disk(url: str) -> str:







    return safe_storage_path(url, _PROJECT_ROOT)


async def _download(url: str, dest: str) -> None:
    """Download a remote URL or copy a local ``/storage/...`` path into ``dest``."""
    if url.startswith("/"):
        local = _storage_url_to_disk(url)
        shutil.copy2(local, dest)
        return

    assert_public_http_url(url)
    async with aiohttp.ClientSession() as sess:
        async with sess.get(
            url,
            timeout=aiohttp.ClientTimeout(total=30),
            allow_redirects=False,
        ) as resp:
            if 300 <= resp.status < 400:
                raise RuntimeError("Remote audio redirect was refused")
            resp.raise_for_status()
            await write_aiohttp_response_limited(
                resp,
                dest,
                max_bytes=configured_download_limit(
                    "MAX_REMOTE_AUDIO_DOWNLOAD_BYTES",
                    100 * 1024 * 1024,
                ),
            )


async def _run_ffmpeg_mix(
    inputs: List[Tuple[str, float]],
    output_path: str,
) -> str:
    """Invoke ffmpeg ``amix``; raise ``RuntimeError`` on failure. Returns ``output_path``."""
    if not inputs:
        raise ValueError("ffmpeg mix requires at least one input")

    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found on PATH")

    cmd: List[str] = ["ffmpeg", "-y", "-loglevel", "error"]
    for path, _gain in inputs:
        cmd.extend(["-i", path])

    if len(inputs) == 1:
        cmd.extend(["-codec:a", "libmp3lame", "-b:a", "192k", output_path])
    else:
        filter_chunks: List[str] = []
        labels: List[str] = []
        for i, (_, gain) in enumerate(inputs):
            label = f"[a{i}]"
            filter_chunks.append(f"[{i}:a]volume={gain}dB{label}")
            labels.append(label)
        filter_chunks.append(
            f"{''.join(labels)}amix=inputs={len(inputs)}:duration=longest:dropout_transition=0[mix]"
        )
        cmd.extend([
            "-filter_complex", ";".join(filter_chunks),
            "-map", "[mix]",
            "-codec:a", "libmp3lame", "-b:a", "192k",
            output_path,
        ])

    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed (rc={proc.returncode}): {stderr.decode(errors='replace')[:500]}"
        )
    return output_path


async def _probe_duration_ms(path: str) -> int:
    """Probe duration via ffprobe; return 0 when unavailable so caller stays robust."""
    if shutil.which("ffprobe") is None:
        return 0
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "json", path,
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        if proc.returncode != 0:
            return 0
        data = json.loads(stdout.decode("utf-8", errors="replace") or "{}")
        dur = float((data.get("format") or {}).get("duration") or 0.0)
        return int(dur * 1000)
    except Exception as e:
        logger.warning(f"[mix-audio] ffprobe duration failed: {e}")
        return 0


async def mix_storyboard_audio(item_id: str, inp: MixInput, user_id: str) -> MixResult:
    """Mix dialogue/narration/sfx into one file. Cache by hash on storyboard_items row."""
    if not (inp.dialogue_url or inp.narration_url or inp.sfx_url):
        raise ValueError("mix_storyboard_audio requires at least one non-None url")

    target_hash = compute_mix_hash(inp)

    row = await StoryboardDAO.get_by_id(item_id)
    if not row:
        raise LookupError(f"storyboard item not found: {item_id}")

    if row.get("mixed_audio_hash") == target_hash and row.get("mixed_audio_url"):
        logger.info(f"[mix-audio] cache hit for {item_id} hash={target_hash[:8]}")
        return MixResult(
            success=True,
            mixed_audio_url=row["mixed_audio_url"],
            cached=True,
            duration_ms=int(row.get("audio_duration_ms") or 0),
        )

    with tempfile.TemporaryDirectory(prefix="mix_audio_") as tmpdir:
        track_specs = [
            (inp.dialogue_url, inp.dialogue_gain_db),
            (inp.narration_url, inp.narration_gain_db),
            (inp.sfx_url, inp.sfx_gain_db),
        ]
        local_inputs: List[Tuple[str, float]] = []
        for i, (url, gain) in enumerate(track_specs):
            if not url:
                continue
            local_path = os.path.join(tmpdir, f"in_{i}.mp3")
            await _download(url, local_path)
            local_inputs.append((local_path, gain))

        output_path = os.path.join(tmpdir, "mixed.mp3")
        await _run_ffmpeg_mix(local_inputs, output_path)

        duration_ms = await _probe_duration_ms(output_path)
        with open(output_path, "rb") as f:
            content = f.read()

        # NOTE: adapted to actual file_service.save_generated_file_to_db signature
        # (content=bytes, file_type='audio', user_id, source, file_role, original_ext).
        saved = await save_generated_file_to_db(
            content=content,
            file_type="audio",
            user_id=user_id,
            source="mix_audio",
            entity_type="storyboard_item",
            entity_id=item_id,
            file_role="mixed_audio",
            original_ext=".mp3",
            episode_id=row.get("episode_id"),
        )
        mixed_url = saved["file_url"]

        try:
            import media_library_service
            await media_library_service.create_from_file(
                file_record=saved, source='mixed_audio',
                episode_id=row.get("episode_id"),
                source_entity_type='storyboard_item',
                source_entity_id=item_id,
                title=f"mix {item_id}"[:80],
            )
        except Exception as _e:
            logger.warning(f"media_library 同步失败 (audio_mix): {_e}")

    await StoryboardDAO.update(
        item_id,
        mixed_audio_url=mixed_url,
        mixed_audio_hash=target_hash,

        audio_duration_ms=duration_ms,
    )

    logger.info(
        f"[mix-audio] generated for {item_id} hash={target_hash[:8]} url={mixed_url}"
    )
    return MixResult(
        success=True,
        mixed_audio_url=mixed_url,
        cached=False,
        duration_ms=duration_ms,
    )
