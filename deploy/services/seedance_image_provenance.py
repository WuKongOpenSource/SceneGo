"""Preserve and verify original Seedream inputs without claiming moderation approval."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from typing import Any
from urllib.parse import urlsplit

from services.api_provider_registry import DOUBAO_IMAGE_STANDARD_ENDPOINT

PROVENANCE_KEY = "seedance_provenance"
TRUST_SECONDS = 30 * 24 * 60 * 60
SEEDREAM_PRO_MODEL = "doubao-seedream-5-0-pro-260628"
SUPPORTED_MODELS = {SEEDREAM_PRO_MODEL, "doubao-seedream-5-0-lite-260128", "doubao-seedream-5.0-lite"}


class SeedanceInputProvenanceError(ValueError):
    """A protected original cannot be submitted under the current credentials."""


def is_official_ark_endpoint(endpoint: str) -> bool:
    try:
        parsed = urlsplit(str(endpoint or ""))
        official = urlsplit(DOUBAO_IMAGE_STANDARD_ENDPOINT)
        return parsed.scheme == "https" and parsed.hostname == official.hostname and parsed.username is None and parsed.password is None and parsed.port in (None, 443)
    except ValueError:
        return False


def _signature(provenance: dict[str, Any], api_key: str) -> str:
    payload = json.dumps(provenance, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hmac.new(api_key.encode(), b"ovideo:seedream-original:v1:" + payload.encode(), hashlib.sha256).hexdigest()


def _account_signature(provenance: dict[str, Any]) -> str:
    secret = str(os.environ.get("SEEDANCE_PROVENANCE_SIGNING_KEY") or os.environ.get("API_CONFIG_ENC_KEY") or "")
    if not secret:
        return ""
    payload = json.dumps(provenance, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hmac.new(secret.encode(), b"ovideo:seedream-original:v2:" + payload.encode(), hashlib.sha256).hexdigest()


def _account_binding(config: Any) -> str:
    extra = getattr(config, "extra", None)
    return str((extra or {}).get("account_binding") or "").strip() if isinstance(extra, dict) else ""


class SeedreamImageBatch(list):
    """Carry server-only provenance across generation and persistence."""

    def __init__(
        self,
        images,
        *,
        model: str,
        endpoint: str,
        api_key: str,
        reference_count: int,
        protected: bool,
        created_at: int,
        account_binding: str = "",
    ):
        super().__init__(images)
        self.model = model
        self.protected = protected
        self._api_key = api_key
        self._account_binding = str(account_binding or "").strip()
        self._provenance = {
            "version": 2 if self._account_binding else 1,
            "model": model,
            "generation_mode": "text_to_image" if reference_count == 0 else "image_to_image",
            "reference_count": reference_count,
            "official_ark": is_official_ark_endpoint(endpoint),
            "created_at": created_at,
            "expires_at": created_at + TRUST_SECONDS,
            "protected": protected,
        }
        if self._account_binding:
            self._provenance["account_binding_sha256"] = hashlib.sha256(self._account_binding.encode()).hexdigest()

    def original_metadata(self, content: bytes) -> dict[str, Any]:
        provenance = {**self._provenance, "sha256": hashlib.sha256(content).hexdigest()}
        signature = (
            _account_signature(provenance)
            if self._account_binding
            else (_signature(provenance, self._api_key) if self._api_key else "")
        )
        return {PROVENANCE_KEY: {**provenance, "signature": signature}}


def validate_portrait_generation(config: Any, model: str, references: list[str], *, usage_scope: str | None) -> str:
    from services.api_provider_runtime import resolve_provider, resolve_seedance_model_name

    if references:
        raise SeedanceInputProvenanceError("Seedance 人像分镜必须使用纯文生图，不能携带参考图；请关闭此模式后使用图生图。")
    if model not in SUPPORTED_MODELS or not is_official_ark_endpoint(config.endpoint):
        raise SeedanceInputProvenanceError("Seedance 人像分镜需要火山方舟官方 Seedream 5.0 Lite/Pro 接口，不支持第三方转发通道。")
    video_model = resolve_seedance_model_name("standard", usage_scope=usage_scope or "workflow")
    video_config = resolve_provider("seedance", video_model, usage_scope=usage_scope or "workflow")
    if not config.api_key or not video_config.api_key or not is_official_ark_endpoint(video_config.endpoint):
        raise SeedanceInputProvenanceError("Seedream 生图或 Seedance 视频通道未完整配置，本次未提交生成。")
    image_binding = _account_binding(config)
    video_binding = _account_binding(video_config)
    same_key = hmac.compare_digest(config.api_key, video_config.api_key)
    same_binding = bool(image_binding and video_binding and hmac.compare_digest(image_binding, video_binding))
    if not same_key and not same_binding:
        raise SeedanceInputProvenanceError("请为同一火山账号下的 Seedream Plan/按量付费通道与 Seedance 通道配置相同的账号绑定标识；本次未提交生成。")
    if same_binding and not _account_signature({"preflight": True}):
        raise SeedanceInputProvenanceError("可信原图签名服务尚未配置，本次未提交生成。")
    return image_binding if same_binding else ""


def verify_original(
    provenance: dict[str, Any],
    content: bytes,
    *,
    api_key: str,
    endpoint: str,
    account_binding: str = "",
    now: float | None = None,
) -> None:
    signature = str(provenance.get("signature") or "")
    signed = {key: value for key, value in provenance.items() if key != "signature"}
    signature_well_formed = (
        len(signature) == 64
        and all(char in "0123456789abcdef" for char in signature)
    )
    version = signed.get("version")
    binding = str(account_binding or "").strip()
    if version == 2:
        expected_binding = hashlib.sha256(binding.encode()).hexdigest() if binding else ""
        expected_signature = _account_signature(signed)
        signature_valid = bool(
            signature_well_formed
            and
            binding
            and expected_signature
            and hmac.compare_digest(str(signed.get("account_binding_sha256") or ""), expected_binding)
            and hmac.compare_digest(signature, expected_signature)
        )
    else:
        signature_valid = bool(
            signature_well_formed
            and api_key
            and hmac.compare_digest(signature, _signature(signed, api_key))
        )
    if not is_official_ark_endpoint(endpoint) or not signature_valid:
        raise SeedanceInputProvenanceError("Seedance 原图来源校验失败：当前视频 API Key 与生图时不一致或来源记录已改变；请核对同账号配置，勿反复重试。")
    if version not in (1, 2) or signed.get("model") not in SUPPORTED_MODELS or signed.get("official_ark") is not True or signed.get("generation_mode") != "text_to_image" or signed.get("reference_count") != 0:
        raise SeedanceInputProvenanceError("该图片不符合 Seedream 5.0 Lite/Pro 纯文生图原始产物要求。")
    current = time.time() if now is None else now
    created = signed.get("created_at")
    if not isinstance(created, int) or created > current + 60 or current >= created + TRUST_SECONDS or signed.get("expires_at") != created + TRUST_SECONDS:
        raise SeedanceInputProvenanceError("Seedance 分镜原图已超过 30 天受信期，或生成时间无效；请重新生成分镜。")
    if not hmac.compare_digest(str(signed.get("sha256") or ""), hashlib.sha256(content).hexdigest()):
        raise SeedanceInputProvenanceError("Seedance 分镜原图已被压缩或修改，不能再作为该原始产物提交；请重新生成分镜。")
