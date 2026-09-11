"""Episode final-video composition service."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
import shutil
import tempfile
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from dao.creative.episode_compose import EpisodeComposeDAO

logger = logging.getLogger(__name__)

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_STORAGE = os.path.join(_BASE, "persistent_storage")
_SUBTITLE_FONTS_DIR = os.environ.get(
    "OSTORY_SUBTITLE_FONTS_DIR",
    "/usr/share/fonts/opentype/noto",
)
_SUBTITLE_FONT_FAMILY = os.environ.get("OSTORY_SUBTITLE_FONT_FAMILY", "Noto Sans CJK SC")
_DEFAULT_OUTPUT_SIZE = (1920, 1080)
_MAX_SUBTITLE_CUES = 500
_MAX_SUBTITLE_TEXT = 500
_MAX_TIMELINE_MS = 24 * 60 * 60 * 1000
_ASPECT_PRESETS: List[Tuple[str, float, Tuple[int, int]]] = [
    ("9:16", 9 / 16, (1080, 1920)),
    ("3:4", 3 / 4, (1080, 1440)),
    ("1:1", 1.0, (1080, 1080)),
    ("4:3", 4 / 3, (1440, 1080)),
    ("16:9", 16 / 9, _DEFAULT_OUTPUT_SIZE),
]

# episode_id -> {status: running|done|failed, total, done, url, error}
_jobs: Dict[str, Dict[str, Any]] = {}


def _ensure_media_tools() -> None:
    missing = [tool for tool in ("ffmpeg", "ffprobe") if not shutil.which(tool)]
    if missing:
        raise RuntimeError(f"服务器缺少媒体合成工具: {', '.join(missing)}，请安装 ffmpeg 后重启服务")


def _local(file_url: Optional[str]) -> Optional[str]:
    if not file_url:
        return None
    url = file_url.split("?", 1)[0]
    if url.startswith("/storage"):
        url = url[len("/storage") :]
    return os.path.join(_STORAGE, url.lstrip("/"))


def _audio_urls_from_row(row: Dict[str, Any]) -> List[str]:
    urls: List[str] = []
    seen: set[str] = set()
    for key in ("audio_url", "dialogue_audio_url", "narration_audio_url", "sfx_audio_url"):
        value = row.get(key)
        if not value:
            continue
        url = str(value)
        if url in seen:
            continue
        seen.add(url)
        urls.append(url)
    return urls


def _ordered_audio_segments_from_row(row: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = row.get("audio_segments")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError):
            raw = []
    if not isinstance(raw, list):
        return []

    segments: List[Dict[str, Any]] = []
    for index, value in enumerate(raw):
        if not isinstance(value, dict):
            continue
        kind = value.get("kind")
        if kind not in {"speech", "silence"}:
            continue
        try:
            sequence_index = int(value.get("sequenceIndex", value.get("sequence_index", index)))
        except (TypeError, ValueError):
            sequence_index = index
        try:
            duration_ms = max(
                0,
                int(float(value.get("durationMs", value.get("duration_ms", 0)) or 0)),
            )
        except (TypeError, ValueError):
            duration_ms = 0
        audio_url = value.get("audioUrl", value.get("audio_url"))
        segments.append(
            {
                "segment_id": str(value.get("segmentId", value.get("segment_id", f"segment-{index + 1}"))),
                "kind": kind,
                "sequence_index": sequence_index,
                "audio_url": str(audio_url) if audio_url else None,
                "duration_ms": duration_ms,
            }
        )
    return sorted(segments, key=lambda segment: segment["sequence_index"])


def _audio_ms_from_segments(segments: List[Dict[str, Any]]) -> int:
    return sum(max(0, int(segment.get("duration_ms") or 0)) for segment in segments)


def _finite_number(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else fallback
    except (TypeError, ValueError):
        return fallback


def _normalize_subtitle_style(value: Any) -> Dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    position = str(raw.get("position") or "bottom")
    if position not in {"top", "center", "bottom"}:
        position = "bottom"

    def color(name: str, fallback: str) -> str:
        candidate = str(raw.get(name) or "").strip().upper()
        if len(candidate) == 7 and candidate.startswith("#"):
            try:
                int(candidate[1:], 16)
                return candidate
            except ValueError:
                pass
        return fallback

    return {
        "font_size": max(16, min(int(_finite_number(raw.get("font_size"), 42)), 96)),
        "text_color": color("text_color", "#FFFFFF"),
        "background_color": color("background_color", "#000000"),
        "background_opacity": max(
            0.0,
            min(_finite_number(raw.get("background_opacity"), 0.55), 1.0),
        ),
        "position": position,
        **{
            field: max(0.0, min(_finite_number(raw[field]), 100.0))
            for field in ("position_x", "position_y")
            if isinstance(raw.get(field), (int, float))
            and not isinstance(raw[field], bool)
            and math.isfinite(raw[field])
        },
    }


def _normalize_editor_subtitles(value: Any, video_duration_ms: int) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []
    maximum_ms = max(0, min(int(video_duration_ms), _MAX_TIMELINE_MS))
    normalized: List[Dict[str, Any]] = []
    for raw in value[:_MAX_SUBTITLE_CUES]:
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("text") or "").replace("\x00", "").strip()
        if not text:
            continue
        start_ms = max(0, min(int(_finite_number(raw.get("start_ms"))), maximum_ms))
        if start_ms >= maximum_ms:
            continue
        duration_ms = max(200, min(int(_finite_number(raw.get("duration_ms"), 200)), maximum_ms))
        duration_ms = min(duration_ms, maximum_ms - start_ms)
        if duration_ms < 200:
            continue
        normalized.append(
            {
                "cue_id": str(raw.get("cue_id") or "")[:200],
                "text": text[:_MAX_SUBTITLE_TEXT],
                "start_ms": start_ms,
                "duration_ms": duration_ms,
            }
        )
    return sorted(normalized, key=lambda cue: (cue["start_ms"], cue["cue_id"]))


def _ass_timestamp(milliseconds: int) -> str:
    centiseconds = max(0, milliseconds) // 10
    hours, remainder = divmod(centiseconds, 360000)
    minutes, remainder = divmod(remainder, 6000)
    seconds, fraction = divmod(remainder, 100)
    return f"{hours}:{minutes:02d}:{seconds:02d}.{fraction:02d}"


def _ass_color(hex_color: str, opacity: float = 1.0) -> str:
    red = hex_color[1:3]
    green = hex_color[3:5]
    blue = hex_color[5:7]
    alpha = round((1.0 - max(0.0, min(opacity, 1.0))) * 255)
    return f"&H{alpha:02X}{blue}{green}{red}"


def _ass_text(value: str) -> str:
    return (
        value.replace("\\", r"\\")
        .replace("{", "（")
        .replace("}", "）")
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .replace("\n", r"\N")
    )


def _ffmpeg_filter_path(path: str) -> str:
    return path.replace("\\", "/").replace(":", r"\:").replace("'", r"\'")


async def _burn_editor_subtitles(
    raw_cues: Any,
    raw_style: Any,
    video_path: str,
    video_duration: float,
    tmp: str,
    output_width: int,
    output_height: int,
) -> int:
    cues = _normalize_editor_subtitles(raw_cues, max(0, int(video_duration * 1000)))
    if not cues:
        return 0
    style = _normalize_subtitle_style(raw_style)
    alignment = {"top": 8, "center": 5, "bottom": 2}[style["position"]]
    margin_v = max(24, round(output_height * 0.06))
    background = _ass_color(style["background_color"], style["background_opacity"])
    outline_size = 6 if style["background_opacity"] > 0 else 2
    font_family = "".join(
        character for character in _SUBTITLE_FONT_FAMILY[:100]
        if character not in {",", "\r", "\n"}
    ).strip() or "Noto Sans CJK SC"
    ass_path = os.path.join(tmp, "editor_subtitles.ass")
    ass_lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {output_width}",
        f"PlayResY: {output_height}",
        "ScaledBorderAndShadow: yes",
        "WrapStyle: 0",
        "",
        "[V4+ Styles]",
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
        (
            f"Style: Default,{font_family},{style['font_size']},"
            f"{_ass_color(style['text_color'])},{_ass_color(style['text_color'])},"
            f"{background},{background},0,0,0,0,100,100,0,0,3,{outline_size},0,"
            f"{alignment},48,48,{margin_v},1"
        ),
        "",
        "[Events]",
        "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ]
    for cue in cues:
        placement = ""
        if "position_x" in style or "position_y" in style:
            x = output_width * style.get("position_x", 50) / 100
            default_y = {"top": 6, "center": 50, "bottom": 94}[style["position"]]
            y = output_height * style.get("position_y", default_y) / 100
            placement = rf"{{\an{alignment}\pos({x:.3f},{y:.3f})}}"
        ass_lines.append(
            "Dialogue: 0,"
            f"{_ass_timestamp(cue['start_ms'])},"
            f"{_ass_timestamp(cue['start_ms'] + cue['duration_ms'])},"
            f"Default,,0,0,0,,{placement}{_ass_text(cue['text'])}"
        )
    with open(ass_path, "w", encoding="utf-8-sig", newline="\n") as subtitle_file:
        subtitle_file.write("\n".join(ass_lines) + "\n")

    subtitled_path = os.path.join(tmp, "final_with_subtitles.mp4")
    ass_filter = f"ass=filename='{_ffmpeg_filter_path(ass_path)}'"
    if os.path.isdir(_SUBTITLE_FONTS_DIR):
        ass_filter += f":fontsdir='{_ffmpeg_filter_path(_SUBTITLE_FONTS_DIR)}'"
    rc, _out, err = await _run(
        [
            "ffmpeg",
            "-nostdin",
            "-y",
            "-loglevel",
            "error",
            "-i",
            video_path,
            "-vf",
            ass_filter,
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-c:a",
            "copy",
            "-movflags",
            "+faststart",
            "-t",
            f"{video_duration:.3f}",
            subtitled_path,
        ]
    )
    if rc != 0:
        raise RuntimeError(f"Subtitle burn-in failed: {err[:200]}")
    os.replace(subtitled_path, video_path)
    return len(cues)


def _global_audio_timeline(
    row: Dict[str, Any],
    source_duration_ms: int,
    episode_duration_ms: int,
) -> Dict[str, Any]:
    params = row.get("generation_params") or {}
    if isinstance(params, str):
        try:
            params = json.loads(params)
        except (TypeError, ValueError):
            params = {}
    timeline = params.get("timeline") if isinstance(params, dict) else {}
    if not isinstance(timeline, dict):
        timeline = {}

    source_duration_ms = max(100, int(source_duration_ms or episode_duration_ms or 100))
    source_offset_ms = max(
        0,
        min(
            int(_finite_number(timeline.get("sourceOffsetMs", timeline.get("source_offset_ms")))),
            source_duration_ms - 100,
        ),
    )
    maximum_duration_ms = max(100, source_duration_ms - source_offset_ms)
    default_duration_ms = min(maximum_duration_ms, max(100, episode_duration_ms))
    duration_ms = max(
        100,
        min(
            int(_finite_number(
                timeline.get("durationMs", timeline.get("duration_ms")),
                default_duration_ms,
            )),
            maximum_duration_ms,
        ),
    )
    start_ms = max(
        0,
        min(
            int(_finite_number(timeline.get("startMs", timeline.get("start_ms")))),
            max(0, episode_duration_ms - duration_ms),
        ),
    )
    is_bgm = row.get("track_type") == "bgm"
    fade_in_ms = (
        max(
            0,
            min(
                int(_finite_number(timeline.get("fadeInMs", timeline.get("fade_in_ms")))),
                duration_ms,
            ),
        )
        if is_bgm
        else 0
    )
    fade_out_ms = (
        max(
            0,
            min(
                int(_finite_number(timeline.get("fadeOutMs", timeline.get("fade_out_ms")))),
                duration_ms - fade_in_ms,
            ),
        )
        if is_bgm
        else 0
    )
    default_volume = 0.35 if is_bgm else 1.0
    volume = max(
        0.0,
        min(_finite_number(timeline.get("volume"), default_volume), 2.0),
    )
    return {
        "start_ms": start_ms,
        "source_offset_ms": source_offset_ms,
        "duration_ms": duration_ms,
        "fade_in_ms": fade_in_ms,
        "fade_out_ms": fade_out_ms,
        "volume": volume,
    }


async def _run(cmd: List[str]) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    return proc.returncode, out.decode("utf-8", "ignore"), err.decode("utf-8", "ignore")


async def _probe_dur(path: str) -> float:
    _rc, out, _err = await _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            path,
        ]
    )
    try:
        return float(out.strip())
    except Exception:
        return 0.0


async def _probe_has_audio(path: str) -> bool:
    _rc, out, _err = await _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
            path,
        ]
    )
    return "audio" in out.strip().lower()


async def _probe_video_size(path: str) -> Optional[Tuple[int, int]]:
    _rc, out, _err = await _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=s=x:p=0",
            path,
        ]
    )
    text = out.strip().splitlines()[0] if out.strip() else ""
    try:
        width_text, height_text = text.lower().split("x", 1)
        width = int(width_text)
        height = int(height_text)
        if width > 0 and height > 0:
            return width, height
    except Exception:
        return None
    return None


async def _mix_global_audio_tracks(
    episode_id: str,
    video_path: str,
    video_duration: float,
    tmp: str,
) -> None:
    rows = await EpisodeComposeDAO.list_audio_tracks(episode_id)
    prepared_tracks: List[Dict[str, Any]] = []
    episode_duration_ms = max(100, int(video_duration * 1000))
    for row in rows:
        audio_path = _local(row.get("audio_url"))
        if not audio_path or not os.path.isfile(audio_path):
            continue
        source_duration_ms = int(row.get("duration_ms") or 0)
        if source_duration_ms <= 0:
            source_duration_ms = int((await _probe_dur(audio_path)) * 1000)
        prepared_tracks.append(
            {
                **row,
                "_audio_path": audio_path,
                "_timeline": _global_audio_timeline(
                    row,
                    source_duration_ms,
                    episode_duration_ms,
                ),
            }
        )
    if not prepared_tracks:
        return

    input_args: List[str] = []
    filters = [
        "[0:a]aresample=48000,"
        "aformat=sample_fmts=fltp:sample_rates=48000:"
        "channel_layouts=stereo[base]"
    ]
    mix_labels = ["[base]"]
    for index, track in enumerate(prepared_tracks, start=1):
        input_args.extend(["-i", track["_audio_path"]])
        timeline = track["_timeline"]
        duration_seconds = timeline["duration_ms"] / 1000.0
        filter_steps = [
            f"[{index}:a]atrim=start={timeline['source_offset_ms'] / 1000.0:.3f}:"
            f"duration={duration_seconds:.3f}",
            "asetpts=PTS-STARTPTS",
        ]
        if timeline["fade_in_ms"] > 0:
            filter_steps.append(
                f"afade=t=in:st=0:d={timeline['fade_in_ms'] / 1000.0:.3f}"
            )
        if timeline["fade_out_ms"] > 0:
            filter_steps.append(
                f"afade=t=out:"
                f"st={max(0.0, duration_seconds - timeline['fade_out_ms'] / 1000.0):.3f}:"
                f"d={timeline['fade_out_ms'] / 1000.0:.3f}"
            )
        filter_steps.extend(
            [
                f"volume={timeline['volume']:.3f}",
                f"adelay=delays={timeline['start_ms']}:all=1",
                f"aformat=sample_fmts=fltp:sample_rates=48000:"
                f"channel_layouts=stereo[global{index}]",
            ]
        )
        filters.append(",".join(filter_steps))
        mix_labels.append(f"[global{index}]")

    filters.append(
        f"{''.join(mix_labels)}"
        f"amix=inputs={len(mix_labels)}:duration=first:dropout_transition=0:"
        "normalize=0[a]"
    )
    mixed_path = os.path.join(tmp, "final_with_global_audio.mp4")
    rc, _out, err = await _run(
        [
            "ffmpeg",
            "-nostdin",
            "-y",
            "-loglevel",
            "error",
            "-i",
            video_path,
            *input_args,
            "-filter_complex",
            ";".join(filters),
            "-map",
            "0:v",
            "-map",
            "[a]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-t",
            f"{video_duration:.3f}",
            mixed_path,
        ]
    )
    if rc != 0:
        raise RuntimeError(f"Global audio mix failed: {err[:200]}")
    os.replace(mixed_path, video_path)


def _even(value: int) -> int:
    return max(2, value if value % 2 == 0 else value - 1)


def _output_size_for_source(width: int, height: int) -> Tuple[int, int, str]:
    if width <= 0 or height <= 0:
        return (*_DEFAULT_OUTPUT_SIZE, "16:9")

    ratio = width / height
    for label, preset_ratio, (target_width, target_height) in _ASPECT_PRESETS:
        if abs(ratio - preset_ratio) <= 0.04:
            return target_width, target_height, label

    if ratio < 1:
        target_width = 1080
        return target_width, _even(round(target_width / ratio)), f"{width}:{height}"

    target_height = 1080
    target_width = min(_even(round(target_height * ratio)), 1920)
    return target_width, target_height, f"{width}:{height}"


def _choose_output_size(sizes: List[Tuple[int, int]]) -> Tuple[int, int, str]:
    if not sizes:
        return (*_DEFAULT_OUTPUT_SIZE, "16:9")

    buckets: Dict[Tuple[int, int, str], int] = {}
    for width, height in sizes:
        bucket = _output_size_for_source(width, height)
        buckets[bucket] = buckets.get(bucket, 0) + 1




    return max(buckets, key=lambda key: (buckets[key], -list(buckets).index(key)))


def _video_filter(output_width: int, output_height: int) -> str:
    return (
        f"scale={output_width}:{output_height}:force_original_aspect_ratio=decrease,"
        f"pad={output_width}:{output_height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30"
    )


async def _list_shot_takes(episode_id: str) -> List[Dict[str, Any]]:
    rows = await EpisodeComposeDAO.list_shot_take_rows(episode_id)
    shots: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []
    seen_segments: set[str] = set()

    for row in rows:
        segment_id = row["segment_id"]
        if segment_id in seen_segments:
            continue
        seen_segments.add(segment_id)

        item_id = row["item_id"]
        if item_id not in shots:
            audio_segments = _ordered_audio_segments_from_row(row)
            ordered_audio_urls = [
                segment["audio_url"]
                for segment in audio_segments
                if segment["kind"] == "speech" and segment.get("audio_url")
            ]
            audio_urls = ordered_audio_urls or _audio_urls_from_row(row)
            audio_ms = _audio_ms_from_segments(audio_segments) or row.get("audio_ms") or 0
            shots[item_id] = {
                "item_id": item_id,
                "sort_order": row["sort_order"],
                "scene": row.get("scene_heading") or "",
                "dialogue": row.get("dialogue") or "",
                "audio_url": audio_urls[0] if audio_urls else None,
                "audio_urls": audio_urls,
                "audio_segments": audio_segments,
                "sfx_audio_url": row.get("sfx_audio_url"),
                "audio_ms": audio_ms,
                "takes": [],
                "selected_segment_id": None,
            }
            order.append(item_id)

        created_at = row.get("created_at")
        take = {
                "segment_id": segment_id,
                "take_id": row.get("take_id"),
                "video_url": row.get("video_url"),
                "thumbnail_url": row.get("thumbnail_url"),
                "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else created_at,
                "is_selected": bool(row.get("is_selected")),
            }
        shots[item_id]["takes"].append(take)
        if take["is_selected"]:
            shots[item_id]["selected_segment_id"] = segment_id

    return [shots[item_id] for item_id in order]


async def get_takes(episode_id: str) -> List[Dict[str, Any]]:
    return await _list_shot_takes(episode_id)


def _normalize_editor_timeline(timeline: Optional[Any]) -> List[Dict[str, Any]]:
    if not isinstance(timeline, list):
        return []
    normalized: List[Dict[str, Any]] = []
    for index, raw in enumerate(timeline[:500]):
        if not isinstance(raw, dict):
            continue
        segment_id = str(raw.get("segment_id") or "").strip()
        if not segment_id:
            continue
        duration_ms = max(100, min(86_400_000, int(_finite_number(raw.get("duration_ms"), 100))))
        transition_after = str(raw.get("transition_after") or "cut").strip().lower()
        if transition_after not in {"cut", "fade", "black"}:
            transition_after = "cut"
        transition_duration_ms = (
            max(100, min(3_000, int(_finite_number(raw.get("transition_duration_ms"), 500))))
            if transition_after != "cut"
            else 0
        )
        normalized.append(
            {
                "clip_id": str(raw.get("clip_id") or f"{segment_id}-cut-{index + 1}"),
                "segment_id": segment_id,
                "start_ms": max(0, int(_finite_number(raw.get("start_ms")))),
                "duration_ms": duration_ms,
                "source_offset_ms": max(0, int(_finite_number(raw.get("source_offset_ms")))),
                "source_duration_ms": max(0, int(_finite_number(raw.get("source_duration_ms")))),
                "source_identity": str(raw.get("source_identity") or "").strip(),
                "transition_after": transition_after,
                "transition_duration_ms": transition_duration_ms,
                "_index": index,
            }
        )
    return sorted(normalized, key=lambda item: (item["start_ms"], item["_index"]))


async def _get_shots(
    episode_id: str,
    selections: Optional[Dict[str, str]] = None,
    timeline: Optional[Any] = None,
) -> List[Dict[str, Any]]:
    selected_segments = selections or {}
    shots = await _list_shot_takes(episode_id)
    edited_timeline = _normalize_editor_timeline(timeline)
    if edited_timeline:
        take_rows: Dict[str, Dict[str, Any]] = {}
        for shot in shots:
            for take in shot.get("takes") or []:
                take_rows[take["segment_id"]] = {
                    "video_url": take["video_url"],
                    "audio_url": shot.get("audio_url"),
                    "audio_urls": shot.get("audio_urls") or ([shot["audio_url"]] if shot.get("audio_url") else []),
                    "audio_segments": shot.get("audio_segments") or [],
                    "sfx_audio_url": shot.get("sfx_audio_url"),
                    "audio_ms": shot.get("audio_ms") or 0,
                }
        result: List[Dict[str, Any]] = []
        for item in edited_timeline:
            source = take_rows.get(item["segment_id"])
            if not source:
                raise RuntimeError(f"时间线片段 {item['clip_id']} 对应的视频源不存在，请刷新后重试")
            result.append(
                {
                    **source,
                    "clip_id": item["clip_id"],
                    "segment_id": item["segment_id"],
                    "duration_ms": item["duration_ms"],
                    "source_offset_ms": item["source_offset_ms"],
                    "source_duration_ms": item["source_duration_ms"],
                    "source_identity": item["source_identity"],
                    "transition_after": item["transition_after"],
                    "transition_duration_ms": item["transition_duration_ms"],
                }
            )
        return result

    result: List[Dict[str, Any]] = []
    for shot in shots:
        if not shot["takes"]:
            continue
        wanted_segment_id = selected_segments.get(shot["item_id"]) or shot.get("selected_segment_id")
        chosen = next(
            (take for take in shot["takes"] if take["segment_id"] == wanted_segment_id),
            shot["takes"][0],
        )
        result.append(
            {
                "video_url": chosen["video_url"],
                "audio_url": shot.get("audio_url"),
                "audio_urls": shot.get("audio_urls") or ([shot["audio_url"]] if shot.get("audio_url") else []),
                "audio_segments": shot.get("audio_segments") or [],
                "sfx_audio_url": shot.get("sfx_audio_url"),
                "audio_ms": shot.get("audio_ms") or 0,
            }
        )
    return result


def _file_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


async def _source_identity(video_path: str) -> str:
    return await asyncio.to_thread(_file_sha256, video_path)


async def preflight_timeline(episode_id: str, timeline: Optional[Any]) -> List[Dict[str, Any]]:
    """Resolve and validate every edited clip without mutating episode state."""
    normalized = _normalize_editor_timeline(timeline)
    if not normalized:
        raise RuntimeError("时间线上没有可合成的视频片段")
    shots = await _get_shots(episode_id, timeline=normalized)
    validated: List[Dict[str, Any]] = []
    tolerance_ms = 250
    for item, row in zip(normalized, shots):
        video_url = str(row.get("video_url") or "")
        video_path = _local(video_url)
        if not video_path or not os.path.isfile(video_path):
            raise RuntimeError(f"时间线片段 {item['clip_id']} 的源视频文件不存在，请重新生成或上传")
        actual_duration_ms = max(0, int(round((await _probe_dur(video_path)) * 1000)))
        if actual_duration_ms < 100:
            raise RuntimeError(f"时间线片段 {item['clip_id']} 的源视频无法读取")
        identity = await _source_identity(video_path)
        submitted_identity = item.get("source_identity") or ""
        if submitted_identity and submitted_identity != identity:
            raise RuntimeError(f"时间线片段 {item['clip_id']} 的源视频已变化，请刷新后重试")

        offset_ms = item["source_offset_ms"]
        duration_ms = item["duration_ms"]
        submitted_source_duration_ms = item.get("source_duration_ms") or 0
        represents_full_source = (
            offset_ms == 0
            and submitted_source_duration_ms > 0
            and abs(duration_ms - submitted_source_duration_ms) <= tolerance_ms
        )
        corrected = represents_full_source and abs(duration_ms - actual_duration_ms) > tolerance_ms
        if corrected:
            duration_ms = actual_duration_ms
        if offset_ms >= actual_duration_ms or offset_ms + duration_ms > actual_duration_ms + tolerance_ms:
            raise RuntimeError(
                f"时间线片段 {item['clip_id']} 超出源视频时长，请调整裁剪范围后重试"
            )
        duration_ms = min(duration_ms, actual_duration_ms - offset_ms)
        validated.append({
            "clip_id": item["clip_id"],
            "segment_id": item["segment_id"],
            "start_ms": item["start_ms"],
            "duration_ms": duration_ms,
            "source_offset_ms": offset_ms,
            "source_duration_ms": actual_duration_ms,
            "source_identity": identity,
            "duration_corrected": corrected,
            "transition_after": item["transition_after"],
            "transition_duration_ms": item["transition_duration_ms"],
        })
    return validated


def _audio_trim_filter(source_offset: float, target_duration: float) -> str:
    return (
        f"atrim=start={source_offset:.3f}:"
        f"end={source_offset + target_duration:.3f},"
        "asetpts=PTS-STARTPTS,apad[a]"
    )


def _video_transition_filter(
    base_filter: str,
    target_duration: float,
    fade_in_ms: int = 0,
    fade_out_ms: int = 0,
) -> str:
    filters = [base_filter]
    if fade_in_ms > 0:
        fade_in = min(fade_in_ms / 1000.0, max(0.1, target_duration / 2))
        filters.append(f"fade=t=in:st=0:d={fade_in:.3f}")
    if fade_out_ms > 0:
        fade_out = min(fade_out_ms / 1000.0, max(0.1, target_duration / 2))
        filters.append(f"fade=t=out:st={max(0.0, target_duration - fade_out):.3f}:d={fade_out:.3f}")
    return ",".join(filters)


async def _compose(
    episode_id: str,
    user_id: str,
    project_id: str,
    job: Dict[str, Any],
    selections: Optional[Dict[str, str]] = None,
    audio_mode: str = "reference_dubbing",
    timeline: Optional[Any] = None,
    subtitles: Optional[Any] = None,
    subtitle_style: Optional[Any] = None,
) -> None:
    _ensure_media_tools()
    shots = (
        await _get_shots(episode_id, selections, timeline)
        if timeline is not None
        else await _get_shots(episode_id, selections)
    )
    job["total"] = len(shots)
    if not shots:
        raise RuntimeError("No video segments available for episode composition")

    tmp = tempfile.mkdtemp(prefix=f"compose_{episode_id}_")
    try:
        prepared: List[Dict[str, Any]] = []
        probed_sizes: List[Tuple[int, int]] = []
        for row in shots:
            video_path = _local(row.get("video_url"))
            if not video_path or not os.path.isfile(video_path):
                raise RuntimeError(f"源视频文件不存在: {row.get('clip_id') or row.get('segment_id') or 'unknown'}")
            expected_identity = str(row.get("source_identity") or "")
            if expected_identity and expected_identity != await _source_identity(video_path):
                raise RuntimeError(f"源视频已变化: {row.get('clip_id') or row.get('segment_id') or 'unknown'}")
            size = await _probe_video_size(video_path)
            if size:
                probed_sizes.append(size)
            prepared.append({**row, "_video_path": video_path})

        output_width, output_height, output_aspect = _choose_output_size(probed_sizes)
        vf = _video_filter(output_width, output_height)
        job["output_width"] = output_width
        job["output_height"] = output_height
        job["output_aspect"] = output_aspect

        clips: List[str] = []
        idx = 0
        for row in prepared:
            video_path = row["_video_path"]
            idx += 1
            clip_path = os.path.join(tmp, f"clip_{idx:03d}.mp4")
            video_duration = await _probe_dur(video_path)
            source_offset = max(0.0, _finite_number(row.get("source_offset_ms")) / 1000.0)
            edited_duration_ms = int(_finite_number(row.get("duration_ms")))
            edited_duration = edited_duration_ms / 1000.0 if edited_duration_ms > 0 else None
            has_next_clip = idx < len(prepared)
            transition_after = str(row.get("transition_after") or "cut") if has_next_clip else "cut"
            transition_duration_ms = int(_finite_number(row.get("transition_duration_ms"), 500))
            previous_transition = str(prepared[idx - 2].get("transition_after") or "cut") if idx > 1 else "cut"
            previous_transition_duration_ms = (
                int(_finite_number(prepared[idx - 2].get("transition_duration_ms"), 500))
                if idx > 1
                else 0
            )

            def clip_video_filter(target_duration: float, *, pad_video: bool = False) -> str:
                base_filter = (
                    f"{vf},tpad=stop_mode=clone:stop_duration={target_duration}"
                    if pad_video
                    else vf
                )
                return _video_transition_filter(
                    base_filter,
                    target_duration,
                    fade_in_ms=previous_transition_duration_ms if previous_transition == "fade" else 0,
                    fade_out_ms=transition_duration_ms if transition_after == "fade" else 0,
                )

            expected_duration_ms = int(_finite_number(row.get("source_duration_ms")))
            actual_duration_ms = int(round(video_duration * 1000))
            if expected_duration_ms and abs(expected_duration_ms - actual_duration_ms) > 250:
                raise RuntimeError(f"源视频时长已变化: {row.get('clip_id') or row.get('segment_id') or 'unknown'}")
            if source_offset >= video_duration or (
                edited_duration is not None and source_offset + edited_duration > video_duration + 0.25
            ):
                raise RuntimeError(f"裁剪范围超出源视频: {row.get('clip_id') or row.get('segment_id') or 'unknown'}")
            video_has_audio = await _probe_has_audio(video_path)
            # A clip with its own sound does not depend on reference speech in
            # original-audio mode. Do not resolve or probe those unused files.
            read_reference_audio = audio_mode == "reference_dubbing" or not video_has_audio
            audio_segments = (row.get("audio_segments") or []) if read_reference_audio else []
            ordered_parts: List[Dict[str, Any]] = []
            for segment in audio_segments:
                duration_ms = max(0, int(segment.get("duration_ms") or 0))
                if segment.get("kind") == "silence":
                    if duration_ms > 0:
                        ordered_parts.append({"kind": "silence", "duration_ms": duration_ms})
                    continue
                audio_path = _local(segment.get("audio_url"))
                if audio_path and os.path.isfile(audio_path):
                    if duration_ms <= 0:
                        duration_ms = int((await _probe_dur(audio_path)) * 1000)
                    ordered_parts.append(
                        {
                            "kind": "speech",
                            "path": audio_path,
                            "duration_ms": duration_ms,
                        }
                    )
                elif duration_ms > 0:

                    ordered_parts.append({"kind": "silence", "duration_ms": duration_ms})

            audio_urls = (
                row.get("audio_urls") or ([row.get("audio_url")] if row.get("audio_url") else [])
            ) if read_reference_audio else []
            audio_paths: List[str] = []
            seen_audio_paths: set[str] = set()
            if not ordered_parts:
                for audio_url in audio_urls:
                    audio_path = _local(audio_url)
                    if not audio_path or not os.path.isfile(audio_path) or audio_path in seen_audio_paths:
                        continue
                    seen_audio_paths.add(audio_path)
                    audio_paths.append(audio_path)
            audio_ms = sum(int(part.get("duration_ms") or 0) for part in ordered_parts)
            if not ordered_parts and read_reference_audio:
                audio_ms = int(row.get("audio_ms") or 0)
            if audio_paths and audio_ms <= 0:
                durations = [await _probe_dur(audio_path) for audio_path in audio_paths]
                audio_ms = int(max(durations or [0.0]) * 1000)
            sfx_path = _local(row.get("sfx_audio_url")) if ordered_parts else None
            if sfx_path and not os.path.isfile(sfx_path):
                sfx_path = None
            use_reference_audio = bool(
                (ordered_parts or audio_paths)
                and audio_ms > 0
                and read_reference_audio
            )

            common = [
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-pix_fmt",
                "yuv420p",
                "-r",
                "30",
                "-video_track_timescale",
                "30000",
                "-c:a",
                "aac",
                "-ar",
                "48000",
                "-ac",
                "2",
                clip_path,
            ]
            if use_reference_audio:
                target_duration = edited_duration or max(video_duration, audio_ms / 1000.0)
                if ordered_parts:
                    audio_inputs: List[str] = []
                    sequence_filters: List[str] = []
                    sequence_labels: List[str] = []
                    input_index = 1
                    for sequence_index, part in enumerate(ordered_parts):
                        label = f"seq{sequence_index}"
                        sequence_labels.append(f"[{label}]")
                        if part["kind"] == "speech":
                            audio_inputs.extend(["-i", part["path"]])
                            sequence_filters.append(
                                f"[{input_index}:a]aresample=48000,"
                                "aformat=sample_fmts=fltp:sample_rates=48000:"
                                f"channel_layouts=stereo[{label}]"
                            )
                            input_index += 1
                        else:
                            duration_seconds = max(0.1, part["duration_ms"] / 1000.0)
                            sequence_filters.append(
                                f"anullsrc=r=48000:cl=stereo:d={duration_seconds:.3f}[{label}]"
                            )

                    if len(sequence_labels) == 1:
                        sequence_filters.append(f"{sequence_labels[0]}anull[voice]")
                    else:
                        sequence_filters.append(
                            f"{''.join(sequence_labels)}"
                            f"concat=n={len(sequence_labels)}:v=0:a=1[voice]"
                        )

                    if sfx_path:
                        audio_inputs.extend(["-i", sfx_path])
                        sfx_duration = await _probe_dur(sfx_path)
                        target_duration = max(target_duration, sfx_duration)
                        sequence_filters.append(
                            f"[{input_index}:a]aresample=48000,"
                            "aformat=sample_fmts=fltp:sample_rates=48000:"
                            "channel_layouts=stereo[sfx]"
                        )
                        sequence_filters.append(
                            "[voice][sfx]amix=inputs=2:duration=longest:"
                            "dropout_transition=0[mixed]"
                        )
                    else:
                        sequence_filters.append("[voice]anull[mixed]")
                    sequence_filters.append(
                        f"[mixed]{_audio_trim_filter(source_offset, target_duration)}"
                    )
                    audio_filter = ";".join(sequence_filters)
                else:
                    audio_inputs = []
                    for audio_path in audio_paths:
                        audio_inputs.extend(["-i", audio_path])
                    if len(audio_paths) == 1:
                        audio_filter = (
                            f"[1:a]anull[mixed];"
                            f"[mixed]{_audio_trim_filter(source_offset, target_duration)}"
                        )
                    else:
                        padded = "".join(f"[{i}:a]apad[a{i}];" for i in range(1, len(audio_paths) + 1))
                        mix_inputs = "".join(f"[a{i}]" for i in range(1, len(audio_paths) + 1))
                        audio_filter = (
                            f"{padded}{mix_inputs}"
                            f"amix=inputs={len(audio_paths)}:duration=longest:dropout_transition=0[mixed];"
                            f"[mixed]{_audio_trim_filter(source_offset, target_duration)}"
                        )
                cmd = [
                    "ffmpeg",
                    "-nostdin",
                    "-y",
                    "-loglevel",
                    "error",
                    *( ["-ss", f"{source_offset:.3f}"] if source_offset > 0 else [] ),
                    "-i",
                    video_path,
                    *audio_inputs,
                    "-filter_complex",
                    f"[0:v]{clip_video_filter(target_duration, pad_video=True)}[v];{audio_filter}",
                    "-map",
                    "[v]",
                    "-map",
                    "[a]",
                    "-t",
                    str(target_duration),
                    *common,
                ]
            else:
                target_duration = edited_duration or video_duration or 5
                if video_has_audio:
                    cmd = [
                        "ffmpeg",
                        "-nostdin",
                        "-y",
                        "-loglevel",
                        "error",
                        *( ["-ss", f"{source_offset:.3f}"] if source_offset > 0 else [] ),
                        "-i",
                        video_path,
                        "-filter_complex",
                        f"[0:v]{clip_video_filter(target_duration)}[v];[0:a]apad[a]",
                        "-map",
                        "[v]",
                        "-map",
                        "[a]",
                        "-t",
                        str(target_duration),
                        *common,
                    ]
                else:
                    cmd = [
                        "ffmpeg",
                        "-nostdin",
                        "-y",
                        "-loglevel",
                        "error",
                        *( ["-ss", f"{source_offset:.3f}"] if source_offset > 0 else [] ),
                        "-i",
                        video_path,
                        "-f",
                        "lavfi",
                        "-i",
                        "anullsrc=r=48000:cl=stereo",
                        "-filter_complex",
                        f"[0:v]{clip_video_filter(target_duration)}[v]",
                        "-map",
                        "[v]",
                        "-map",
                        "1:a",
                        "-t",
                        str(target_duration),
                        "-shortest",
                        *common,
                    ]

            rc, _out, err = await _run(cmd)
            if rc != 0:
                raise RuntimeError(f"第 {idx} 个视频片段编码失败: {err[:200]}")
            clips.append(clip_path)
            if transition_after == "black":
                black_duration = max(0.1, min(3.0, transition_duration_ms / 1000.0))
                black_path = os.path.join(tmp, f"transition_{idx:03d}_black.mp4")
                rc, _out, err = await _run(
                    [
                        "ffmpeg",
                        "-nostdin",
                        "-y",
                        "-loglevel",
                        "error",
                        "-f",
                        "lavfi",
                        "-i",
                        f"color=c=black:s={output_width}x{output_height}:r=30:d={black_duration:.3f}",
                        "-f",
                        "lavfi",
                        "-i",
                        "anullsrc=r=48000:cl=stereo",
                        "-t",
                        f"{black_duration:.3f}",
                        "-shortest",
                        *common[:-1],
                        black_path,
                    ]
                )
                if rc != 0:
                    raise RuntimeError(f"第 {idx} 个视频片段后的黑幕转场编码失败: {err[:200]}")
                clips.append(black_path)
            job["done"] = idx

        if not clips:
            raise RuntimeError("No clips were composed successfully")

        list_file = os.path.join(tmp, "list.txt")
        with open(list_file, "w", encoding="utf-8") as file:
            for clip_path in clips:
                file.write(f"file '{clip_path}'\n")

        now = datetime.now()
        ts = now.strftime("%Y%m%d%H%M%S")
        ts_label = now.strftime("%m-%d %H:%M")
        ym = now.strftime("%Y%m")
        rel_dir = os.path.join(_STORAGE, "video", user_id, ym)
        os.makedirs(rel_dir, exist_ok=True)
        out_name = f"composed_{episode_id}_{ts}.mp4"
        out_path = os.path.join(rel_dir, out_name)
        rc, _out, err = await _run(
            [
                "ffmpeg",
                "-nostdin",
                "-y",
                "-loglevel",
                "error",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                list_file,
                "-c",
                "copy",
                out_path,
            ]
        )
        if rc != 0:
            raise RuntimeError(f"Final concat failed: {err[:200]}")

        duration = await _probe_dur(out_path)
        await _mix_global_audio_tracks(episode_id, out_path, duration, tmp)
        duration = await _probe_dur(out_path)
        subtitle_count = await _burn_editor_subtitles(
            subtitles,
            subtitle_style,
            out_path,
            duration,
            tmp,
            output_width,
            output_height,
        )
        duration = await _probe_dur(out_path)
        size = os.path.getsize(out_path)
        file_url = f"/storage/video/{user_id}/{ym}/{out_name}"
        file_path_rel = f"persistent_storage/video/{user_id}/{ym}/{out_name}"
        short = episode_id[-8:]
        file_id = f"file_cmp_{short}_{ts}"
        library_item_id = f"mli_cmp_{short}_{ts}"
        title = f"全片成片 {ts_label} ({len(prepared)} 镜)"

        await EpisodeComposeDAO.create_final_cut_records(
            file_id=file_id,
            library_item_id=library_item_id,
            user_id=user_id,
            project_id=project_id,
            episode_id=episode_id,
            file_name=out_name,
            file_path=file_path_rel,
            file_url=file_url,
            file_size_bytes=size,
            duration_seconds=duration,
            title=title,
            metadata={
                "source": "composed_final",
                "kind": "final_cut",
                "output_width": output_width,
                "output_height": output_height,
                "output_aspect": output_aspect,
                "audio_mode": audio_mode,
                "subtitle_count": subtitle_count,
                "transition_count": sum(
                    1 for index, row in enumerate(prepared[:-1])
                    if row.get("transition_after") in {"fade", "black"}
                ),
            },
        )

        job["url"] = file_url
        job["duration"] = round(duration, 1)
        job["status"] = "done"
        logger.info("compose done: episode=%s clips=%d dur=%.1fs", episode_id, len(prepared), duration)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def start_compose(
    episode_id: str,
    user_id: str,
    project_id: str,
    selections: Optional[Dict[str, str]] = None,
    audio_mode: str = "reference_dubbing",
    timeline: Optional[Any] = None,
    subtitles: Optional[Any] = None,
    subtitle_style: Optional[Any] = None,
) -> Dict[str, Any]:
    current = _jobs.get(episode_id)
    if current and current.get("status") == "running":
        return current

    normalized_audio_mode = (
        "reference_dubbing" if audio_mode == "reference_dubbing" else "video_original"
    )
    job: Dict[str, Any] = {
        "status": "running",
        "total": 0,
        "done": 0,
        "url": None,
        "error": None,
        "audio_mode": normalized_audio_mode,
    }
    _jobs[episode_id] = job

    async def _runner() -> None:
        try:
            await _compose(
                episode_id,
                user_id,
                project_id,
                job,
                selections,
                normalized_audio_mode,
                timeline,
                subtitles,
                subtitle_style,
            )
        except Exception as exc:
            job["status"] = "failed"
            job["error"] = str(exc)[:300]
            logger.exception("compose failed episode=%s", episode_id)

    asyncio.create_task(_runner())
    return job


def get_status(episode_id: str) -> Dict[str, Any]:
    return _jobs.get(episode_id) or {"status": "idle", "total": 0, "done": 0, "url": None, "error": None}
