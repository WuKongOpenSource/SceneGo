"""Authorized, bounded speech-to-subtitle generation for the edit timeline."""
from __future__ import annotations

import asyncio
import base64
import json
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import quote, urlsplit, urlunsplit

from services.api_provider_runtime import resolve_provider
from services.ai_proxy_http_client import _post_json_request_async
from services.provider_media_input_service import ProviderMediaInputError, provider_audio_or_video_reference


class AudioTranscriptionError(ValueError):
    pass


def _parse_json_object(value: str) -> Dict[str, Any]:
    clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", str(value or "").strip(), flags=re.I)
    match = re.search(r"\{[\s\S]*\}", clean)
    if not match:
        raise AudioTranscriptionError("语音识别未返回有效字幕，请重试")
    try:
        parsed = json.loads(match.group(0))
    except (TypeError, ValueError) as exc:
        raise AudioTranscriptionError("语音识别返回的字幕格式无效，请重试") from exc
    if not isinstance(parsed, dict):
        raise AudioTranscriptionError("语音识别返回的字幕格式无效，请重试")
    return parsed


def normalize_transcription_segments(
    value: str,
    *,
    duration_ms: int,
    allow_empty: bool = False,
) -> List[Dict[str, Any]]:
    parsed = _parse_json_object(value)
    rows = parsed.get("segments")
    if not isinstance(rows, list):
        raise AudioTranscriptionError("语音识别未返回分段字幕，请重试")
    normalized: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        text = re.sub(r"\s+", " ", str(row.get("text") or "")).strip()
        try:
            start_ms = max(0, int(float(row.get("start_ms", 0))))
            end_ms = min(duration_ms, int(float(row.get("end_ms", 0))))
        except (TypeError, ValueError):
            continue
        if not text or end_ms <= start_ms:
            continue
        normalized.append({"start_ms": start_ms, "end_ms": end_ms, "text": text})
    normalized.sort(key=lambda item: (item["start_ms"], item["end_ms"]))
    if not normalized and not allow_empty:
        raise AudioTranscriptionError("没有识别到清晰语音，请检查配音轨道后重试")
    return normalized


def _trim_audio_data_uri(data_uri: str, *, source_offset_ms: int, duration_ms: int) -> str:
    try:
        header, encoded = data_uri.split(",", 1)
        source = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError) as exc:
        raise AudioTranscriptionError("配音文件格式无效") from exc
    lower_header = header.lower()
    suffix = ".wav" if "wav" in lower_header else ".mp4" if "video/" in lower_header else ".mp3"
    with tempfile.TemporaryDirectory(prefix="ostory-asr-") as temp_dir:
        source_path = Path(temp_dir) / f"source{suffix}"
        output_path = Path(temp_dir) / "clip.wav"
        source_path.write_bytes(source)
        command = [
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-ss", f"{source_offset_ms / 1000:.3f}",
            "-t", f"{duration_ms / 1000:.3f}",
            "-i", str(source_path), "-vn", "-ac", "1", "-ar", "16000", str(output_path),
        ]
        try:
            subprocess.run(command, check=True, capture_output=True, timeout=90)
        except (OSError, subprocess.SubprocessError) as exc:
            raise AudioTranscriptionError("无法读取所选配音片段，请检查音频后重试") from exc
        output = output_path.read_bytes() if output_path.exists() else b""
    if not output:
        raise AudioTranscriptionError("所选配音片段没有可识别的音频")
    if len(output) > 20 * 1024 * 1024:
        raise AudioTranscriptionError("单个配音片段过长，请先裁剪后再生成字幕")
    return f"data:audio/wav;base64,{base64.b64encode(output).decode('ascii')}"


def _gemini_native_url(config: Any, model: str) -> str:
    endpoint = str(config.endpoint or "").strip()
    parsed = urlsplit(endpoint)
    path = parsed.path.rstrip("/")
    if path.endswith("/chat/completions"):
        path = path[: -len("/chat/completions")]
    if path.endswith("/v1beta/openai"):
        path = path[: -len("/openai")]
    elif path.endswith("/v1"):
        path = f"{path[:-3]}/v1beta"
    elif not path.endswith("/v1beta"):
        path = f"{path}/v1beta"
    base = urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))
    return f"{base}/models/{quote(model, safe='-_.')}:generateContent"


def _gemini_native_text(result: Dict[str, Any]) -> str:
    candidates = result.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise AudioTranscriptionError("语音识别未返回字幕，请重试")
    content = candidates[0].get("content") if isinstance(candidates[0], dict) else None
    parts = content.get("parts") if isinstance(content, dict) else None
    if not isinstance(parts, list):
        raise AudioTranscriptionError("语音识别未返回字幕，请重试")
    text = "\n".join(
        str(part.get("text") or "")
        for part in parts
        if isinstance(part, dict) and not part.get("thought") and part.get("text")
    ).strip()
    if not text:
        raise AudioTranscriptionError("语音识别未返回字幕，请重试")
    return text


async def _transcribe_wav(config: Any, model: str, encoded: str, duration_ms: int) -> List[Dict[str, Any]]:
    prompt = (
        "请转写这段中文语音，并按自然语义切成适合视频显示的字幕。"
        "时间以该音频片段开头为 0，毫秒为单位。只输出严格 JSON："
        '{"segments":[{"start_ms":0,"end_ms":1200,"text":"字幕"}]}。'
        "不要翻译，不要概括，不要添加音频中不存在的内容。"
    )
    result = await _post_json_request_async(
        label="Gemini audio transcription",
        url=_gemini_native_url(config, model),
        headers={
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        },
        payload={
            "contents": [{
                "role": "user",
                "parts": [
                    {"text": prompt},
                    {"inlineData": {"mimeType": "audio/wav", "data": encoded}},
                ],
            }],
            "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
        },
        timeout=120,
        timeout_message="语音识别等待超时，请稍后重试",
        timeout_status_code=504,
        request_error_message="语音识别服务暂不可用，请稍后重试",
        parse_error_message="语音识别服务返回格式无效",
        request_kwargs=config.requests_kwargs(),
        expected_status=200,
        upstream_detail=lambda _upstream, status: f"语音识别服务调用失败（{status}）",
    )
    return normalize_transcription_segments(
        _gemini_native_text(result),
        duration_ms=duration_ms,
        allow_empty=True,
    )


async def transcribe_timeline_audio(
    clips: List[Dict[str, Any]],
    *,
    file_dao: Any,
) -> List[Dict[str, Any]]:
    if not clips:
        raise AudioTranscriptionError("时间线上没有可识别的配音片段")
    config = resolve_provider("gemini-text", "gemini-2.5-flash", usage_scope="workflow")
    if not config.api_key or not config.endpoint:
        raise AudioTranscriptionError("语音识别服务尚未配置，请联系管理员")
    model = config.model_name or "gemini-2.5-flash"
    results: List[Dict[str, Any]] = []
    for clip in clips:
        clip_id = str(clip.get("clip_id") or "").strip()
        audio_url = str(clip.get("audio_url") or "").strip()
        media_kind = str(clip.get("media_kind") or "audio").strip().lower()
        duration_ms = max(200, min(30 * 60 * 1000, int(clip.get("duration_ms") or 0)))
        source_offset_ms = max(0, int(clip.get("source_offset_ms") or 0))
        if not clip_id or not audio_url:
            raise AudioTranscriptionError("配音片段缺少来源信息")
        if media_kind not in {"audio", "video"}:
            raise AudioTranscriptionError("语音字幕来源类型无效")
        try:
            source_data = await provider_audio_or_video_reference(
                audio_url,
                media_kind=media_kind,
                file_dao=file_dao,
            )
        except ProviderMediaInputError as exc:
            raise AudioTranscriptionError("配音文件不存在或无法读取") from exc
        if not source_data.startswith(("data:audio/", "data:video/")):
            raise AudioTranscriptionError("语音识别仅支持已上传到 Ovideo 的音视频文件")
        chunk_start_ms = 0
        while chunk_start_ms < duration_ms:
            chunk_duration_ms = min(60_000, duration_ms - chunk_start_ms)
            trimmed_data = await asyncio.to_thread(
                _trim_audio_data_uri,
                source_data,
                source_offset_ms=source_offset_ms + chunk_start_ms,
                duration_ms=chunk_duration_ms,
            )
            encoded = trimmed_data.split(",", 1)[1]
            for segment in await _transcribe_wav(config, model, encoded, chunk_duration_ms):
                results.append({
                    "clip_id": clip_id,
                    "start_ms": segment["start_ms"] + chunk_start_ms,
                    "end_ms": segment["end_ms"] + chunk_start_ms,
                    "text": segment["text"],
                })
            chunk_start_ms += chunk_duration_ms
    return results
