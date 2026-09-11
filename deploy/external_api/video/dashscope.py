
























from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

import aiohttp

from services.api_provider_endpoints import derive_dashscope_video_urls
from services.api_provider_registry import (
    DASHSCOPE_DEFAULT_MODEL_MAP,
    dashscope_vidu_reference_sub_model,
    dashscope_vidu_startend_sub_model,
)
from services.api_provider_runtime import (
    resolve_dashscope_default_model_name,
    resolve_dashscope_model_name,
    resolve_provider,
)
from services.provider_endpoint_policy import validate_provider_endpoint

logger = logging.getLogger(__name__)



_TERMINAL_SUCCESS = {"succeeded"}
_TERMINAL_FAILED = {"failed", "canceled", "unknown"}
DEFAULT_KLING_STANDARD_MODEL = DASHSCOPE_DEFAULT_MODEL_MAP["kling-standard"]
DEFAULT_KLING_OMNI_MODEL = DASHSCOPE_DEFAULT_MODEL_MAP["kling-omni"]
DEFAULT_HAPPYHORSE_MODEL = DASHSCOPE_DEFAULT_MODEL_MAP["happyhorse"]


def _normalize_status(s: Optional[str]) -> str:
    return (s or "").strip().lower()


class DashScopeVideoError(RuntimeError):


    def __init__(
        self,
        message: str,
        *,
        code: Optional[str] = None,
        task_id: Optional[str] = None,
        http_status: Optional[int] = None,
    ):
        super().__init__(message)
        self.code = code
        self.task_id = task_id
        self.http_status = http_status


class DashScopeVideoClient:


    def __init__(self, api_key: Optional[str] = None, timeout: int = 30):
        self._explicit_api_key = api_key
        self.api_key = ""
        self.base_url = ""
        self.create_endpoint = ""
        self._aiohttp_proxy: Optional[str] = None
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self._refresh_runtime_config()
        if not self.api_key:
            logger.warning("⚠️ DASHSCOPE_API_KEY 未设置，DashScope 视频生成将失败")

    def _refresh_runtime_config(self, model: Optional[str] = None) -> None:
        config = resolve_provider("dashscope", model)
        self.api_key = self._explicit_api_key or config.api_key or ""
        self.base_url, self.create_endpoint = derive_dashscope_video_urls(config.endpoint)
        self._aiohttp_proxy = config.aiohttp_proxy()

    @property
    def _create_url(self) -> str:
        return self.create_endpoint

    def _query_url(self, task_id: str) -> str:
        return f"{self.base_url}/tasks/{task_id}"

    @property
    def _headers_create(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "X-DashScope-Async": "enable",
            "Content-Type": "application/json",
        }

    @property
    def _headers_query(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"}

    async def _request_json(
        self,
        method: str,
        url: str,
        *,
        headers: Dict[str, str],
        json: Optional[Dict[str, Any]] = None,
        task_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Run a DashScope JSON request with shared timeout/proxy/error handling."""
        request_kwargs: Dict[str, Any] = {
            "headers": headers,
            "proxy": self._aiohttp_proxy,
        }
        if json is not None:
            request_kwargs["json"] = json

        validate_provider_endpoint(url)
        request_kwargs["allow_redirects"] = False
        async with aiohttp.ClientSession(timeout=self.timeout) as session:
            request = getattr(session, method.lower())
            async with request(url, **request_kwargs) as resp:
                data = await resp.json(content_type=None)
                if resp.status >= 400:
                    code = data.get("code") if isinstance(data, dict) else None
                    msg = data.get("message", f"HTTP {resp.status}") if isinstance(data, dict) else f"HTTP {resp.status}"
                    raise DashScopeVideoError(msg, code=code, task_id=task_id, http_status=resp.status)
                if not isinstance(data, dict):
                    raise DashScopeVideoError("Invalid response format", task_id=task_id, http_status=resp.status)
                return data



    async def create_task(
        self,
        model: str,
        input_payload: Dict[str, Any],
        parameters: Dict[str, Any],
    ) -> Dict[str, Any]:

        self._refresh_runtime_config(model)
        if not self.api_key:
            raise DashScopeVideoError("DASHSCOPE_API_KEY 未配置", code="MissingApiKey")

        body = {"model": model, "input": input_payload, "parameters": parameters}
        logger.info(f"🎬 DashScope 创建任务: model={model}, params={parameters}")

        data = await self._request_json("post", self._create_url, headers=self._headers_create, json=body)
        task_id = data.get("output", {}).get("task_id")
        if not task_id:
            raise DashScopeVideoError(f"创建任务未返回 task_id: {data}", code="NoTaskId")
        logger.info(f"✅ DashScope 任务创建: task_id={task_id}, status={data.get('output', {}).get('task_status')}")
        return data

    async def query_task(self, task_id: str) -> Dict[str, Any]:

        self._refresh_runtime_config()
        if not self.api_key:
            raise DashScopeVideoError("DASHSCOPE_API_KEY 未配置", code="MissingApiKey")

        return await self._request_json("get", self._query_url(task_id), headers=self._headers_query, task_id=task_id)

    async def wait_for_completion(
        self,
        task_id: str,
        *,
        max_wait: int = 600,
        poll_interval: int = 10,
    ) -> Dict[str, Any]:

        elapsed = 0
        last: Dict[str, Any] = {}
        while elapsed < max_wait:
            last = await self.query_task(task_id)
            status = _normalize_status(last.get("output", {}).get("task_status"))
            logger.debug(f"⏳ DashScope task_id={task_id} status={status} elapsed={elapsed}s")
            if status in _TERMINAL_SUCCESS:
                logger.info(f"✅ DashScope 任务完成: {task_id}")
                return last
            if status in _TERMINAL_FAILED:
                out = last.get("output", {})
                raise DashScopeVideoError(
                    out.get("message") or f"任务终止({status})",
                    code=out.get("code") or status,
                    task_id=task_id,
                )
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
        raise TimeoutError(f"DashScope 任务超时 ({max_wait}s): {task_id}")



    async def submit(
        self,
        *,
        model_name: str,
        params: Dict[str, Any],
    ) -> Dict[str, Any]:















        prompt = params.get("prompt") or ""
        media_inputs = params.get("media_inputs") or []
        duration = int(params.get("duration") or 5)
        audio = bool(params.get("audio") or False)
        watermark = bool(params.get("watermark") or False)

        def _urls_by_role(role: str) -> List[str]:
            return [
                m.get("url")
                for m in media_inputs
                if (m.get("role") or "").lower() == role and m.get("url")
            ]

        def _urls_by_kind(kind: str) -> List[str]:
            return [
                m.get("url")
                for m in media_inputs
                if (m.get("kind") or "").lower() == kind and m.get("url")
            ]

        if model_name == "合体":
            sub_kling = (params.get("sub_model_kling") or "standard").lower()
            kling_sub_model = "kling-omni" if sub_kling == "omni" else "kling-standard"
            kling_model = resolve_dashscope_model_name(kling_sub_model)
            first = (_urls_by_role("first_frame") or [None])[0]
            last = (_urls_by_role("last_frame") or [None])[0]
            refs = _urls_by_role("reference_image") or None
            return await self.kling_submit(
                prompt=prompt,
                model=kling_model,
                first_frame_url=first,
                last_frame_url=last,
                reference_image_urls=refs,
                mode=(params.get("mode") or "std"),
                duration=duration,
                aspect_ratio=params.get("aspect_ratio"),
                audio=audio,
                watermark=watermark,
                seed=None,
                multi_shot=bool(params.get("kling_multi_shot")),
                shot_type=params.get("kling_shot_type"),
                multi_prompt=params.get("kling_multi_prompt"),
                keep_original_sound=params.get("kling_keep_original_sound"),
            )

        if model_name == "大乘":
            sub_vidu = (params.get("sub_model_vidu") or "q3").lower()
            first = (_urls_by_role("first_frame") or [None])[0]
            last = (_urls_by_role("last_frame") or [None])[0]
            vidu_resolution = params.get("vidu_resolution") or "720P"
            vidu_audio = (
                bool(params["vidu_audio"]) if params.get("vidu_audio") is not None else audio
            )
            vidu_seed = params.get("vidu_seed")
            if vidu_seed is not None:
                vidu_seed = int(vidu_seed)

            if first and last:
                vidu_sub_model = dashscope_vidu_startend_sub_model(sub_vidu)
                return await self.vidu_startend_submit(
                    prompt=prompt,
                    model=resolve_dashscope_model_name(vidu_sub_model),
                    first_frame_url=first,
                    last_frame_url=last,
                    resolution=vidu_resolution,
                    duration=duration,
                    audio=vidu_audio,
                    watermark=watermark,
                    seed=vidu_seed,
                )

            vidu_sub_model = dashscope_vidu_reference_sub_model(sub_vidu)
            ref_imgs = _urls_by_role("reference_image") or _urls_by_kind("image") or None
            ref_videos = _urls_by_kind("video") or None
            return await self.vidu_reference_submit(
                prompt=prompt,
                model=resolve_dashscope_model_name(vidu_sub_model),
                reference_image_urls=ref_imgs,
                reference_video_urls=ref_videos,
                resolution=vidu_resolution,
                size=params.get("vidu_size"),
                duration=duration,
                audio=vidu_audio,
                watermark=watermark,
                seed=vidu_seed,
            )

        if model_name == "炼虚":
            ref_imgs = _urls_by_kind("image")
            hh_watermark = params.get("hh_watermark")
            hh_seed = params.get("hh_seed")
            if hh_seed is not None:
                hh_seed = int(hh_seed)
            return await self.happyhorse_submit(
                prompt=prompt,
                model=resolve_dashscope_model_name("happyhorse"),
                reference_image_urls=ref_imgs,
                resolution=params.get("hh_resolution") or "1080P",
                ratio=params.get("hh_ratio") or "16:9",
                duration=int(params.get("hh_duration") or duration),
                watermark=bool(hh_watermark) if hh_watermark is not None else True,
                seed=hh_seed,
            )

        raise DashScopeVideoError(
            f"未知 model_name: {model_name!r}（应为 '合体'/'大乘'/'炼虚'）",
            code="UnknownModel",
        )


    async def kling_submit(
        self,
        prompt: str,
        *,
        model: str = "kling/kling-v3-video-generation",
        first_frame_url: Optional[str] = None,
        last_frame_url: Optional[str] = None,
        reference_image_urls: Optional[List[str]] = None,
        video_url: Optional[str] = None,
        mode: str = "std",
        duration: int = 5,
        aspect_ratio: Optional[str] = None,
        audio: bool = False,
        watermark: bool = False,
        seed: Optional[int] = None,

        multi_shot: bool = False,
        shot_type: Optional[str] = None,           # 'intelligence' | 'customize'
        multi_prompt: Optional[List[Dict[str, Any]]] = None,

        keep_original_sound: Optional[str] = None,
    ) -> Dict[str, Any]:













        media: List[Dict[str, Any]] = []
        if first_frame_url:
            media.append({"type": "first_frame", "url": first_frame_url})
        if last_frame_url:
            media.append({"type": "last_frame", "url": last_frame_url})
        if reference_image_urls:
            for u in reference_image_urls:
                media.append({"type": "refer", "url": u})
        if video_url:
            base_entry: Dict[str, Any] = {"type": "base", "url": video_url}
            if keep_original_sound:
                base_entry["keep_original_sound"] = keep_original_sound
            media.append(base_entry)

        input_payload: Dict[str, Any] = {"prompt": prompt}
        if media:
            input_payload["media"] = media


        if multi_shot:
            input_payload["multi_shot"] = True
            input_payload["shot_type"] = shot_type or "intelligence"
            if input_payload["shot_type"] == "customize" and multi_prompt:
                input_payload["multi_prompt"] = multi_prompt

        params: Dict[str, Any] = {
            "mode": mode,
            "duration": duration,
            "audio": audio,
            "watermark": watermark,
        }

        if aspect_ratio and not first_frame_url:
            params["aspect_ratio"] = aspect_ratio
        if seed is not None:
            params["seed"] = seed

        if model == DEFAULT_KLING_OMNI_MODEL:
            model = resolve_dashscope_model_name("kling-omni")
        elif model == DEFAULT_KLING_STANDARD_MODEL:
            model = resolve_dashscope_model_name("kling-standard")

        return await self.create_task(model, input_payload, params)


    async def vidu_reference_submit(
        self,
        prompt: str,
        *,
        model: str = "vidu/viduq3_reference2video",
        reference_image_urls: Optional[List[str]] = None,
        reference_video_urls: Optional[List[str]] = None,
        resolution: str = "720P",
        size: Optional[str] = None,
        duration: int = 5,
        audio: bool = False,
        watermark: bool = False,
        seed: Optional[int] = None,
    ) -> Dict[str, Any]:

        if not reference_image_urls and not reference_video_urls:
            raise DashScopeVideoError("Vidu 参考生视频至少需要 1 张参考图或视频", code="InvalidParameter")

        media: List[Dict[str, str]] = []
        for u in (reference_video_urls or []):
            media.append({"type": "video", "url": u})
        for u in (reference_image_urls or []):
            media.append({"type": "image", "url": u})

        input_payload = {"prompt": prompt, "media": media}
        params: Dict[str, Any] = {
            "duration": duration,
            "resolution": resolution,
            "audio": audio,
            "watermark": watermark,
        }
        if size:
            params["size"] = size
        if seed is not None:
            params["seed"] = seed
        model = resolve_dashscope_default_model_name(model)
        return await self.create_task(model, input_payload, params)

    async def vidu_startend_submit(
        self,
        prompt: str,
        *,
        model: str = "vidu/viduq3-turbo_start-end2video",
        first_frame_url: str,
        last_frame_url: str,
        resolution: str = "720P",
        duration: int = 5,
        audio: bool = False,
        watermark: bool = False,
        seed: Optional[int] = None,
    ) -> Dict[str, Any]:

        if not first_frame_url or not last_frame_url:
            raise DashScopeVideoError("Vidu 首尾帧必须同时提供首帧和尾帧", code="InvalidParameter")

        input_payload = {
            "prompt": prompt,
            "media": [
                {"type": "image", "url": first_frame_url},
                {"type": "image", "url": last_frame_url},
            ],
        }
        params: Dict[str, Any] = {
            "resolution": resolution,
            "duration": duration,
            "audio": audio,
            "watermark": watermark,
        }
        if seed is not None:
            params["seed"] = seed
        model = resolve_dashscope_default_model_name(model)
        return await self.create_task(model, input_payload, params)


    async def happyhorse_submit(
        self,
        prompt: str,
        *,
        reference_image_urls: List[str],
        model: str = DEFAULT_HAPPYHORSE_MODEL,
        resolution: str = "720P",
        ratio: str = "16:9",
        duration: int = 5,
        watermark: bool = False,
        seed: Optional[int] = None,
    ) -> Dict[str, Any]:

        if not reference_image_urls:
            raise DashScopeVideoError("HappyHorse 至少需要 1 张参考图", code="InvalidParameter")
        if len(reference_image_urls) > 9:
            raise DashScopeVideoError("HappyHorse 最多支持 9 张参考图", code="InvalidParameter")

        input_payload = {
            "prompt": prompt,
            "media": [{"type": "reference_image", "url": u} for u in reference_image_urls],
        }
        params: Dict[str, Any] = {
            "resolution": resolution,
            "ratio": ratio,
            "duration": duration,
            "watermark": watermark,
        }
        if seed is not None:
            params["seed"] = seed
        model = resolve_dashscope_default_model_name(model)
        return await self.create_task(model, input_payload, params)



    @staticmethod
    def extract_video_url(task_result: Dict[str, Any], prefer_watermark: bool = False) -> Optional[str]:




        out = task_result.get("output", {}) if isinstance(task_result, dict) else {}
        if prefer_watermark:
            return out.get("watermark_video_url") or out.get("video_url")
        return out.get("video_url") or out.get("watermark_video_url")



_default_client: Optional[DashScopeVideoClient] = None


def get_dashscope_video_client() -> DashScopeVideoClient:

    global _default_client
    if _default_client is None:
        _default_client = DashScopeVideoClient()
    return _default_client
