"""Resolve media aliases consistently before authorization and task transfer."""
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse


def extract_file_reference_id(reference: str) -> Optional[str]:
    if not reference:
        return None
    path = urlparse(reference).path or reference.split("?", 1)[0]
    parts = [part for part in path.split("/") if part]
    if len(parts) >= 3 and parts[:2] == ["api", "files"]:
        return parts[2]
    basename = Path(path).name
    file_id = Path(basename).stem if Path(basename).suffix else basename
    return file_id if file_id.startswith("file_") else None


async def resolve_media_file_record(reference: str, file_dao: Any) -> Optional[dict[str, Any]]:
    file_id = extract_file_reference_id(reference)
    lookups = [("get_file", reference)]
    if file_id and file_id != reference:
        lookups.append(("get_file", file_id))
    if reference.startswith(("/", "http://", "https://")):
        lookups.append(("get_file_by_url", reference))
    else:
        lookups.extend([
            ("get_file_by_name", reference),
            ("get_file_by_comfyui_filename", reference),
        ])
    for method_name, value in lookups:
        method = getattr(file_dao, method_name, None)
        if callable(method):
            record = await method(value)
            if record:
                return dict(record)
    return None


def is_local_media_reference(reference: str) -> bool:
    path = urlparse(reference).path
    return (
        reference.startswith("/")
        or path.startswith(("/api/files/", "/storage/"))
        or bool(extract_file_reference_id(reference))
    )
