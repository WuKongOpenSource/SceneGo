"""Opt-in character/background references; never infer trust from client labels."""
from __future__ import annotations

import asyncio
import base64
import json
import re
from types import SimpleNamespace
from typing import Any

from services.seedance_image_provenance import (
    PROVENANCE_KEY, REFERENCE_PURPOSES, SeedanceInputProvenanceError, verify_original,
    PORTRAIT_VIDEO_MODELS, resolve_portrait_video_config,
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


async def portrait_reference_badge(record: dict[str, Any] | None) -> dict[str, Any]:
    """Read-only original eligibility, after caller checks file access.

    This does not grant model access or claim provider moderation approval.
    Submission still validates the chosen mode, purpose pair and current bytes.
    """
    from services.seedance_image_provenance import verified_text_to_image_source

    metadata = (record or {}).get("metadata") or {}
    if not verified_text_to_image_source(metadata):
        return {}
    if isinstance(metadata, str):
        metadata = json.loads(metadata)
    proof = metadata[PROVENANCE_KEY]
    if proof.get("protected") is not True:
        return {}
    try:
        content = await asyncio.to_thread(_read_local_record, record, max_bytes=DEFAULT_MAX_PROVIDER_IMAGE_BYTES)
        await asyncio.to_thread(_validated_image_payload, content)
    except Exception:
        return {}
    scopes = []
    for scope in ("workflow", "studio"):
        for sub_model in PORTRAIT_VIDEO_MODELS:
            try:
                config = resolve_portrait_video_config(sub_model, usage_scope=scope)
                verify_original(proof, content, api_key=config.api_key, endpoint=config.endpoint,
                    account_binding=str((getattr(config, "extra", None) or {}).get("account_binding") or ""))
                scopes.append(scope)
                break
            except Exception:
                # A star requires at least one configured variant; submission rechecks the selected variant.
                continue
    return {"portrait_reference_scopes": scopes, "portrait_reference_expires_at": proof["expires_at"]} if scopes else {}


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
        raise SeedanceInputProvenanceError("请至少选择一张人物四视图和一张纯背景文生图，最多 9 张。")
    if any(not isinstance(item, dict) or item.get("kind") not in {"image", "audio"} for item in inputs):
        raise SeedanceInputProvenanceError("此真人参考模式只接受已登记的文生图和参考配音，不接受参考视频。")
    if any(not re.fullmatch(r"[A-Za-z0-9_-]{6,80}", str(item.get("file_id") or "")) or item.get("role") not in (None, "reference_image") for _, item in images):
        raise SeedanceInputProvenanceError("请选择已登记的原始文生图；临时图片、上传图及首尾帧不能作为真人全能参考。")
    if not user_id:
        raise SeedanceInputProvenanceError("登录状态无效，请重新登录后选择参考素材。")
    await _require_current_model_access(user_id, task_type, data)
    if file_dao is None:
        from dao_content import FileDAO
        file_dao = FileDAO
    try:
        await require_generation_request_access(SimpleNamespace(**data), user_id,
            [str(item['file_id']) for _, item in images], file_dao=file_dao)
    except GenerationAccessDenied as exc:
        raise SeedanceInputProvenanceError("参考素材不存在或无权访问，请重新选择。") from exc
    config = resolve_portrait_video_config(data['sub_model'], usage_scope=data.get("model_scope") or "workflow")
    purposes = set()
    prepared = {}
    for index, item in images:
        record = await file_dao.get_file(item["file_id"])
        if not record:
            raise SeedanceInputProvenanceError("参考原图已失效，请重新选择。")
        url = str(item.get("url") or "")
        if url:
            other = await resolve_media_file_record(url, file_dao)
            if not other or other.get("file_id") != item["file_id"]:
                raise SeedanceInputProvenanceError("参考图与原始文件记录不一致，请重新选择原图。")
        metadata = record.get("metadata") or {}
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except (ValueError, TypeError):
                metadata = {}
        provenance = metadata.get(PROVENANCE_KEY) if isinstance(metadata, dict) else None
        if (not isinstance(provenance, dict) or provenance.get("purpose") not in REFERENCE_PURPOSES
                or provenance.get("model_verified") is not True or provenance.get("protected") is not True):
            raise SeedanceInputProvenanceError("此图片没有可信文生图用途记录。图生图、上传图及旧图片不能补标，请从人物四视图或纯背景入口重新生成。")
        try:
            content = await asyncio.to_thread(_read_local_record, record, max_bytes=DEFAULT_MAX_PROVIDER_IMAGE_BYTES)
            verify_original(provenance, content, api_key=config.api_key, endpoint=config.endpoint,
                account_binding=str((getattr(config, "extra", None) or {}).get("account_binding") or ""))
            payload, _, mime = await asyncio.to_thread(_validated_image_payload, content)
        except SeedanceInputProvenanceError:
            raise
        except Exception as exc:
            raise SeedanceInputProvenanceError("参考原图不存在、无法读取或格式无效，请重新生成；不会压缩后重试。") from exc
        purposes.add(provenance["purpose"])
        if prepare:
            prepared[index] = f"data:{mime};base64,{base64.b64encode(payload).decode('ascii')}"
    if purposes != REFERENCE_PURPOSES:
        raise SeedanceInputProvenanceError("真人全能参考必须同时包含人物四视图和纯背景文生图。")
    return prepared


async def preflight_portrait_references(task_type: str, data: dict[str, Any], user_id: str) -> None:
    from fastapi import HTTPException
    try:
        await validate_portrait_references(task_type, data, user_id)
    except SeedanceInputProvenanceError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
