"""Opt-in character/background references; never infer trust from client labels."""
from __future__ import annotations

import asyncio
import base64
import json
import hmac
import re
from types import SimpleNamespace
from typing import Any

from services.seedance_image_provenance import (
    PROVENANCE_KEY, SeedanceInputProvenanceError, verify_original,
    PORTRAIT_VIDEO_MODELS, resolve_portrait_video_config,
    SUPPORTED_MODELS, is_official_ark_endpoint,
)
from services.generation_access_service import GenerationAccessDenied, require_generation_request_access
from services.media_reference_service import resolve_media_file_record
from services.provider_media_input_service import (
    DEFAULT_MAX_PROVIDER_IMAGE_BYTES, _read_local_record, _validated_image_payload,
)


async def _require_current_model_access(user_id, task_type, data):
    from dao_user import UserDAO
    from fastapi import HTTPException
    from services.model_access_service import require_user_model_access
    try:
        await require_user_model_access(user_id, user_dao=UserDAO, task_type=task_type, task_data=data)
    except HTTPException as exc:
        raise SeedanceInputProvenanceError("当前账户已无权使用该生成模型，本次未提交。") from exc


class PortraitReferenceIssue(SeedanceInputProvenanceError):
    def __init__(self, message: str, *, status: str = "unverified"):
        super().__init__(message)
        self.status = status


def _portrait_proof(record: dict[str, Any] | None) -> dict[str, Any]:
    metadata = (record or {}).get("metadata") or {}
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (ValueError, TypeError):
            metadata = {}
    if not isinstance(metadata, dict):
        metadata = {}
    proof = metadata.get(PROVENANCE_KEY)
    if not isinstance(proof, dict):
        if metadata.get("source") in {"upload", "uploaded", "gemini", "gpt", "gpt-image-vip", "gpt-image-official"}:
            raise PortraitReferenceIssue("不是已登记的 Seedream 文生图原图", status="unsupported")
        raise PortraitReferenceIssue("原图来源记录不完整，未判定为不支持；请保留素材并核查来源")
    if proof.get("generation_mode") == "image_to_image":
        raise PortraitReferenceIssue("图生图不能用于仿真人参考", status="unsupported")
    # Historical signed originals predate model_verified. The server's matching
    # generation snapshot is required; an explicit false is never promoted.
    legacy = ("model_verified" not in proof and proof.get("version") in (1, 2)
              and metadata.get("source") == "doubao" and metadata.get("model") == proof.get("model")
              and metadata.get("reference_snapshot") == [])
    if proof.get("model_verified") is not True and not legacy:
        raise PortraitReferenceIssue("实际生图模型尚未核实，素材已保留，请核查生成记录")
    # purpose/protected describe a generation entry point, not original identity.
    # Never fabricate those fields for historical images. Signature, model, zero
    # references, account, age and bytes remain mandatory in verify_original.
    return proof


async def _read_portrait_original(record):
    proof = _portrait_proof(record)
    try:
        content = await asyncio.to_thread(_read_local_record, record, max_bytes=DEFAULT_MAX_PROVIDER_IMAGE_BYTES)
        payload, _, mime = await asyncio.to_thread(_validated_image_payload, content)
    except Exception as exc:
        raise PortraitReferenceIssue("参考原图无法读取或格式无效，素材已保留；不会压缩后重试") from exc
    return proof, content, payload, mime


def _verify_portrait_original(proof, content, config, *, scope):
    binding = str((getattr(config, "extra", None) or {}).get("account_binding") or "").strip()
    try:
        verify_original(proof, content, api_key=config.api_key, endpoint=config.endpoint, account_binding=binding)
    except SeedanceInputProvenanceError as original_error:
        # Old v1 records are signed with the image key. Distinct image/video keys
        # may belong to the same explicitly configured account. Verify the old
        # signature with that image key without minting/upgrading any provenance.
        if proof.get("version") != 1 or not binding:
            raise
        from services.api_provider_runtime import resolve_provider
        image_config = resolve_provider("doubao", proof.get("model"), usage_scope=scope)
        image_binding = str((getattr(image_config, "extra", None) or {}).get("account_binding") or "").strip()
        if (not image_binding or not hmac.compare_digest(binding, image_binding)
                or not image_config.api_key or image_config.model_name not in SUPPORTED_MODELS
                or not is_official_ark_endpoint(image_config.endpoint)):
            raise original_error
        verify_original(proof, content, api_key=image_config.api_key, endpoint=config.endpoint)


async def portrait_reference_badge(record: dict[str, Any] | None, *, sub_model: str | None = None) -> dict[str, Any]:
    """Read-only original eligibility, after caller checks file access.

    This does not grant model access or claim provider moderation approval.
    Submission uses the same proof checks and rechecks permissions/current bytes.
    """
    try:
        proof, content, _, _ = await _read_portrait_original(record)
    except PortraitReferenceIssue as exc:
        return {"portrait_reference_status": exc.status, "portrait_reference_reason": str(exc)}
    scopes = []
    models = [sub_model] if sub_model else PORTRAIT_VIDEO_MODELS
    reason = "所选视频通道尚未通过来源校验，素材已保留，请核查配置"
    for scope in ("workflow", "studio"):
        for selected_model in models:
            try:
                config = resolve_portrait_video_config(selected_model, usage_scope=scope)
                _verify_portrait_original(proof, content, config, scope=scope)
                scopes.append(scope)
                break
            except SeedanceInputProvenanceError as exc:
                reason = str(exc)
            except Exception:
                # A star requires at least one configured variant; submission rechecks the selected variant.
                continue
    return ({"portrait_reference_status": "eligible", "portrait_reference_scopes": scopes,
             "portrait_reference_expires_at": proof["expires_at"], "file_id": record.get("file_id")}
            if scopes else {"portrait_reference_status": "unverified", "portrait_reference_reason": reason})


async def validate_portrait_references(task_type: str, data: dict[str, Any], user_id: str, *, file_dao=None, prepare=False) -> dict[int, str]:
    mode = data.get("portrait_reference_mode")
    if not mode:
        return {}
    if (mode != "character_background" or task_type not in {"seedance_i2v", "seedance_multi"}
            or data.get("sub_model") not in PORTRAIT_VIDEO_MODELS or data.get("reference_mode") != "reference"):
        raise SeedanceInputProvenanceError("仿真人参考仅支持 Seedance 2.0、Fast、Mini 的全能参考。")
    inputs = data.get("media_inputs") or []
    images = [(index, item) for index, item in enumerate(inputs) if isinstance(item, dict) and item.get("kind") == "image"]
    if not 2 <= len(images) <= 9:
        raise SeedanceInputProvenanceError("请选择 2 至 9 张通过来源校验的 Seedream 文生图原图，人物和背景按镜头需要搭配。")
    if any(not isinstance(item, dict) or item.get("kind") not in {"image", "audio"} for item in inputs):
        raise SeedanceInputProvenanceError("此真人参考模式只接受已登记的文生图和参考配音，不接受参考视频。")
    if any(item.get("role") not in (None, "reference_image") for _, item in images):
        raise SeedanceInputProvenanceError("仿真人模式需要全能参考图片，不能使用首尾帧角色。")
    if not user_id:
        raise SeedanceInputProvenanceError("登录状态无效，请重新登录后选择参考素材。")
    await _require_current_model_access(user_id, task_type, data)
    if file_dao is None:
        from dao_content import FileDAO
        file_dao = FileDAO
    resolved = []
    for index, item in images:
        file_id = str(item.get("file_id") or "").strip()
        url = str(item.get("url") or "").strip()
        if file_id and not re.fullmatch(r"[A-Za-z0-9_-]{6,80}", file_id):
            raise SeedanceInputProvenanceError(f"图片{len(resolved) + 1}的文件标识无效，素材未修改。")
        if not file_id and (not url or url.lower().startswith(("data:", "blob:"))):
            raise SeedanceInputProvenanceError("临时图片没有已登记的原图记录，不能作为仿真人参考。")
        record = await resolve_media_file_record(file_id or url, file_dao)
        if not record:
            raise SeedanceInputProvenanceError("参考原图记录不存在或已失效，素材未修改。")
        if url:
            other = await resolve_media_file_record(url, file_dao)
            if not other or other.get("file_id") != record["file_id"]:
                raise SeedanceInputProvenanceError("参考图地址与文件标识不一致，素材未修改。")
        resolved.append((index, item, record))
    try:
        await require_generation_request_access(SimpleNamespace(**data), user_id,
            [str(record['file_id']) for _, _, record in resolved], file_dao=file_dao)
    except GenerationAccessDenied as exc:
        raise SeedanceInputProvenanceError("参考素材不存在或无权访问，请重新选择。") from exc
    config = resolve_portrait_video_config(data['sub_model'], usage_scope=data.get("model_scope") or "workflow")
    prepared = {}
    canonical = list(inputs)
    for number, (index, item, record) in enumerate(resolved, 1):
        try:
            provenance, content, payload, mime = await _read_portrait_original(record)
            _verify_portrait_original(provenance, content, config, scope=data.get("model_scope") or "workflow")
        except SeedanceInputProvenanceError as exc:
            raise SeedanceInputProvenanceError(f"图片{number}：{exc}") from exc
        canonical[index] = {**item, "file_id": record["file_id"], "role": "reference_image"}
        if prepare:
            prepared[index] = f"data:{mime};base64,{base64.b64encode(payload).decode('ascii')}"
    # Commit normalization only after the entire request passes; never rewrite
    # file metadata, source bytes, saved cards or prompts during verification.
    data["media_inputs"] = canonical
    return prepared


async def preflight_portrait_references(task_type: str, data: dict[str, Any], user_id: str) -> None:
    from fastapi import HTTPException
    try:
        await validate_portrait_references(task_type, data, user_id)
    except SeedanceInputProvenanceError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
