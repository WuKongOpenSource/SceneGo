"""Preserve and verify original Seedream inputs without claiming moderation approval."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time
from typing import Any
from urllib.parse import urlsplit

from services.api_provider_registry import DOUBAO_IMAGE_STANDARD_ENDPOINT, SEEDANCE_DEFAULT_MODEL_MAP

PROVENANCE_KEY = "seedance_provenance"
TRUST_SECONDS = 30 * 24 * 60 * 60
SEEDREAM_PRO_MODEL = "doubao-seedream-5-0-pro-260628"
SUPPORTED_MODELS = {SEEDREAM_PRO_MODEL, "doubao-seedream-5-0-lite-260128", "doubao-seedream-5.0-lite"}
REFERENCE_PURPOSES = {"character_four_view", "pure_background"}
PORTRAIT_VIDEO_MODELS = {key: SEEDANCE_DEFAULT_MODEL_MAP[key] for key in ("standard", "fast", "mini")}


def resolve_portrait_video_config(sub_model: str, *, usage_scope: str | None = None):
    """Keep the selected variant and official channel fixed; never fall back."""
    from services.api_provider_runtime import resolve_provider, resolve_seedance_model_name
    expected = PORTRAIT_VIDEO_MODELS.get(sub_model)
    if not expected:
        raise SeedanceInputProvenanceError("仿真人参考仅支持 Seedance 2.0、Fast、Mini 的全能参考。")
    model = resolve_seedance_model_name(sub_model, usage_scope=usage_scope or "workflow")
    config = resolve_provider("seedance", model, usage_scope=usage_scope or "workflow")
    if model != expected or config.model_name != expected or not config.api_key or not is_official_ark_endpoint(config.endpoint):
        raise SeedanceInputProvenanceError("所选 Seedance 2.0 通道未正确配置或模型不匹配，本次未提交。")
    return config


def reference_purpose_prompt(prompt: str, purpose: str) -> str:
    if purpose not in REFERENCE_PURPOSES:
        raise SeedanceInputProvenanceError("不支持的真人参考素材用途。")
    instruction = (
        "生成一张人物四视图：同一个成年人物的正面、左侧面、右侧面、背面并排呈现，人物身份、服装与比例一致，干净纯色底，不含文字、水印和其他人物。"
        if purpose == "character_four_view" else
        "生成一张纯背景场景图：只呈现场景、建筑、环境与道具，不出现人物、人脸、人体、人物剪影、镜中人或人物海报，不含文字和水印。"
    )
    return f"{prompt.strip()}\n\n【参考素材规格】{instruction}"


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


def _verified_source_provenance(metadata: Any) -> dict[str, Any]:
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (ValueError, TypeError):
            return {}
    provenance = metadata.get(PROVENANCE_KEY) if isinstance(metadata, dict) else None
    if not isinstance(provenance, dict):
        return {}
    count = provenance.get("reference_count")
    if (provenance.get("model") not in SUPPORTED_MODELS or provenance.get("official_ark") is not True
            or type(count) is not int or count < 0
            or provenance.get("generation_mode") != ("text_to_image" if count == 0 else "image_to_image")):
        return {}
    signature = str(provenance.get("signature") or "")
    if len(signature) != 64 or any(char not in '0123456789abcdef' for char in signature):
        return {}
    signed = {key: value for key, value in provenance.items() if key != "signature"}
    valid = False
    if provenance.get("version") == 2:
        expected = _account_signature(signed)
        valid = bool(expected and hmac.compare_digest(signature, expected))
    elif provenance.get("version") == 1:
        from services.api_provider_runtime import resolve_provider
        for scope in ("workflow", "studio"):
            try:
                config = resolve_provider("doubao", provenance["model"], usage_scope=scope)
                if config.api_key and is_official_ark_endpoint(config.endpoint):
                    valid = hmac.compare_digest(signature, _signature(signed, config.api_key))
            except Exception:
                continue
            if valid:
                break
    if not valid:
        return {}
    return provenance


def verified_text_to_image_source(metadata: Any) -> dict[str, str]:
    """A display label is not video eligibility (age/purpose/access/hash)."""
    provenance = _verified_source_provenance(metadata)
    if provenance.get("model_verified") is not True or provenance.get("generation_mode") != "text_to_image":
        return {}
    label = "Seedream 5.0 Pro" if provenance["model"] == SEEDREAM_PRO_MODEL else "Seedream 5.0 Lite"
    result = {"label": f"{label} · 文生图"}
    if provenance.get("purpose") in REFERENCE_PURPOSES:
        result["purpose"] = provenance["purpose"]
    return result


def image_generation_source(metadata: Any) -> dict[str, str]:
    """Display recorded input mode only; never grant portrait eligibility."""
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (ValueError, TypeError):
            return {}
    if not isinstance(metadata, dict):
        return {}
    if PROVENANCE_KEY in metadata:
        proof = _verified_source_provenance(metadata)
        if not proof:
            return {}
        mode = proof["generation_mode"]
        model = proof["model"]
    else:
        # These snapshots are persisted by image-generation routes. Missing
        # snapshots, uploads, prompts and browser-supplied model names are not evidence.
        if metadata.get("source") in {"upload", "uploaded"}:
            return {"display_label": "外部上传 · 来源待确认"}
        snapshot = metadata.get("reference_snapshot")
        mode = ""
        if metadata.get("source") in {"doubao", "gemini", "gpt", "gpt-image-vip", "gpt-image-official"} and isinstance(snapshot, list):
            count = metadata.get("ref_count", len(snapshot))
            if type(count) is int and count >= 0 and count == len(snapshot):
                mode = "text_to_image" if count == 0 else "image_to_image"
        model = str(metadata.get("model") or metadata.get("storyboard_generation_model") or "")
    model_label = ""
    if re.fullmatch(r"doubao-seedream-[a-zA-Z0-9.\-]+", model):
        version = re.search(r"seedream-(\d)[.-](\d)", model)
        model_label = "Seedream" + (f" {version[1]}.{version[2]}" if version else "")
        model_label += " Pro" if "-pro" in model else " Lite" if "-lite" in model else ""
    elif model in {"gpt-image-2", "gpt-image-2-vip"}:
        model_label = "GPT Image 2" + (" VIP" if model.endswith('-vip') else "")
    elif re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._\-]{0,79}", model):
        model_label = model.replace('gemini-', 'Gemini ').replace('-preview', ' Preview')
    mode_label = "文生图" if mode == "text_to_image" else "图生图" if mode == "image_to_image" else ""
    if not model_label and not mode_label:
        return {}
    result = {"model_label": model_label, "display_label": f"{model_label or '模型未记录'} · {mode_label or '方式待确认'}"}
    if mode_label:
        result.update(generation_mode=mode, mode_label=mode_label)
    return result


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
        purpose: str | None = None,
        model_verified: bool = False,
    ):
        super().__init__(images)
        self.model = model
        self.protected = protected
        self.model_verified = model_verified
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
        # Optional signed fields keep existing v1/v2 originals verifiable. Old
        # signatures are never upgraded into purpose-qualified references.
        self._provenance["model_verified"] = model_verified
        if purpose:
            if purpose not in REFERENCE_PURPOSES or reference_count or not model_verified:
                raise SeedanceInputProvenanceError("真人参考素材必须为已核实模型的纯文生图。")
            self._provenance["purpose"] = purpose

    def original_metadata(self, content: bytes) -> dict[str, Any]:
        provenance = {**self._provenance, "sha256": hashlib.sha256(content).hexdigest()}
        signature = (
            _account_signature(provenance)
            if self._account_binding
            else (_signature(provenance, self._api_key) if self._api_key else "")
        )
        return {PROVENANCE_KEY: {**provenance, "signature": signature}}


def validate_portrait_generation(config: Any, model: str, references: list[str], *, usage_scope: str | None) -> str:
    if references:
        raise SeedanceInputProvenanceError("Seedance 人像分镜必须使用纯文生图，不能携带参考图；请关闭此模式后使用图生图。")
    if model not in SUPPORTED_MODELS or not is_official_ark_endpoint(config.endpoint):
        raise SeedanceInputProvenanceError("Seedance 人像分镜需要火山方舟官方 Seedream 5.0 Lite/Pro 接口，不支持第三方转发通道。")
    if not config.api_key:
        raise SeedanceInputProvenanceError("Seedream 生图或 Seedance 视频通道未完整配置，本次未提交生成。")
    image_binding = _account_binding(config)
    for sub_model in PORTRAIT_VIDEO_MODELS:
        try:
            video_config = resolve_portrait_video_config(sub_model, usage_scope=usage_scope)
        except Exception:
            continue
        video_binding = _account_binding(video_config)
        same_key = hmac.compare_digest(config.api_key, video_config.api_key)
        same_binding = bool(image_binding and video_binding and hmac.compare_digest(image_binding, video_binding))
        if same_binding:
            if not _account_signature({"preflight": True}):
                raise SeedanceInputProvenanceError("可信原图签名服务尚未配置，本次未提交生成。")
            return image_binding
        if same_key:
            return ""
    raise SeedanceInputProvenanceError("请配置同账号的 Seedream 与 Seedance 2.0、Fast 或 Mini 官方通道及可信账号绑定；本次未提交生成。")


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
    if version not in (1, 2) or signed.get("model") not in SUPPORTED_MODELS or signed.get("official_ark") is not True or signed.get("generation_mode") != "text_to_image" or type(signed.get("reference_count")) is not int or signed.get("reference_count") != 0:
        raise SeedanceInputProvenanceError("该图片不符合 Seedream 5.0 Lite/Pro 纯文生图原始产物要求。")
    current = time.time() if now is None else now
    created = signed.get("created_at")
    if not isinstance(created, int) or created > current + 60 or current >= created + TRUST_SECONDS or signed.get("expires_at") != created + TRUST_SECONDS:
        raise SeedanceInputProvenanceError("Seedance 分镜原图已超过 30 天受信期，或生成时间无效；请重新生成分镜。")
    if not hmac.compare_digest(str(signed.get("sha256") or ""), hashlib.sha256(content).hexdigest()):
        raise SeedanceInputProvenanceError("Seedance 分镜原图已被压缩或修改，不能再作为该原始产物提交；请重新生成分镜。")
