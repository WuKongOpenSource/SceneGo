




import time
import logging
from typing import Optional, Dict, Any, List
from external_api.video.base import download_streaming_video, request_json
from services.api_provider_registry import (
    VEO_DEFAULT_VIDEO_MODEL,
    normalize_veo_video_model,
    veo_runtime_model_override,
)
from services.api_provider_runtime import resolve_provider

logger = logging.getLogger(__name__)

DEFAULT_VEO_VIDEO_MODEL = VEO_DEFAULT_VIDEO_MODEL


class VeoClient:


    def __init__(self, api_key: Optional[str] = None):
        self._explicit_api_key = api_key
        self.api_key = api_key or ""
        self.base_url = ""
        self.model_name = DEFAULT_VEO_VIDEO_MODEL
        self._runtime_config = None
        self._request_kwargs: Dict[str, Any] = {}
        self._refresh_runtime_config()
        if not self.api_key:
            logger.warning("⚠️ VEO_API_KEY 未设置")

    def _refresh_runtime_config(self, model: Optional[str] = None) -> None:
        model_override = veo_runtime_model_override(model)
        config = resolve_provider("veo", model_override)
        self._runtime_config = config
        self.api_key = self._explicit_api_key or config.api_key
        self.base_url = config.endpoint.rstrip("/")
        self.model_name = normalize_veo_video_model(config.model_name or model_override)
        self._request_kwargs = config.requests_kwargs()
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

    def _url_for_operation(self, operation: str, **path_params: Any) -> str:
        if not self._runtime_config:
            self._refresh_runtime_config()
        return self._runtime_config.url_for_operation(operation, **path_params)

    def create_video_task(
        self,
        prompt: str,
        image_urls: Optional[List[str]] = None,
        model: Optional[str] = None
    ) -> Dict[str, Any]:











        self._refresh_runtime_config(model)
        resolved_model = self.model_name or DEFAULT_VEO_VIDEO_MODEL
        url = self._url_for_operation("chat_completions")

        try:

            content = [{"type": "text", "text": prompt}]


            if image_urls:
                for img_url in image_urls[:2]:
                    content.append({
                        "type": "image_url",
                        "image_url": {"url": img_url}
                    })

            data = {
                "model": resolved_model,
                "messages": [{
                    "role": "user",
                    "content": content
                }],
                "stream": False
            }

            logger.info(f"🎬 Veo 创建任务: {model}, {len(image_urls) if image_urls else 0}张图片")
            result = request_json(
                "POST",
                url,
                headers=self.headers,
                json=data,
                request_kwargs=self._request_kwargs,
                logger=logger,
                label="Veo create",
            )
            logger.info(f"✅ Veo 任务创建成功: {result.get('id')}")
            return result

        except Exception as e:
            logger.error(f"❌ Veo 任务创建失败: {e}")
            raise

    def query_task(self, video_id: str) -> Dict[str, Any]:









        self._refresh_runtime_config()
        url = self._url_for_operation("video", video_id=video_id)

        try:
            return request_json(
                "GET",
                url,
                headers=self.headers,
                request_kwargs=self._request_kwargs,
                logger=logger,
                label="Veo query",
            )

        except Exception as e:
            logger.error(f"❌ Veo 查询任务失败: {e}")
            raise

    def get_video_content(self, video_id: str) -> Dict[str, Any]:









        self._refresh_runtime_config()
        url = self._url_for_operation("video_content", video_id=video_id)

        try:
            return request_json(
                "GET",
                url,
                headers=self.headers,
                request_kwargs=self._request_kwargs,
                logger=logger,
                label="Veo content",
            )

        except Exception as e:
            logger.error(f"❌ Veo 获取视频内容失败: {e}")
            raise

    def download_video(self, video_url: str) -> bytes:









        try:
            logger.info(f"📥 Veo 下载视频: {video_url}")
            self._refresh_runtime_config()
            return download_streaming_video(
                video_url,
                request_kwargs=self._request_kwargs,
                logger=logger,
                label="Veo video",
            )
        except Exception as e:
            logger.error(f"❌ Veo 下载视频失败: {e}")
            raise

    def wait_for_completion(
        self,
        video_id: str,
        max_wait: int = 600,
        poll_interval: int = 5
    ) -> Dict[str, Any]:











        start_time = time.time()

        while time.time() - start_time < max_wait:
            try:
                result = self.query_task(video_id)
                status = result.get('status', '')

                if status == 'completed':
                    logger.info(f"✅ Veo 任务完成: {video_id}")
                    return result
                elif status == 'failed':
                    error = result.get('error', {})
                    error_msg = error.get('message', '未知错误')
                    raise RuntimeError(f"Veo 任务失败: {error_msg}")
                else:
                    logger.info(f"⏳ Veo 任务处理中: {status}")

                time.sleep(poll_interval)

            except Exception as e:
                logger.error(f"❌ Veo 轮询失败: {e}")
                time.sleep(poll_interval)

        raise TimeoutError(f"Veo 任务超时: {video_id}")



_veo_client = None

def get_veo_client() -> VeoClient:

    global _veo_client
    if _veo_client is None:
        _veo_client = VeoClient()
    return _veo_client
