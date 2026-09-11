"""Project image persistence helpers.

Legacy project routes still carry several data-shape workflows, but file
storage and FileDAO record creation belong in a service boundary.
"""
from __future__ import annotations

import base64
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional

from services.image_webp_service import WebPImageService


@dataclass(frozen=True)
class PersistedProjectImage:
    file_id: str
    file_url: str
    file_path: str
    file_size_bytes: int
    file_record: dict[str, Any]


def is_data_image(value: str) -> bool:
    return bool(value) and value.startswith("data:image")


def _decode_data_image(value: str) -> bytes:
    base64_str = value.split(",", 1)[1] if "," in value else value
    return base64.b64decode(base64_str)


def _clean_context(context: str) -> str:
    return context.replace("/", "_").replace("\\", "_").replace(":", "_")[:30]


async def _ensure_default_project_version(
    *,
    username: str,
    project_dao: Any,
    version_dao: Any,
    uuid_hex_provider: Callable[[], str],
) -> str:
    projects = await project_dao.get_user_projects(username)
    if not projects:
        project_id = f"proj_{uuid_hex_provider()[:12]}"
        await project_dao.save_or_update_project(
            user_id=username,
            project_id=project_id,
            project_name="榛樿椤圭洰",
            project_data={},
            description="鑷姩鍒涘缓",
        )
    else:
        project_id = projects[0]["project_id"]

    versions = await version_dao.get_project_versions(project_id)
    if not versions:
        version = await version_dao.create_version(
            project_id=project_id,
            user_id=username,
            version_name="榛樿鐗堟湰",
        )
        return version["version_id"]
    return versions[0]["version_id"]


async def persist_project_embedded_base64_image(
    *,
    username: str,
    image_data: str,
    context: str,
    file_dao: Any,
    project_dao: Any,
    version_dao: Any,
    logger: Any,
    storage_root: Path = Path("persistent_storage"),
    now_provider: Callable[[], datetime] = datetime.now,
    uuid_hex_provider: Callable[[], str] = lambda: uuid.uuid4().hex,
    webp_converter: Callable[..., Optional[bytes]] = WebPImageService.bytes_to_webp,
) -> PersistedProjectImage:
    """Persist a base64 image embedded in project JSON and return its file URL."""

    image_bytes = _decode_data_image(image_data)
    file_id = f"file_{uuid_hex_provider()[:12]}"
    year_month = now_provider().strftime("%Y%m")
    clean_context = _clean_context(context)
    storage_dir = storage_root / "images" / username / year_month
    storage_dir.mkdir(parents=True, exist_ok=True)
    file_path = storage_dir / f"{file_id}_{clean_context}.webp"

    webp_bytes = webp_converter(image_bytes, quality=100)
    if webp_bytes:
        output_bytes = webp_bytes
    else:
        output_bytes = image_bytes
    file_path.write_bytes(output_bytes)

    version_id = await _ensure_default_project_version(
        username=username,
        project_dao=project_dao,
        version_dao=version_dao,
        uuid_hex_provider=uuid_hex_provider,
    )

    file_record = await file_dao.create_file(
        version_id=version_id,
        user_id=username,
        file_type="image",
        file_name=f"{context}.webp",
        file_path=str(file_path),
        file_url=f"/api/files/{file_id}/download",
        file_size_bytes=len(output_bytes),
        mime_type="image/webp",
        metadata={"source": "base64_convert", "context": context},
        file_id=file_id,
    )

    logger.info("✅ Base64 image persisted for project data: %s -> %s", context, file_record["file_url"])
    return PersistedProjectImage(
        file_id=file_record["file_id"],
        file_url=file_record["file_url"],
        file_path=str(file_path),
        file_size_bytes=len(output_bytes),
        file_record=file_record,
    )


async def persist_export_storyboard_base64_image(
    *,
    username: str,
    image_data: str,
    storyboard_item: dict[str, Any],
    version_id: str,
    file_dao: Any,
    logger: Any,
    storage_root: Path = Path("persistent_storage"),
    now_provider: Callable[[], datetime] = datetime.now,
    timestamp_provider: Callable[[], float] = time.time,
    uuid_hex_provider: Callable[[], str] = lambda: uuid.uuid4().hex,
) -> PersistedProjectImage:
    """Persist a selected storyboard base64 image for the export-to-video stage."""

    image_bytes = _decode_data_image(image_data)
    item_id = storyboard_item["id"]
    file_id = f"file_{uuid_hex_provider()[:12]}"
    timestamp = int(timestamp_provider())
    year_month = now_provider().strftime("%Y%m")
    filename = f"exported_{item_id}_{timestamp}.png"
    storage_dir = storage_root / "images" / username / year_month
    storage_dir.mkdir(parents=True, exist_ok=True)
    file_path = storage_dir / filename
    file_path.write_bytes(image_bytes)

    file_record = await file_dao.create_file(
        version_id=version_id,
        user_id=username,
        file_type="image",
        file_name=f"{storyboard_item.get('scene', 'shot')}_{item_id}.png",
        file_path=str(file_path),
        file_url=f"/api/files/{file_id}/download",
        file_size_bytes=len(image_bytes),
        mime_type="image/png",
        metadata={
            "source": "export_to_video",
            "storyboard_id": item_id,
            "scene": storyboard_item.get("scene", ""),
            "shot_number": storyboard_item.get("shotNumber", ""),
        },
        file_id=file_id,
    )

    logger.info("✅ Export storyboard image persisted: file_id=%s", file_record["file_id"])
    return PersistedProjectImage(
        file_id=file_record["file_id"],
        file_url=f"/api/files/{file_record['file_id']}/download",
        file_path=str(file_path),
        file_size_bytes=len(image_bytes),
        file_record=file_record,
    )
