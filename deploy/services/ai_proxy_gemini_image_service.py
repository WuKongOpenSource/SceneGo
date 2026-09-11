"""Gemini image provider helpers for AI proxy calls."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from services.api_provider_registry import normalize_gemini_image_model
from services.api_provider_runtime import resolve_provider
from services.ai_proxy_http_client import _post_json_request_async
from services.ai_proxy_types import AIProxyConfigError, AIProxyUpstreamError


def build_gemini_image_payload(
    *,
    parts: List[Dict[str, Any]],
    model: str,
    aspect_ratio: str,
    image_size: Optional[str] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {
                "aspectRatio": aspect_ratio,
            },
        },
    }
    if model == "gemini-3.1-flash-image-preview" and image_size:
        payload["generationConfig"]["imageConfig"]["imageSize"] = image_size
    return payload


def parse_gemini_image_response(result: Dict[str, Any]) -> List[str]:
    images: List[str] = []
    for candidate in result.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            if "inlineData" in part:
                mime_type = part["inlineData"]["mimeType"]
                data = part["inlineData"]["data"]
                images.append(f"data:{mime_type};base64,{data}")
    return images


async def _post_gemini_image_generation(
    *,
    config: Any,
    model: str,
    payload: Dict[str, Any],
) -> List[str]:
    if not config.api_key:
        raise AIProxyConfigError("图像生成服务未配置，请联系管理员")
    if not config.endpoint:
        raise AIProxyConfigError("图像生成服务 endpoint 未配置，请联系管理员")

    result = await _post_json_request_async(
        label="Gemini image",
        url=config.url_for_operation("generate_content", model=model),
        headers={
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        },
        payload=payload,
        timeout=180,
        timeout_message="图像生成失败，请稍后重试",
        timeout_status_code=500,
        request_error_message="图像生成失败，请稍后重试",
        parse_error_message="图像生成服务响应格式异常",
        request_kwargs=config.requests_kwargs(),
        upstream_detail=lambda upstream, _status_code: f"图像生成失败：{upstream[:200]}" if upstream else "图像生成失败，请稍后重试",
    )
    return parse_gemini_image_response(result)


async def generate_gemini_images(
    *,
    parts: List[Dict[str, Any]],
    requested_model: Optional[str],
    aspect_ratio: str,
    image_size: Optional[str] = None,
    usage_scope: Optional[str] = None,
) -> tuple[List[str], str]:
    explicit_model = normalize_gemini_image_model(requested_model)
    config = (
        resolve_provider("gemini-image", explicit_model, usage_scope=usage_scope)
        if usage_scope is not None
        else resolve_provider("gemini-image", explicit_model)
    )
    model = config.model_name or explicit_model or "gemini-2.5-flash-image"
    payload = build_gemini_image_payload(
        parts=parts,
        model=model,
        aspect_ratio=aspect_ratio,
        image_size=image_size,
    )
    images = await _post_gemini_image_generation(
        config=config,
        model=model,
        payload=payload,
    )
    if not images:
        raise AIProxyUpstreamError("图像生成服务未返回结果")
    return images, model
