"""Reference image preparation helpers for AI proxy routes."""
from __future__ import annotations

import base64
import binascii
import hashlib
from pathlib import Path
from typing import Any, Callable, Iterable, List, Mapping, Optional
from urllib.parse import urlparse

from services.remote_content_service import RemoteContentTooLarge, configured_download_limit
from services.ai_proxy_types import GptImageReferenceInput
from utils.image_reference import storage_path_safe
from services.local_file_access_service import resolve_allowed_media_file
from services.media_reference_service import extract_file_reference_id, resolve_media_file_record

StoragePathResolver = Callable[[str], Path]
DEFAULT_MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024


class ReferenceImageError(ValueError):
    """A required reference image could not be prepared for generation."""


async def resolve_registered_reference_paths(
    references: Iterable[str], *, file_dao: Any,
) -> dict[str, Path]:
    """Resolve already-authorized aliases without changing reference snapshots."""
    paths: dict[str, Path] = {}
    for ref in dict.fromkeys(references):
        if ref.startswith("data:"):
            continue
        record = await resolve_media_file_record(ref, file_dao)
        if not record:
            if extract_file_reference_id(ref):
                raise ReferenceImageError("参考图不存在或已被删除，请重新选择素材")
            continue
        path = resolve_allowed_media_file(
            str(record.get("file_path") or ""), deploy_root=Path(__file__).resolve().parents[1],
        )
        if path is None:
            raise ReferenceImageError("参考图文件无法读取，请重新上传或选择素材")
        paths[ref] = path
    return paths


def _reference_path(
    ref: str, registered_paths: Optional[Mapping[str, Path]], resolver: StoragePathResolver,
) -> Optional[Path]:
    if registered_paths and ref in registered_paths:
        return registered_paths[ref]
    storage_ref = _local_storage_reference(ref)
    return resolver(storage_ref) if storage_ref else None


def _reference_image_limit(max_bytes: Optional[int]) -> int:
    if max_bytes is not None:
        return max(1, int(max_bytes))
    return configured_download_limit(
        "MAX_PROVIDER_IMAGE_INPUT_BYTES",
        DEFAULT_MAX_REFERENCE_IMAGE_BYTES,
    )


def _decode_image_data_uri(reference: str, *, max_bytes: int) -> tuple[bytes, str]:
    try:
        header, payload = reference.split(",", 1)
    except ValueError as exc:
        raise ReferenceImageError("参考图 data URI 格式无效") from exc
    media_type = header[5:].split(";", 1)[0].strip().lower()
    if not header.lower().startswith("data:image/") or ";base64" not in header.lower():
        raise ReferenceImageError("参考图必须是 base64 图片 data URI")
    try:
        content = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ReferenceImageError("参考图 base64 数据无效") from exc
    if len(content) > max_bytes:
        raise RemoteContentTooLarge(f"reference image exceeds {max_bytes} bytes")
    return content, media_type


def _read_reference_file(file_path: Path, *, max_bytes: int) -> bytes:
    if not file_path.is_file():
        raise ReferenceImageError("参考图文件不存在")
    if file_path.stat().st_size > max_bytes:
        raise RemoteContentTooLarge(f"reference image exceeds {max_bytes} bytes")
    content = file_path.read_bytes()
    if len(content) > max_bytes:
        raise RemoteContentTooLarge(f"reference image exceeds {max_bytes} bytes")
    return content

IMAGE_MIME_BY_SUFFIX = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
}


def image_mime_type_from_suffix(suffix: str, *, default: str = "image/png") -> str:
    return IMAGE_MIME_BY_SUFFIX.get(suffix.lower(), default)


def _log_warning(logger: Any, message: str, *args: Any) -> None:
    if logger is not None:
        logger.warning(message, *args)


def _log_info(logger: Any, message: str, *args: Any) -> None:
    if logger is not None:
        logger.info(message, *args)


REFERENCE_TYPE_LABELS = {
    "character": "角色身份锚点（最高优先级）",
    "scene": "场景参考",
    "pose": "姿态/构图参考",
    "prop": "道具参考",
    "effect": "风格/效果参考",
}


def _reference_metadata_item(
    metadata: List[Mapping[str, Any]],
    index: int,
) -> Mapping[str, Any]:
    return metadata[index] if index < len(metadata) else {}


def _reference_snapshot_item(
    reference: str,
    index: int,
    metadata: Mapping[str, Any],
    *,
    submitted: bool,
) -> dict[str, Any]:
    item = {
        "input_order": index + 1,
        "reference_id": metadata.get("referenceId") or metadata.get("reference_id"),
        "asset_id": metadata.get("assetId") or metadata.get("asset_id"),
        "entity_file_id": metadata.get("fileId") or metadata.get("file_id"),
        "type": str(metadata.get("type") or "effect").lower(),
        "name": metadata.get("name"),
        "description": metadata.get("description"),
        "source": metadata.get("source"),
        "locked": bool(metadata.get("isLocked") or metadata.get("is_locked")),
        "submitted": submitted,
    }
    if reference.startswith("data:"):
        item.update({
            "reference_uri": "inline:data",
            "content_sha256": hashlib.sha256(reference.encode("utf-8")).hexdigest(),
        })
    else:
        item["reference_uri"] = reference
    return item


def build_reference_snapshot(
    references: Optional[Iterable[str]],
    reference_metadata: Optional[Iterable[Mapping[str, Any]]] = None,
    *,
    max_refs: int = 14,
    submitted: bool = False,
) -> List[dict[str, Any]]:
    metadata = list(reference_metadata or [])[:max_refs]
    return [
        _reference_snapshot_item(
            reference,
            index,
            _reference_metadata_item(metadata, index),
            submitted=submitted,
        )
        for index, reference in enumerate(list(references or [])[:max_refs])
    ]


def _reference_label(index: int, metadata: Mapping[str, Any]) -> str:
    ref_type = str(metadata.get("type") or "effect").lower()
    type_label = REFERENCE_TYPE_LABELS.get(ref_type, "其他参考")
    name = str(metadata.get("name") or "未命名").strip()
    description = str(metadata.get("description") or "").strip()
    suffix = f"；描述：{description[:300]}" if description else ""
    if ref_type == "character":
        return (
            f"参考图{index + 1}：{type_label}【{name}】。"
            "必须复用这张图中的同一人物身份，锁定脸型、五官比例、年龄感、发型发色、服装和显著特征；"
            f"场景图与道具图不得覆盖该人物身份{suffix}"
        )
    return f"参考图{index + 1}：{type_label}【{name}】{suffix}"


def _is_required_character_reference(metadata: Mapping[str, Any]) -> bool:
    return (
        str(metadata.get("type") or "").lower() == "character"
        and (
            bool(metadata.get("isLocked"))
            or str(metadata.get("source") or "").lower() == "identity_anchor"
        )
    )


def _local_storage_reference(ref: str) -> Optional[str]:
    if ref.startswith("/storage/"):
        return ref
    if ref.startswith(("http://", "https://")):
        path = urlparse(ref).path
        if path.startswith("/storage/"):
            return path
    return None


def enhance_reference_prompt(
    prompt: str,
    ref_count: int,
    reference_metadata: Optional[Iterable[Mapping[str, Any]]] = None,
) -> str:
    if ref_count <= 0:
        return prompt
    metadata = list(reference_metadata or [])[:ref_count]
    if any(metadata):
        reference_map = "\n".join(_reference_label(index, item) for index, item in enumerate(metadata))
        character_rule = (
            "\n角色身份参考图是不可替换的硬约束。生成的是参考图中的同一角色，不是相似角色，也不是仅沿用画风。"
            "场景、道具、姿态和效果参考只控制各自职责，不得改变角色身份。"
            if any(str(item.get("type") or "").lower() == "character" for item in metadata)
            else ""
        )
        return (
            f"{prompt}\n\n"
            f"参考图与职责映射（顺序与输入图片完全一致）：\n{reference_map}"
            f"{character_rule}\n"
            "请准确执行脚本中的人物、动作、场景和构图，并保持参考素材的职责边界。"
        )
    if ref_count == 1:
        return (
            f"请严格参考上面提供的参考图片，{prompt}\n\n"
            "重要提示：请紧密遵循参考图的画风、构图、角色设计、色彩风格和视觉元素。"
            "在保持与参考图一致性的同时，融入描述中的变化。"
            "确保生成的图像在视觉风格上与参考图高度相似。"
        )
    return (
        f"请严格参考上面提供的{ref_count}张参考图片，{prompt}\n\n"
        "重要提示：请紧密遵循这些参考图的画风、构图、角色设计、色彩风格和视觉元素。"
        "在保持与参考图一致性的同时，融入描述中的变化。"
        "确保生成的图像在视觉风格上与参考图高度相似。"
    )


def prepare_gemini_image_parts(
    *,
    prompt: str,
    references: Optional[Iterable[str]],
    reference_metadata: Optional[Iterable[Mapping[str, Any]]] = None,
    logger: Any,
    max_refs: int = 6,
    max_bytes: Optional[int] = None,
    reference_snapshot: Optional[List[dict[str, Any]]] = None,
    storage_path_resolver: StoragePathResolver = storage_path_safe,
    registered_paths: Optional[Mapping[str, Path]] = None,
) -> List[dict[str, Any]]:
    """Build Gemini multimodal parts from prompt and local/data URL references."""
    parts: List[dict[str, Any]] = []
    ref_count = 0
    loaded_metadata: List[Mapping[str, Any]] = []
    metadata = list(reference_metadata or [])[:max_refs]
    byte_limit = _reference_image_limit(max_bytes)

    for index, ref in enumerate(list(references or [])[:max_refs]):
        item_metadata = _reference_metadata_item(metadata, index)
        image_part: Optional[dict[str, Any]] = None
        try:
            if ref.startswith("data:"):
                img_bytes, mime_type = _decode_image_data_uri(ref, max_bytes=byte_limit)
                b64_data = base64.b64encode(img_bytes).decode("ascii")
                image_part = {"inlineData": {"mimeType": mime_type, "data": b64_data}}
            elif file_path := _reference_path(ref, registered_paths, storage_path_resolver):
                if file_path.is_file():
                    img_bytes = _read_reference_file(file_path, max_bytes=byte_limit)
                    mime_type = image_mime_type_from_suffix(file_path.suffix)
                    b64_data = base64.b64encode(img_bytes).decode("utf-8")
                    image_part = {"inlineData": {"mimeType": mime_type, "data": b64_data}}
                    _log_info(logger, "📷 从磁盘读取参考图: %s (%s bytes)", file_path, len(img_bytes))
                else:
                    _log_warning(logger, "⚠️ 参考图文件不存在: %s", file_path)
            else:
                _log_warning(logger, "⚠️ 不支持的参考图格式: %s", ref[:80])
        except Exception as ref_err:
            _log_warning(logger, "⚠️ 处理参考图失败: %s", ref_err)

        if image_part is None:
            if _is_required_character_reference(item_metadata):
                name = str(item_metadata.get("name") or f"参考图{index + 1}")
                raise ReferenceImageError(f"绑定角色“{name}”的身份参考图无法读取，请重新绑定素材后再生成")
            continue

        if item_metadata:
            parts.append({"text": _reference_label(index, item_metadata)})
        parts.append(image_part)
        if reference_snapshot is not None:
            reference_snapshot.append(
                _reference_snapshot_item(ref, index, item_metadata, submitted=True)
            )
        ref_count += 1
        loaded_metadata.append(item_metadata)

    parts.append({"text": enhance_reference_prompt(prompt, ref_count, loaded_metadata)})
    return parts


def _gpt_reference_extension_from_mime(mime: str) -> str:
    mime = mime.lower()
    if "jpeg" in mime or "jpg" in mime:
        return "jpeg"
    if "webp" in mime:
        return "webp"
    if "gif" in mime:
        return "gif"
    return "png"


def prepare_gpt_image_reference_inputs(
    references: Optional[Iterable[str]],
    *,
    reference_metadata: Optional[Iterable[Mapping[str, Any]]] = None,
    reference_snapshot: Optional[List[dict[str, Any]]] = None,
    logger: Any,
    max_refs: int = 8,
    max_bytes: Optional[int] = None,
    storage_path_resolver: StoragePathResolver = storage_path_safe,
    registered_paths: Optional[Mapping[str, Path]] = None,
) -> List[GptImageReferenceInput]:
    """Convert route reference strings into GPT Image multipart inputs."""
    reference_inputs: List[GptImageReferenceInput] = []

    metadata = list(reference_metadata or [])[:max_refs]
    byte_limit = _reference_image_limit(max_bytes)
    for idx, ref in enumerate(list(references or [])[:max_refs]):
        img_bytes: bytes | None = None
        ext = "png"

        if ref.startswith("data:"):
            try:
                img_bytes, mime = _decode_image_data_uri(ref, max_bytes=byte_limit)
                ext = _gpt_reference_extension_from_mime(mime)
            except Exception as decode_error:
                _log_warning(logger, "⚠️ GPT Image edit 跳过无法解码的参考图: %s", decode_error)
                continue
        elif file_path := _reference_path(ref, registered_paths, storage_path_resolver):
            try:
                img_bytes = _read_reference_file(file_path, max_bytes=byte_limit)
            except Exception as read_error:
                _log_warning(logger, "⚠️ GPT Image edit 跳过无法读取的参考图: %s", read_error)
                continue
            ext = file_path.suffix.lstrip(".").lower() or "png"
            if ext == "jpg":
                ext = "jpeg"

        if img_bytes is None:
            _log_warning(logger, "⚠️ GPT Image edit 跳过无效参考图: %s...", ref[:60])
            continue

        reference_inputs.append(
            GptImageReferenceInput(
                filename=f"ref_{idx}.{ext}",
                content=img_bytes,
                mime_type=f"image/{ext}",
            )
        )
        if reference_snapshot is not None:
            reference_snapshot.append(
                _reference_snapshot_item(
                    ref,
                    idx,
                    _reference_metadata_item(metadata, idx),
                    submitted=True,
                )
            )

    return reference_inputs


def prepare_doubao_reference_inputs(
    references: Optional[Iterable[str]],
    *,
    reference_metadata: Optional[Iterable[Mapping[str, Any]]] = None,
    reference_snapshot: Optional[List[dict[str, Any]]] = None,
    max_refs: int = 14,
    max_bytes: Optional[int] = None,
    storage_path_resolver: StoragePathResolver = storage_path_safe,
    registered_paths: Optional[Mapping[str, Path]] = None,
) -> List[str]:
    ref_inputs: List[str] = []
    metadata = list(reference_metadata or [])[:max_refs]
    byte_limit = _reference_image_limit(max_bytes)
    for index, ref in enumerate(list(references or [])[:max_refs]):
        converted = ""
        try:
            if ref.startswith("data:"):
                content, mime_type = _decode_image_data_uri(ref, max_bytes=byte_limit)
                converted = f"data:{mime_type};base64,{base64.b64encode(content).decode('ascii')}"
            elif file_path := _reference_path(ref, registered_paths, storage_path_resolver):
                content = _read_reference_file(file_path, max_bytes=byte_limit)
                mime_type = image_mime_type_from_suffix(file_path.suffix)
                converted = f"data:{mime_type};base64,{base64.b64encode(content).decode('ascii')}"
            elif ref.startswith(("http://", "https://")):
                converted = ref
        except Exception:
            converted = ""
        if converted:
            ref_inputs.append(converted)
            if reference_snapshot is not None:
                reference_snapshot.append(
                    _reference_snapshot_item(
                        ref,
                        index,
                        _reference_metadata_item(metadata, index),
                        submitted=True,
                    )
                )
    return ref_inputs
