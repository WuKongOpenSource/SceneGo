"""Doubao image provider helpers for AI proxy calls."""
from __future__ import annotations

import asyncio
import logging
import math
import os
import re
import time
from typing import Any, Dict, List, Optional

import requests

from services.api_provider_registry import (
    DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    DOUBAO_IMAGE_DEFAULT_MODEL,
    doubao_image_access_mode,
    normalize_doubao_image_model_for_endpoint,
)
from services.api_provider_runtime import resolve_provider
from services.ai_proxy_http_client import _post_json_request_async
from services.provider_endpoint_policy import validate_provider_endpoint
from services.sensitive_data_redaction import redact_sensitive_text
from services.ai_proxy_openai_image_service import parse_openai_image_response
from services.ai_proxy_types import AIProxyConfigError, AIProxyUpstreamError
from services.seedance_image_provenance import (
    SEEDREAM_PRO_MODEL, SeedreamImageBatch, SeedanceInputProvenanceError,
    validate_portrait_generation,
)

logger = logging.getLogger(__name__)

DOUBAO_IMAGE_TASK_PENDING_STATUSES = {"queued", "pending", "running", "processing", "in_progress"}
DOUBAO_IMAGE_TASK_SUCCESS_STATUSES = {"succeeded", "success", "completed", "done"}
DOUBAO_IMAGE_TASK_FAILED_STATUSES = {"failed", "error", "cancelled", "canceled", "expired"}
DOUBAO_IMAGE_STANDARD_MIN_PIXELS = 2560 * 1440
DOUBAO_IMAGE_DIMENSION_MULTIPLE = 16
# Connect/write inactivity and total upload deadlines are separate. Reference
# bytes are streamed in small writes so a large original is not one sendall.
DOUBAO_IMAGE_CONNECT_TIMEOUT = 60
DOUBAO_IMAGE_UPLOAD_TIMEOUT = 180
DOUBAO_IMAGE_STANDARD_READ_TIMEOUT = 120
DOUBAO_IMAGE_AGENT_PLAN_READ_TIMEOUT = 600
DOUBAO_IMAGE_MAX_CONCURRENCY = max(1, int(os.getenv("DOUBAO_IMAGE_MAX_CONCURRENCY", "1")))
_DOUBAO_IMAGE_SEMAPHORE = asyncio.Semaphore(DOUBAO_IMAGE_MAX_CONCURRENCY)
DOUBAO_SENSITIVE_INPUT_MARKERS = (
    "inputtextsensitivecontentdetected",
    "input text may contain sensitive information",
)
DOUBAO_ABSTRACT_GEOGRAPHY_REPLACEMENTS = (
    ("全国高校地图", "多地区高校数据可视化背景"),
    ("中国地图", "抽象地区轮廓"),
    ("全国地图", "多地区数据可视化背景"),
    ("各省份", "各地区"),
    ("省份", "地区"),
    ("全国", "多地区"),
    ("地图", "数据分布图"),
)
DOUBAO_SENSITIVE_INPUT_MESSAGE = (
    "提示词触发了供应商内容安全审核，请调整涉及真实地图、"
    "地区边界或敏感标识的描述后重试，本次不扣创作点数。"
)


def _expand_image_dimensions(
    width: int,
    height: int,
    *,
    minimum_pixels: int,
) -> tuple[int, int]:
    if minimum_pixels <= 0 or width * height >= minimum_pixels:
        return width, height

    scale = math.sqrt(minimum_pixels / (width * height))
    multiple = DOUBAO_IMAGE_DIMENSION_MULTIPLE
    return (
        math.ceil((width * scale) / multiple) * multiple,
        math.ceil((height * scale) / multiple) * multiple,
    )


def normalize_doubao_image_size(
    size: str,
    *,
    minimum_square: Optional[int] = None,
    minimum_pixels: Optional[int] = None,
) -> str:
    value = (size or "").strip().lower().replace("×", "x").replace("*", "x")
    value = re.sub(r"\s+", "", value)
    required_pixels = max(
        int(minimum_pixels or 0),
        int(minimum_square or 0) ** 2,
    )

    if value == "1k":
        width, height = _expand_image_dimensions(
            1024,
            1024,
            minimum_pixels=required_pixels,
        )
        return f"{width}x{height}"
    if value in {"2k", "3k", "4k"}:
        return value

    match = re.fullmatch(r"(\d+)x(\d+)", value)
    if match:
        width = int(match.group(1))
        height = int(match.group(2))
        width, height = _expand_image_dimensions(
            width,
            height,
            minimum_pixels=required_pixels,
        )
        return f"{width}x{height}"

    if minimum_square:
        return f"{minimum_square}x{minimum_square}"
    return "1024x1024"


def normalize_doubao_standard_image_size(size: str) -> str:
    return normalize_doubao_image_size(
        size,
        minimum_pixels=DOUBAO_IMAGE_STANDARD_MIN_PIXELS,
    )


def is_doubao_sensitive_input_error(exc: AIProxyUpstreamError) -> bool:
    error_text = f"{exc.detail} {exc.upstream}".lower()
    return any(marker in error_text for marker in DOUBAO_SENSITIVE_INPUT_MARKERS)


def abstract_doubao_geography_prompt(prompt: str) -> str:
    rewritten = str(prompt or "").strip()
    original = rewritten
    for source, replacement in DOUBAO_ABSTRACT_GEOGRAPHY_REPLACEMENTS:
        rewritten = rewritten.replace(source, replacement)
    if rewritten == original:
        return original
    return f"{rewritten}\n画面仅使用虚构的抽象几何轮廓和装饰性数据点。"


def _doubao_sensitive_input_error(exc: AIProxyUpstreamError) -> AIProxyUpstreamError:
    return AIProxyUpstreamError(
        DOUBAO_SENSITIVE_INPUT_MESSAGE,
        status_code=422,
        upstream=exc.upstream,
    )


def build_doubao_image_payload(
    *,
    prompt: str,
    model: str,
    size: str,
    sequential: str,
    count: int,
    reference_inputs: List[str],
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "size": normalize_doubao_image_size(size),
        "sequential_image_generation": sequential,
        "stream": False,
        "response_format": "b64_json",
        "watermark": False,
    }
    if reference_inputs:
        payload["image"] = reference_inputs[0] if len(reference_inputs) == 1 else reference_inputs
    if sequential == "auto":
        requested = max(1, min(15, int(count or 1)))
        if reference_inputs:
            requested = min(requested, max(1, 15 - len(reference_inputs)))
        payload["sequential_image_generation_options"] = {"max_images": requested}
    return payload


class ReturnedImageList(list):
    """Only a provider response may supply the returned model identity."""
    def __init__(self, images, result):
        super().__init__(images)
        self.actual_model = str(result.get("model") or "").strip()


def parse_doubao_image_response(result: Dict[str, Any]) -> List[str]:
    return ReturnedImageList(parse_openai_image_response(result), result)


def _is_image_value(value: str) -> bool:
    return value.startswith(("http://", "https://", "data:image/"))


def _collect_image_outputs(value: Any, images: List[str]) -> None:
    if isinstance(value, str):
        if _is_image_value(value):
            images.append(value)
        return
    if isinstance(value, list):
        for item in value:
            _collect_image_outputs(item, images)
        return
    if not isinstance(value, dict):
        return

    b64_value = value.get("b64_json") or value.get("image_base64")
    if isinstance(b64_value, str) and b64_value:
        prefix = "" if b64_value.startswith("data:image/") else "data:image/png;base64,"
        images.append(f"{prefix}{b64_value}")

    for key in (
        "url",
        "image_url",
        "image_urls",
        "image",
        "images",
        "output",
        "outputs",
        "result",
        "results",
        "data",
        "content",
    ):
        if key in value:
            _collect_image_outputs(value.get(key), images)


def parse_doubao_image_task_response(result: Dict[str, Any]) -> List[str]:
    images = parse_doubao_image_response(result)
    for key in ("content", "output", "result", "data"):
        _collect_image_outputs(result.get(key), images)

    deduped: List[str] = []
    seen = set()
    for image in images:
        if image and image not in seen:
            seen.add(image)
            deduped.append(image)
    return ReturnedImageList(deduped, result)


def _extract_task_id(result: Dict[str, Any]) -> Optional[str]:
    for key in ("id", "task_id"):
        value = result.get(key)
        if value:
            return str(value)
    for container_key in ("data", "output", "result"):
        container = result.get(container_key)
        if isinstance(container, dict):
            for key in ("id", "task_id"):
                value = container.get(key)
                if value:
                    return str(value)
    return None


def _task_status(result: Dict[str, Any]) -> str:
    for key in ("status", "task_status"):
        value = result.get(key)
        if value:
            return str(value).strip().lower()
    for container_key in ("data", "output", "result"):
        container = result.get(container_key)
        if isinstance(container, dict):
            for key in ("status", "task_status"):
                value = container.get(key)
                if value:
                    return str(value).strip().lower()
    return ""


def _task_error(result: Dict[str, Any]) -> str:
    for key in ("error", "message", "status_message", "task_status_msg"):
        value = result.get(key)
        if value:
            return str(value)
    for container_key in ("data", "output", "result"):
        container = result.get(container_key)
        if isinstance(container, dict):
            nested = _task_error(container)
            if nested:
                return nested
    return str(result)[:500]


def _get_json_request(
    *,
    label: str,
    url: str,
    headers: Dict[str, str],
    timeout: int,
    request_kwargs: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    try:
        validate_provider_endpoint(url)
        options = dict(request_kwargs or {})
        options.setdefault("allow_redirects", False)
        response = requests.get(
            url,
            headers=headers,
            timeout=timeout,
            **options,
        )
        if response.status_code >= 400:
            upstream = redact_sensitive_text(response.text, max_chars=500)
            logger.error("%s upstream failed: status=%s body=%s", label, response.status_code, upstream)
            raise AIProxyUpstreamError(
                f"Doubao image task query failed: {upstream[:200] or response.status_code}",
                status_code=502,
                upstream=upstream,
            )
        try:
            return response.json()
        except ValueError as exc:
            raise AIProxyUpstreamError("Doubao image task response is not valid JSON") from exc
    except AIProxyUpstreamError:
        raise
    except requests.Timeout as exc:
        raise AIProxyUpstreamError("Doubao image task query timed out", status_code=504) from exc
    except requests.RequestException as exc:
        logger.error(
            "%s request failed: %s",
            label,
            redact_sensitive_text(exc, max_chars=300),
            exc_info=True,
        )
        raise AIProxyUpstreamError("Doubao image task query failed") from exc


async def _get_json_request_async(**kwargs: Any) -> Dict[str, Any]:
    return await asyncio.to_thread(_get_json_request, **kwargs)


def _normalize_agent_plan_size(size: str) -> str:
    return normalize_doubao_image_size(size, minimum_square=2048)


def build_doubao_agent_plan_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    prompt = str(payload.get("prompt") or "").strip()
    content: List[Dict[str, Any]] = []
    if prompt:
        content.append({"type": "text", "text": prompt})

    reference_inputs = payload.get("image")
    if isinstance(reference_inputs, str):
        reference_values = [reference_inputs]
    elif isinstance(reference_inputs, list):
        reference_values = [item for item in reference_inputs if isinstance(item, str) and item.strip()]
    else:
        reference_values = []

    for image_url in reference_values:
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": image_url},
                "role": "reference_image",
            }
        )

    if not content:
        content.append({"type": "text", "text": "Generate a simple image."})

    requested_model = str(payload.get("model") or "").strip()
    if requested_model and requested_model != DOUBAO_IMAGE_AGENT_PLAN_MODEL:
        logger.info(
            "Doubao Agent Plan image model forced: requested=%s effective=%s",
            requested_model,
            DOUBAO_IMAGE_AGENT_PLAN_MODEL,
        )

    task_payload: Dict[str, Any] = {
        # Agent Plan content generation only supports the lite model. Keep this
        # guard inside the payload builder so stale DB rows or direct callers
        # cannot submit an incompatible SeedDream model.
        "model": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
        "content": content,
        "size": _normalize_agent_plan_size(str(payload.get("size") or "")),
        "response_format": "url",
        "watermark": bool(payload.get("watermark", False)),
    }
    return {key: value for key, value in task_payload.items() if value is not None}


async def _poll_doubao_image_task(
    *,
    config: Any,
    task_id: str,
    headers: Dict[str, str],
    max_wait: int = 180,
    interval: float = 3.0,
) -> List[str]:
    task_url = config.url_for_operation("task", task_id=task_id)
    deadline = time.monotonic() + max_wait
    last_payload: Dict[str, Any] = {}

    while time.monotonic() < deadline:
        payload = await _get_json_request_async(
            label="Doubao image task query",
            url=task_url,
            headers=headers,
            timeout=30,
            request_kwargs=config.requests_kwargs(),
        )
        last_payload = payload
        images = parse_doubao_image_task_response(payload)
        if images:
            return images

        status = _task_status(payload)
        if status in DOUBAO_IMAGE_TASK_FAILED_STATUSES:
            raise AIProxyUpstreamError(f"Doubao image task failed: {_task_error(payload)[:200]}")
        await asyncio.sleep(interval)

    raise AIProxyUpstreamError(
        f"Doubao image task timed out: task_id={task_id} last_status={_task_status(last_payload) or 'unknown'}",
        status_code=504,
    )


async def _post_doubao_image_task_generation(
    *,
    config: Any,
    payload: Dict[str, Any],
) -> List[str]:
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.api_key}",
    }
    logger.info(
        "Doubao image task create: endpoint=%s model=%s content_items=%s",
        config.url_for(),
        payload.get("model"),
        len(payload.get("content", [])) if isinstance(payload.get("content"), list) else 0,
    )
    result = await _post_json_request_async(
        label="Doubao image task create",
        url=config.url_for(),
        headers=headers,
        payload=payload,
        timeout=120,
        timeout_message="Doubao image task submission timed out, please try again later",
        timeout_status_code=504,
        request_error_message="Doubao image task submission failed, please try again later",
        parse_error_message="Doubao image task response is not valid JSON",
        request_kwargs=config.requests_kwargs(),
        expected_status=200,
        upstream_detail=lambda upstream, _status_code: f"Doubao image task submission failed: {upstream[:200]}",
        upstream_status_code=lambda status: (
            503 if status in {401, 403, 429} or status >= 500 else 422
        ),
    )
    direct_images = parse_doubao_image_task_response(result)
    if direct_images:
        return direct_images
    task_id = _extract_task_id(result)
    if not task_id:
        raise AIProxyUpstreamError(f"Doubao image task response did not include task id: {str(result)[:200]}")
    return await _poll_doubao_image_task(config=config, task_id=task_id, headers=headers)


async def _post_doubao_image_generation_unlocked(
    *,
    config: Any,
    payload: Dict[str, Any],
) -> List[str]:
    if not config.api_key:
        raise AIProxyConfigError("豆包图片服务暂不可用", status_code=503)
    if not config.endpoint:
        raise AIProxyConfigError("豆包图片服务暂不可用", status_code=503)

    is_agent_plan = doubao_image_access_mode(config.endpoint) == "agent_plan"
    if is_agent_plan:
        payload = {
            **payload,
            # Agent Plan image generation only supports the lite model. Force this
            # at the final send boundary so stale DB rows or UI payloads cannot leak
            # a non-compatible SeedDream model into the upstream request.
            "model": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
            "size": _normalize_agent_plan_size(str(payload.get("size") or "")),
            "response_format": "url",
        }
    else:
        payload = {
            **payload,
            "size": normalize_doubao_standard_image_size(str(payload.get("size") or "")),
        }

    result = await _post_json_request_async(
        label="Doubao image",
        url=config.url_for(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {config.api_key}",
        },
        payload=payload,
        timeout=(
            DOUBAO_IMAGE_CONNECT_TIMEOUT,
            DOUBAO_IMAGE_AGENT_PLAN_READ_TIMEOUT if is_agent_plan else DOUBAO_IMAGE_STANDARD_READ_TIMEOUT,
        ),
        timeout_message="生图等待超时，暂未取得结果。请先查看生成历史，勿连续重复提交。",
        upload_timeout=DOUBAO_IMAGE_UPLOAD_TIMEOUT,
        timeout_status_code=504,
        request_error_message="图片生成失败，请稍后重试",
        parse_error_message="豆包响应格式异常",
        request_kwargs=config.requests_kwargs(),
        expected_status=200,
        upstream_detail=lambda upstream, _status_code: f"豆包生成失败: {upstream[:200]}",
        upstream_status_code=lambda status: (
            503 if status in {401, 403, 429} or status >= 500 else 422
        ),
    )
    return parse_doubao_image_response(result)


async def _post_doubao_image_generation(
    *,
    config: Any,
    payload: Dict[str, Any],
) -> List[str]:
    """Keep provider submissions within its configured concurrency contract.

    Waiting requests have not been submitted upstream yet, so they can safely
    follow an in-flight request without creating a duplicate paid generation.
    """
    async with _DOUBAO_IMAGE_SEMAPHORE:
        return await _post_doubao_image_generation_unlocked(config=config, payload=payload)


async def generate_doubao_images(
    *,
    prompt: str,
    reference_inputs: List[str],
    size: str,
    sequential: str,
    count: int,
    model: Optional[str] = None,
    usage_scope: Optional[str] = None,
    seedance_portrait: bool = False,
    reference_purpose: str | None = None,
) -> List[str]:
    if reference_purpose:
        from services.seedance_image_provenance import reference_purpose_prompt
        if reference_inputs or count != 1 or sequential != "disabled":
            raise AIProxyConfigError("真人参考素材仅支持单张纯文生图，不能携带参考图或使用组图。", status_code=422)
        prompt = reference_purpose_prompt(prompt, reference_purpose)
        seedance_portrait = True
    config = (
        resolve_provider("doubao", model, usage_scope=usage_scope)
        if usage_scope is not None
        else resolve_provider("doubao", model)
    )
    resolved_model = normalize_doubao_image_model_for_endpoint(
        config.model_name or model or DOUBAO_IMAGE_DEFAULT_MODEL,
        config.endpoint,
    )
    if "5" in str(model or "") and "pro" in str(model or "").lower() and resolved_model != SEEDREAM_PRO_MODEL:
        raise AIProxyConfigError("当前通道未配置 Seedream 5.0 Pro；请配置官方 Pro 模型，不会自动降级成 Lite。", status_code=422)
    account_binding = ""
    if seedance_portrait:
        try:
            account_binding = validate_portrait_generation(
                config, resolved_model, reference_inputs, usage_scope=usage_scope,
            )
        except SeedanceInputProvenanceError as exc:
            raise AIProxyConfigError(str(exc), status_code=422) from exc
    generated_at = int(time.time())
    resolved_size = (
        _normalize_agent_plan_size(size)
        if doubao_image_access_mode(config.endpoint) == "agent_plan"
        else normalize_doubao_standard_image_size(size)
    )
    payload = build_doubao_image_payload(
        prompt=prompt,
        model=resolved_model,
        size=resolved_size,
        sequential=sequential,
        count=count,
        reference_inputs=reference_inputs,
    )
    try:
        images = await _post_doubao_image_generation(
            config=config,
            payload=payload,
        )
    except AIProxyUpstreamError as exc:
        if not is_doubao_sensitive_input_error(exc):
            raise
        if seedance_portrait:
            raise _doubao_sensitive_input_error(exc) from exc

        abstract_prompt = abstract_doubao_geography_prompt(prompt)
        if abstract_prompt == str(prompt or "").strip():
            raise _doubao_sensitive_input_error(exc) from exc

        logger.warning(
            "Doubao rejected geographic prompt as sensitive; retrying once with abstract wording"
        )
        try:
            images = await _post_doubao_image_generation(
                config=config,
                payload={**payload, "prompt": abstract_prompt},
            )
        except AIProxyUpstreamError as retry_exc:
            if is_doubao_sensitive_input_error(retry_exc):
                raise _doubao_sensitive_input_error(retry_exc) from retry_exc
            raise
    if not images:
        raise AIProxyUpstreamError("豆包未返回图片")
    actual_model = str(getattr(images, "actual_model", "") or "")
    if reference_purpose and (actual_model != resolved_model or len(images) != 1):
        raise AIProxyUpstreamError("未取得匹配的 Seedream 实际模型与单张结果，不能登记为真人文生图素材；请先核查生成历史，勿重复提交。", status_code=422)
    return SeedreamImageBatch(
        images, model=actual_model or resolved_model, endpoint=config.endpoint, api_key=config.api_key,
        reference_count=len(reference_inputs), protected=seedance_portrait, created_at=generated_at,
        account_binding=account_binding,
        purpose=reference_purpose, model_verified=bool(actual_model),
    )
