"""Materialize authorized provider media references without local-node access."""
from __future__ import annotations

import asyncio
import base64
import binascii
import io
import mimetypes
import tempfile
from pathlib import Path
from typing import Any, Optional
from urllib.parse import unquote_to_bytes

import requests
from PIL import Image

from services.image_safety_service import open_image_bytes_safely
from services.local_file_access_service import resolve_allowed_media_file
from services.media_reference_service import (
    is_local_media_reference,
    resolve_media_file_record as _find_file_record,
)
from services.remote_content_service import (
    RemoteContentTooLarge,
    configured_download_limit,
    read_requests_response_limited,
)
from utils.net_guard import assert_public_http_url


DEPLOY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MAX_PROVIDER_IMAGE_BYTES = 20 * 1024 * 1024
DEFAULT_MAX_PROVIDER_AUDIO_BYTES = 20 * 1024 * 1024
DEFAULT_MAX_PROVIDER_VIDEO_BYTES = 20 * 1024 * 1024
_FORMAT_SUFFIX = {
    "BMP": ".bmp",
    "GIF": ".gif",
    "JPEG": ".jpg",
    "PNG": ".png",
    "WEBP": ".webp",
}


class ProviderMediaInputError(ValueError):
    """Raised when a provider input cannot be safely materialized."""


def _decode_data_uri(
    reference: str,
    *,
    max_bytes: int,
    expected_kind: str = "image",
) -> bytes:
    try:
        header, payload = reference.split(",", 1)
    except ValueError as exc:
        raise ProviderMediaInputError(f"Invalid {expected_kind} data URI") from exc
    if not header.lower().startswith(f"data:{expected_kind}/"):
        raise ProviderMediaInputError(f"Only {expected_kind} data URIs are accepted")
    try:
        content = base64.b64decode(payload, validate=True) if ";base64" in header.lower() else unquote_to_bytes(payload)
    except (binascii.Error, ValueError) as exc:
        raise ProviderMediaInputError(f"Invalid {expected_kind} data URI") from exc
    if len(content) > max_bytes:
        raise RemoteContentTooLarge(f"provider image exceeds {max_bytes} bytes")
    return content


def _read_local_record(record: dict[str, Any], *, max_bytes: int) -> bytes:
    source = record.get("file_path")
    if not source:
        raise ProviderMediaInputError("Image file record has no storage path")
    path = resolve_allowed_media_file(source, deploy_root=DEPLOY_ROOT)
    if path is None:
        raise ProviderMediaInputError("Image file is outside configured media storage")
    if path.stat().st_size > max_bytes:
        raise RemoteContentTooLarge(f"provider image exceeds {max_bytes} bytes")
    content = path.read_bytes()
    if len(content) > max_bytes:
        raise RemoteContentTooLarge(f"provider image exceeds {max_bytes} bytes")
    return content


def _record_media_type(record: dict[str, Any]) -> str:
    configured = str(record.get("mime_type") or "").split(";", 1)[0].strip().lower()
    if configured:
        return configured
    path = str(record.get("file_path") or record.get("file_name") or "")
    return str(mimetypes.guess_type(path)[0] or "").lower()


def _download_public_image(reference: str, *, max_bytes: int) -> bytes:
    assert_public_http_url(reference)
    response = requests.get(
        reference,
        stream=True,
        allow_redirects=False,
        timeout=(5, 30),
    )
    if response.status_code < 200 or response.status_code >= 300:
        response.close()
        raise ProviderMediaInputError("Remote image request failed")
    content_type = str((response.headers or {}).get("Content-Type") or "").split(";", 1)[0].strip().lower()
    if content_type and not content_type.startswith("image/"):
        response.close()
        raise ProviderMediaInputError("Remote provider input is not an image")
    return read_requests_response_limited(response, max_bytes=max_bytes)


def _validated_image_payload(
    content: bytes,
    *,
    optimize_threshold_bytes: int | None = None,
) -> tuple[bytes, str, str]:
    """Fully decode an image and optionally make a smaller provider payload."""
    try:
        with open_image_bytes_safely(content) as source_image:
            image_format = str(source_image.format or "").upper()
            source_image.load()
            image = source_image.copy()
    except Exception as exc:
        raise ProviderMediaInputError("Provider input is not a safe decodable image") from exc

    if image_format not in _FORMAT_SUFFIX:
        raise ProviderMediaInputError("Provider input uses an unsupported image format")
    output = content
    if optimize_threshold_bytes and len(content) > optimize_threshold_bytes:
        try:
            converted = image.convert("RGB")
            width, height = converted.size
            longest = max(width, height)
            if longest > 1536:
                scale = 1536 / longest
                converted = converted.resize(
                    (max(1, int(width * scale)), max(1, int(height * scale))),
                    resample=Image.Resampling.LANCZOS,
                )
            buffer = io.BytesIO()
            converted.save(buffer, format="JPEG", quality=85)
            optimized = buffer.getvalue()
            if optimized and len(optimized) < len(content):
                output = optimized
                image_format = "JPEG"
        except Exception:
            # Optimization changes neither trust nor acceptance. The fully
            # validated original stays within the configured byte ceiling.
            pass

    mime_type = {
        "BMP": "image/bmp",
        "GIF": "image/gif",
        "JPEG": "image/jpeg",
        "PNG": "image/png",
        "WEBP": "image/webp",
    }[image_format]
    return output, image_format, mime_type


def _validate_and_write_temp_image(content: bytes) -> str:
    content, image_format, _mime_type = _validated_image_payload(content)
    suffix = _FORMAT_SUFFIX.get(image_format, ".img")
    temp_file = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        temp_file.write(content)
        temp_file.close()
        return temp_file.name
    except Exception:
        temp_file.close()
        Path(temp_file.name).unlink(missing_ok=True)
        raise


async def _resolve_provider_image_content(
    reference: str,
    *,
    file_dao: Any,
    max_bytes: Optional[int] = None,
) -> bytes:
    clean = str(reference or "").strip()
    if not clean:
        raise ProviderMediaInputError("Image reference is required")
    limit = max_bytes or configured_download_limit(
        "MAX_PROVIDER_IMAGE_INPUT_BYTES",
        DEFAULT_MAX_PROVIDER_IMAGE_BYTES,
    )

    if clean.startswith("data:"):
        content = _decode_data_uri(clean, max_bytes=limit)
    else:
        record = await _find_file_record(clean, file_dao)
        if record:
            content = await asyncio.to_thread(_read_local_record, record, max_bytes=limit)
        elif clean.startswith(("http://", "https://")) and not is_local_media_reference(clean):
            content = await asyncio.to_thread(_download_public_image, clean, max_bytes=limit)
        else:
            raise ProviderMediaInputError("Image reference is not a registered file")

    return content


async def materialize_provider_image_reference(
    reference: str,
    *,
    file_dao: Any,
    max_bytes: Optional[int] = None,
) -> str:
    """Return a temporary verified image path for an online provider request.

    The caller must already have authorized the task's user and source object.
    This second layer only accepts database-backed local files, bounded image
    data URIs, or public HTTP(S) URLs; it never reaches a local execution node.
    """
    content = await _resolve_provider_image_content(
        reference,
        file_dao=file_dao,
        max_bytes=max_bytes,
    )

    return await asyncio.to_thread(_validate_and_write_temp_image, content)


async def provider_image_reference_to_data_uri(
    reference: str,
    *,
    file_dao: Any,
    max_bytes: Optional[int] = None,
    optimize_threshold_bytes: int = 800 * 1024,
) -> str:
    """Return a verified, bounded provider image as an inline data URI."""
    content = await _resolve_provider_image_content(
        reference,
        file_dao=file_dao,
        max_bytes=max_bytes,
    )
    payload, _image_format, mime_type = await asyncio.to_thread(
        _validated_image_payload,
        content,
        optimize_threshold_bytes=optimize_threshold_bytes,
    )
    return f"data:{mime_type};base64,{base64.b64encode(payload).decode('ascii')}"


async def seedance_image_reference_to_data_uri(
    reference: str, *, file_dao: Any, sub_model: str = "standard", usage_scope: str = "workflow",
) -> str:
    """Keep original bytes and validate signed portrait-mode outputs on reuse."""
    import json
    from services.seedance_image_provenance import PROVENANCE_KEY, SeedanceInputProvenanceError, verify_original

    if reference.startswith("sb_"):
        from dao.creative.storyboard import StoryboardDAO
        item = await StoryboardDAO.get_by_id(reference)
        reference = (item or {}).get("generated_image_url") or ""
    record = None if reference.startswith("data:") else await _find_file_record(reference, file_dao)
    metadata = (record or {}).get("metadata") or {}
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (ValueError, TypeError):
            metadata = {}
    provenance = metadata.get(PROVENANCE_KEY) if isinstance(metadata, dict) else None
    try:
        content = await _resolve_provider_image_content(reference, file_dao=file_dao)
    except (ProviderMediaInputError, RemoteContentTooLarge) as exc:
        raise SeedanceInputProvenanceError("Seedance 输入图片不存在、格式无效或超过安全大小限制；请重新选择原图，系统不会压缩后重试。") from exc
    if isinstance(provenance, dict) and provenance.get("protected") is True:
        from services.api_provider_runtime import resolve_provider, resolve_seedance_model_name
        model = resolve_seedance_model_name(sub_model, usage_scope=usage_scope)
        config = resolve_provider("seedance", model, usage_scope=usage_scope)
        verify_original(
            provenance,
            content,
            api_key=config.api_key,
            endpoint=config.endpoint,
            account_binding=str((getattr(config, "extra", None) or {}).get("account_binding") or ""),
        )
    try:
        payload, _format, mime_type = await asyncio.to_thread(_validated_image_payload, content)
    except ProviderMediaInputError as exc:
        raise SeedanceInputProvenanceError("Seedance 输入图片格式无效或超过安全限制，请重新选择原图。") from exc
    return f"data:{mime_type};base64,{base64.b64encode(payload).decode('ascii')}"


async def provider_audio_or_video_reference(
    reference: str,
    *,
    media_kind: str,
    file_dao: Any,
    max_bytes: Optional[int] = None,
) -> str:
    """Return a bounded inline local asset or a validated public URL.

    Audio and video are not decoded in the application process. Database-backed
    files are restricted to configured media roots and the existing 20 MiB
    inline ceiling; public URLs are only syntax/network-policy validated and are
    fetched by the external provider, not by Ovideo.
    """
    kind = str(media_kind or "").strip().lower()
    if kind not in {"audio", "video"}:
        raise ProviderMediaInputError("Media kind must be audio or video")
    clean = str(reference or "").strip()
    if not clean:
        raise ProviderMediaInputError(f"{kind.title()} reference is required")
    default_limit = (
        DEFAULT_MAX_PROVIDER_AUDIO_BYTES
        if kind == "audio"
        else DEFAULT_MAX_PROVIDER_VIDEO_BYTES
    )
    limit = max_bytes or configured_download_limit(
        f"MAX_PROVIDER_{kind.upper()}_INPUT_BYTES",
        default_limit,
    )

    if clean.startswith("data:"):
        try:
            header, _payload = clean.split(",", 1)
        except ValueError as exc:
            raise ProviderMediaInputError(f"Invalid {kind} data URI") from exc
        declared_type = header[5:].split(";", 1)[0].strip().lower()
        if not declared_type.startswith(f"{kind}/"):
            raise ProviderMediaInputError(f"Only {kind} data URIs are accepted")
        _decode_data_uri(clean, max_bytes=limit, expected_kind=kind)
        return clean

    record = await _find_file_record(clean, file_dao)
    if record:
        mime_type = _record_media_type(record)
        if not mime_type.startswith(f"{kind}/"):
            raise ProviderMediaInputError(f"Registered file is not {kind}")
        content = await asyncio.to_thread(_read_local_record, record, max_bytes=limit)
        return f"data:{mime_type};base64,{base64.b64encode(content).decode('ascii')}"

    if clean.startswith(("http://", "https://")) and not is_local_media_reference(clean):
        assert_public_http_url(clean)
        return clean
    raise ProviderMediaInputError(f"{kind.title()} reference is not a registered file")
