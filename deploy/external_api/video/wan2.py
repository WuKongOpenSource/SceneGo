"""Wan2.6 DashScope video API client."""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional

from external_api.video.base import download_streaming_video, request_json
from services.api_provider_endpoints import derive_dashscope_video_urls
from services.api_provider_registry import DASHSCOPE_DEFAULT_MODEL_MAP
from services.api_provider_runtime import resolve_dashscope_model_name, resolve_provider

logger = logging.getLogger(__name__)

DEFAULT_WAN26_VIDEO_MODEL = DASHSCOPE_DEFAULT_MODEL_MAP["wan26"]


class Wan26Client:
    """DashScope Wan2.6 image-to-video client."""

    def __init__(self, api_key: Optional[str] = None):
        self._explicit_api_key = api_key
        self.api_key = ""
        self.base_url = ""
        self.create_endpoint = ""
        self.model_name = DEFAULT_WAN26_VIDEO_MODEL
        self._requests_kwargs: Dict[str, Any] = {}
        self.headers: Dict[str, str] = {}
        self._refresh_runtime_config()
        if not self.api_key:
            logger.warning("DASHSCOPE_API_KEY is not configured")

    def _refresh_runtime_config(self, model: Optional[str] = None) -> None:
        resolved_model = resolve_dashscope_model_name("wan26", model)
        config = resolve_provider("dashscope", resolved_model)
        self.api_key = self._explicit_api_key or config.api_key or ""
        self.model_name = config.model_name or resolved_model or DEFAULT_WAN26_VIDEO_MODEL
        self.base_url, self.create_endpoint = derive_dashscope_video_urls(config.endpoint)
        self._requests_kwargs = config.requests_kwargs()
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "X-DashScope-Async": "enable",
        }

    def create_video_task(
        self,
        prompt: str,
        img_url: str,
        audio_url: Optional[str] = None,
        resolution: str = "1080P",
        duration: int = 5,
        prompt_extend: bool = True,
        shot_type: str = "multi",
        audio: bool = True,
        watermark: bool = False,
        seed: Optional[int] = None,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a Wan2.6 video generation task."""
        self._refresh_runtime_config(model)
        url = self.create_endpoint
        data: Dict[str, Any] = {
            "model": self.model_name or DEFAULT_WAN26_VIDEO_MODEL,
            "input": {
                "prompt": prompt,
                "img_url": img_url,
            },
            "parameters": {
                "resolution": resolution,
                "duration": duration,
                "prompt_extend": prompt_extend,
                "shot_type": shot_type,
                "audio": audio,
                "watermark": watermark,
            },
        }
        if audio_url:
            data["input"]["audio_url"] = audio_url
        if seed is not None:
            data["parameters"]["seed"] = seed

        try:
            logger.info(
                "Wan2.6 create task: model=%s duration=%ss resolution=%s shot_type=%s",
                data["model"],
                duration,
                resolution,
                shot_type,
            )
            headers = {**self.headers, "Content-Type": "application/json"}
            result = request_json(
                "POST",
                url,
                headers=headers,
                json=data,
                request_kwargs=self._requests_kwargs,
                logger=logger,
                label="Wan2.6 create",
            )
            task_id = result.get("output", {}).get("task_id")
            task_status = result.get("output", {}).get("task_status")
            logger.info("Wan2.6 task created: %s status=%s", task_id, task_status)
            return result
        except Exception as exc:
            logger.error("Wan2.6 task create failed: %s", exc)
            raise

    def query_task(self, task_id: str) -> Dict[str, Any]:
        """Query a Wan2.6 task status."""
        self._refresh_runtime_config()
        url = f"{self.base_url}/tasks/{task_id}"
        try:
            return request_json(
                "GET",
                url,
                headers=self.headers,
                request_kwargs=self._requests_kwargs,
                logger=logger,
                label="Wan2.6 query",
            )
        except Exception as exc:
            logger.error("Wan2.6 query failed: %s", exc)
            raise

    def download_video(self, video_url: str) -> bytes:
        """Download a generated Wan2.6 video."""
        try:
            self._refresh_runtime_config()
            logger.info("Wan2.6 download started")
            return download_streaming_video(
                video_url,
                request_kwargs=self._requests_kwargs,
                logger=logger,
                label="Wan2.6 video",
            )
        except Exception as exc:
            logger.error("Wan2.6 video download failed: %s", exc)
            raise

    def wait_for_completion(
        self,
        task_id: str,
        max_wait: int = 600,
        poll_interval: int = 10,
    ) -> Dict[str, Any]:
        """Wait until the Wan2.6 task reaches a terminal status."""
        start_time = time.time()
        while time.time() - start_time < max_wait:
            try:
                result = self.query_task(task_id)
                output = result.get("output", {})
                status = output.get("task_status", "")
                if status == "SUCCEEDED":
                    logger.info("Wan2.6 task succeeded: %s", task_id)
                    return result
                if status == "FAILED":
                    code = result.get("code", "Unknown")
                    message = result.get("message", "Unknown error")
                    raise RuntimeError(f"Wan2.6 task failed: {code} - {message}")
                if status == "UNKNOWN":
                    raise RuntimeError(f"Wan2.6 task missing or expired: {task_id}")
                logger.info("Wan2.6 task processing: %s", status)
                time.sleep(poll_interval)
            except Exception as exc:
                if "task failed" in str(exc) or "missing or expired" in str(exc):
                    raise
                logger.error("Wan2.6 poll failed: %s", exc)
                time.sleep(poll_interval)
        raise TimeoutError(f"Wan2.6 task timed out ({max_wait}s): {task_id}")


_wan26_client: Optional[Wan26Client] = None


def get_wan26_client() -> Wan26Client:
    """Return the shared Wan2.6 client instance."""
    global _wan26_client
    if _wan26_client is None:
        _wan26_client = Wan26Client()
    return _wan26_client
