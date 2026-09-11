"""GPT Image provider helpers for AI proxy calls."""
from __future__ import annotations

import io
import json
import logging
import time
from typing import Any, Dict, List, Optional

from services.api_provider_registry import get_gpt_image_tier, get_gpt_image_tiers
from services.api_provider_runtime import resolve_provider
from services.ai_proxy_http_client import _post_form_request_async, _post_json_request_async
from services.ai_proxy_openai_image_service import parse_openai_image_response
from services.ai_proxy_types import (
    AIProxyConfigError,
    AIProxyError,
    AIProxyUpstreamError,
    GptImageReferenceInput,
)

logger = logging.getLogger(__name__)
_GPT_IMAGE_QUOTA_BLOCKED_UNTIL: Dict[str, float] = {}
_GPT_IMAGE_QUOTA_COOLDOWN_SECONDS = 30 * 60


def resolve_gpt_image_tier_config(tier: Optional[str]) -> tuple[str, Dict[str, Any]]:
    try:
        return get_gpt_image_tier(tier)
    except KeyError as exc:
        expected = "|".join(sorted(get_gpt_image_tiers()))
        raise AIProxyError(f"Unsupported tier: {tier} (expected {expected})", status_code=400) from exc


def normalize_gpt_image_tier(tier: Optional[str]) -> str:
    resolved_tier, _ = resolve_gpt_image_tier_config(tier)
    return resolved_tier


def build_gpt_image_generation_payload(
    *,
    model: str,
    prompt: str,
    n: int,
    size: Optional[str],
    quality: Optional[str],
) -> Dict[str, Any]:
    return {
        "model": model,
        "prompt": prompt,
        "n": max(1, min(4, n or 1)),
        "size": size or "auto",
        "quality": quality or "auto",
    }


def build_gpt_image_edit_data(
    *,
    model: str,
    prompt: str,
    n: int,
    size: Optional[str],
    quality: Optional[str],
) -> Dict[str, str]:
    payload = build_gpt_image_generation_payload(
        model=model,
        prompt=prompt,
        n=n,
        size=size,
        quality=quality,
    )
    return {key: str(value) for key, value in payload.items()}


def _ensure_gpt_image_config(config: Any, key_hint: str) -> None:
    if not config.api_key:
        raise AIProxyConfigError(f"图像生成服务未配置 {key_hint}，请管理员在后台填入 API Key")
    if not config.endpoint:
        raise AIProxyConfigError(f"图像生成服务 endpoint 未配置 {key_hint}，请管理员在后台填入 endpoint")


def _gpt_image_quota_exhausted(_upstream: str) -> bool:
    try:
        error = json.loads(_upstream).get("error", {})
        if not isinstance(error, dict):
            error = {}
    except (ValueError, AttributeError, TypeError):
        error = {}
    code = str(error.get("code") or "").lower()
    message = str(error.get("message") or "").lower()
    return code in ("insufficient_user_quota", "insufficient_quota", "insufficient_token_quota", "insufficient_balance") or (
        "preconsumedquota" in message and "not enough" in message
    )


def _gpt_image_upstream_detail(_upstream: str, status_code: int) -> str:
    # Billing failures may use 403; do not label them as invalid credentials.
    if _gpt_image_quota_exhausted(_upstream):
        return "上游图像服务余额或配额不足，请管理员补充供应商余额或检查令牌额度；不是本站积分不足"
    if status_code in (401, 403):
        return f"上游图像服务鉴权或模型权限失败 ({status_code})，请管理员检查 API Key 和模型权限"
    return f"上游图像生成失败 ({status_code})，请检查 API Key 或稍后重试"


def _gpt_image_upstream_status(upstream: str, _status_code: int) -> int:
    # Keep this actionable business condition below 500 so the global safe
    # error handler can return the already-redacted administrator guidance.
    return 402 if _gpt_image_quota_exhausted(upstream) else 502


def gpt_image_tier_capability(tier: Optional[str]) -> Dict[str, Any]:
    resolved_tier, tier_config = resolve_gpt_image_tier_config(tier)
    blocked_until = _GPT_IMAGE_QUOTA_BLOCKED_UNTIL.get(resolved_tier, 0)
    if blocked_until > time.time():
        return {
            "available": False,
            "reason": "上游供应商余额或配额不足，请管理员补充后再使用",
        }
    config = resolve_provider(tier_config["provider"], tier_config["model"])
    if not config.api_key or not config.endpoint:
        return {"available": False, "reason": "当前模型通道未配置或已停用"}
    return {"available": True, "reason": ""}


async def _post_gpt_image_edit_request(
    *,
    config: Any,
    model: str,
    prompt: str,
    references: List[GptImageReferenceInput],
    n: int,
    size: Optional[str],
    quality: Optional[str],
    resolved_tier: str,
) -> Dict[str, Any]:
    data = build_gpt_image_edit_data(
        model=model,
        prompt=prompt,
        n=n,
        size=size,
        quality=quality,
    )
    files = [
        ("image[]", (ref.filename, io.BytesIO(ref.content), ref.mime_type))
        for ref in references
    ]
    logger.info(
        "GPT Image edit -> tier=%s model=%s refs=%s size=%s quality=%s",
        resolved_tier,
        model,
        len(references),
        data["size"],
        data["quality"],
    )
    return await _post_form_request_async(
        label="GPT Image edit",
        url=config.url_for_operation("image_edits"),
        headers={"Authorization": f"Bearer {config.api_key}"},
        data=data,
        files=files,
        timeout=240,
        timeout_message="图像生成超时，请稍后重试",
        request_error_message="图像生成失败，请稍后重试",
        parse_error_message="GPT Image 响应格式异常",
        request_kwargs=config.requests_kwargs(),
        upstream_detail=_gpt_image_upstream_detail,
        upstream_status_detail=_gpt_image_upstream_status,
    )


async def _post_gpt_image_generation_request(
    *,
    config: Any,
    model: str,
    prompt: str,
    n: int,
    size: Optional[str],
    quality: Optional[str],
    resolved_tier: str,
) -> Dict[str, Any]:
    payload = build_gpt_image_generation_payload(
        model=model,
        prompt=prompt,
        n=n,
        size=size,
        quality=quality,
    )
    logger.info(
        "GPT Image generate -> tier=%s model=%s size=%s quality=%s",
        resolved_tier,
        model,
        payload["size"],
        payload["quality"],
    )
    return await _post_json_request_async(
        label="GPT Image generate",
        url=config.url_for_operation("image_generations"),
        headers={
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        },
        payload=payload,
        timeout=240,
        timeout_message="图像生成超时，请稍后重试",
        request_error_message="图像生成失败，请稍后重试",
        parse_error_message="GPT Image 响应格式异常",
        request_kwargs=config.requests_kwargs(),
        upstream_detail=_gpt_image_upstream_detail,
        upstream_status_detail=_gpt_image_upstream_status,
    )


async def generate_gpt_images(
    *,
    tier: Optional[str],
    prompt: str,
    references: List[GptImageReferenceInput],
    n: int,
    size: Optional[str] = "auto",
    quality: Optional[str] = "auto",
) -> tuple[List[str], str, str]:
    resolved_tier, tier_config = resolve_gpt_image_tier_config(tier)
    provider = tier_config["provider"]
    model = tier_config["model"]
    key_hint = tier_config["key_hint"]

    blocked_until = _GPT_IMAGE_QUOTA_BLOCKED_UNTIL.get(resolved_tier, 0)
    if blocked_until > time.time():
        raise AIProxyConfigError(
            "上游图像服务余额或配额不足，请管理员补充供应商余额或检查令牌额度；不是本站积分不足",
            status_code=402,
        )

    config = resolve_provider(provider, model)
    _ensure_gpt_image_config(config, key_hint)
    try:
        if references:
            result = await _post_gpt_image_edit_request(
                config=config,
                model=model,
                prompt=prompt,
                references=references,
                n=n,
                size=size,
                quality=quality,
                resolved_tier=resolved_tier,
            )
        else:
            result = await _post_gpt_image_generation_request(
                config=config,
                model=model,
                prompt=prompt,
                n=n,
                size=size,
                quality=quality,
                resolved_tier=resolved_tier,
            )
    except AIProxyUpstreamError as exc:
        if exc.status_code == 402:
            _GPT_IMAGE_QUOTA_BLOCKED_UNTIL[resolved_tier] = time.time() + _GPT_IMAGE_QUOTA_COOLDOWN_SECONDS
        raise

    images = parse_openai_image_response(result)
    if not images:
        raise AIProxyUpstreamError("GPT Image 未返回图片")
    return images, model, resolved_tier
