"""MiniMax Hailuo video API client."""

import logging
import time
from typing import Any, Dict, Optional

from external_api.video.base import download_streaming_video, request_json
from services.api_provider_registry import (
    MINIMAX_DEFAULT_VIDEO_MODEL,
    minimax_runtime_model_override,
    normalize_minimax_video_model,
)
from services.api_provider_runtime import resolve_provider

logger = logging.getLogger(__name__)

DEFAULT_MINIMAX_VIDEO_MODEL = MINIMAX_DEFAULT_VIDEO_MODEL

_SUCCESS_CODES = {0, "0", None}
_SUCCESS_STATUSES = {"success", "succeeded"}
_FAILED_STATUSES = {"fail", "failed", "expired"}


def _extract_task_id(payload: Any) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    for key in ("task_id", "id"):
        value = payload.get(key)
        if value:
            return str(value)
    for key in ("data", "output", "result"):
        task_id = _extract_task_id(payload.get(key))
        if task_id:
            return task_id
    return None


def _extract_minimax_error(payload: Any) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    base_resp = payload.get("base_resp")
    if isinstance(base_resp, dict):
        status_code = base_resp.get("status_code", 0)
        if status_code not in _SUCCESS_CODES:
            parts = [f"status_code={status_code}"]
            status_msg = base_resp.get("status_msg")
            if status_msg:
                parts.append(f"status_msg={status_msg}")
            trace_id = payload.get("trace_id")
            if trace_id:
                parts.append(f"trace_id={trace_id}")
            return " ".join(parts)
    error = payload.get("error")
    if isinstance(error, dict):
        code = error.get("code") or error.get("type")
        message = error.get("message") or error.get("status_msg")
        if code or message:
            return " ".join(str(item) for item in (code, message) if item)
    message = payload.get("message") or payload.get("error_message")
    return str(message) if message else None


def _summarize_response(payload: Any) -> str:
    text = str(payload)
    return text if len(text) <= 500 else f"{text[:500]}..."


def _raise_for_minimax_error(action: str, payload: Any) -> None:
    error = _extract_minimax_error(payload)
    if error:
        raise RuntimeError(f"{action} failed: {error}")


def normalize_minimax_duration(duration: Optional[int]) -> int:
    """Validate MiniMax's fixed duration values without silently changing intent."""
    if duration is None:
        return 6
    try:
        value = int(duration)
    except (TypeError, ValueError):
        raise ValueError("MiniMax 视频时长必须为 6 秒或 10 秒") from None
    if value not in {6, 10}:
        raise ValueError(f"MiniMax 视频不支持 {value} 秒；可选时长为 6 秒或 10 秒")
    return value


def normalize_minimax_resolution(resolution: Optional[str]) -> str:
    if resolution is None or not str(resolution).strip():
        return "768P"
    value = str(resolution).strip().upper()
    if value not in {"768P", "1080P"}:
        raise ValueError(f"MiniMax 视频不支持分辨率 {resolution}；可选分辨率为 768P 或 1080P")
    return value


def normalize_minimax_generation_options(
    duration: Optional[int],
    resolution: Optional[str],
) -> tuple[int, str]:
    resolved_duration = normalize_minimax_duration(duration)
    resolved_resolution = normalize_minimax_resolution(resolution)
    if resolved_resolution == "1080P" and resolved_duration != 6:
        raise ValueError("MiniMax 1080P 仅支持 6 秒；请选择 6 秒，或将分辨率改为 768P")
    return resolved_duration, resolved_resolution


def normalize_minimax_status(payload: Dict[str, Any]) -> str:
    return str(payload.get("status") or "").strip().lower()


def _is_audio_model(model: Optional[str]) -> bool:
    return str(model or "").strip().lower().startswith("speech-")


class MinimaxClient:
    """Runtime-configured MiniMax Hailuo video client."""

    def __init__(self, api_key: Optional[str] = None):
        self._explicit_api_key = api_key
        self.api_key = api_key or ""
        self.base_url = ""
        self.model_name = DEFAULT_MINIMAX_VIDEO_MODEL
        self._runtime_config = None
        self._request_kwargs: Dict[str, Any] = {}
        self.headers: Dict[str, str] = {}
        self._refresh_runtime_config()
        if not self.api_key:
            logger.warning("MINIMAX_API_KEY is not configured")

    def _refresh_runtime_config(self, model: Optional[str] = None) -> None:
        model_override = minimax_runtime_model_override(model)
        config = resolve_provider("minimax", model_override)
        self._runtime_config = config
        self.api_key = self._explicit_api_key or config.api_key
        self.base_url = config.endpoint.rstrip("/")
        self.model_name = normalize_minimax_video_model(config.model_name or model_override)
        if _is_audio_model(self.model_name):
            self.model_name = DEFAULT_MINIMAX_VIDEO_MODEL
        self._request_kwargs = config.requests_kwargs()
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

    def _url_for_operation(self, operation: str, **path_params: Any) -> str:
        if not self._runtime_config:
            self._refresh_runtime_config()
        return self._runtime_config.url_for_operation(operation, **path_params)

    def _request_json(self, method: str, url: str, *, label: str, **kwargs: Any) -> Any:
        return request_json(
            method,
            url,
            headers=self.headers,
            request_kwargs=self._request_kwargs,
            logger=logger,
            label=label,
            **kwargs,
        )

    def generate_video(
        self,
        first_frame_image: str,
        prompt: str,
        last_frame_image: Optional[str] = None,
        model: Optional[str] = None,
        duration: int = 6,
        resolution: str = "768P",
        prompt_optimizer: bool = True,
    ) -> Dict[str, Any]:
        self._refresh_runtime_config(model)
        resolved_model = self.model_name or DEFAULT_MINIMAX_VIDEO_MODEL
        resolved_duration, resolved_resolution = normalize_minimax_generation_options(duration, resolution)
        url = self._url_for_operation("video_generation")

        payload = {
            "model": resolved_model,
            "first_frame_image": first_frame_image,
            "prompt": prompt,
            "duration": resolved_duration,
            "resolution": resolved_resolution,
            "prompt_optimizer": bool(prompt_optimizer),
            "aigc_watermark": False,
        }
        if last_frame_image:
            payload["last_frame_image"] = last_frame_image

        try:
            logger.info("MiniMax create task: model=%s duration=%ss resolution=%s", resolved_model, resolved_duration, resolved_resolution)
            result = self._request_json(
                "POST",
                url,
                json=payload,
                label="MiniMax create",
            )
            _raise_for_minimax_error("MiniMax create", result)
            task_id = _extract_task_id(result)
            if not task_id:
                raise RuntimeError(
                    f"MiniMax create response did not include task_id: {_summarize_response(result)}"
                )
            result = dict(result)
            result.setdefault("task_id", task_id)
            logger.info("MiniMax task created: %s", task_id)
            return result
        except Exception as exc:
            logger.error("MiniMax create task failed: %s", exc)
            raise

    def query_task(self, task_id: str) -> Dict[str, Any]:
        self._refresh_runtime_config()
        url = self._url_for_operation("query_video_generation")
        params = {"task_id": task_id}

        try:
            result = self._request_json(
                "GET",
                url,
                params=params,
                label="MiniMax query",
            )
            _raise_for_minimax_error("MiniMax query", result)
            return result
        except Exception as exc:
            logger.error("MiniMax query task failed: %s", exc)
            raise

    def download_video(self, file_id: str) -> bytes:
        self._refresh_runtime_config()
        url = self._url_for_operation("files_retrieve")
        params = {"file_id": file_id}

        try:
            result = self._request_json(
                "GET",
                url,
                params=params,
                label="MiniMax retrieve file",
            )
            _raise_for_minimax_error("MiniMax retrieve file", result)
            download_url = result.get("file", {}).get("download_url")
            if not download_url:
                raise RuntimeError(
                    f"MiniMax retrieve response did not include download_url: {_summarize_response(result)}"
                )
            logger.info("MiniMax downloading video: %s", download_url)
            return download_streaming_video(
                download_url,
                request_kwargs=self._request_kwargs,
                logger=logger,
                label="MiniMax video",
            )
        except Exception as exc:
            logger.error("MiniMax download video failed: %s", exc)
            raise

    def wait_for_completion(
        self,
        task_id: str,
        max_wait: int = 600,
        poll_interval: int = 5,
    ) -> Dict[str, Any]:
        start_time = time.time()

        while time.time() - start_time < max_wait:
            result = self.query_task(task_id)
            status = normalize_minimax_status(result)
            if status in _SUCCESS_STATUSES:
                logger.info("MiniMax task completed: %s", task_id)
                return result
            if status in _FAILED_STATUSES:
                error_msg = (
                    result.get("error_message")
                    or result.get("base_resp", {}).get("status_msg")
                    or "unknown error"
                )
                raise RuntimeError(f"MiniMax task failed: {error_msg}")
            logger.info("MiniMax task processing: %s status=%s", task_id, status or "unknown")
            time.sleep(poll_interval)

        raise TimeoutError(f"MiniMax task timed out: {task_id}")


_minimax_client: Optional[MinimaxClient] = None


def get_minimax_client() -> MinimaxClient:
    global _minimax_client
    if _minimax_client is None:
        _minimax_client = MinimaxClient()
    return _minimax_client
