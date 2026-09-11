"""MiniMax audio file management service."""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable

from services.upload_stream_service import UploadPayloadTooLarge, read_upload_limited

class MiniMaxFileServiceError(RuntimeError):
    pass


class MiniMaxFileValidationError(MiniMaxFileServiceError):
    def __init__(self, detail: str, *, status_code: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


class MiniMaxFileProviderError(MiniMaxFileServiceError):
    pass


UuidHexProvider = Callable[[], str]
RemoveFile = Callable[[str | os.PathLike[str]], None]


def _safe_audio_filename(filename: str | None) -> str:
    return Path(filename or "audio").name


def _validate_voice_clone_audio(original_filename: str, content: bytes) -> str:
    ext = Path(original_filename).suffix.lower()
    if ext not in {".mp3", ".m4a", ".wav"}:
        raise MiniMaxFileValidationError("\u58f0\u97f3\u514b\u9686\u4ec5\u652f\u6301 mp3\u3001m4a\u3001wav \u683c\u5f0f", status_code=400)
    if len(content) > 20 * 1024 * 1024:
        raise MiniMaxFileValidationError("\u58f0\u97f3\u514b\u9686\u97f3\u9891\u4e0d\u80fd\u8d85\u8fc7 20MB", status_code=413)
    return ext


async def upload_minimax_file_response(
    *,
    upload_file: Any,
    purpose: str,
    audio_upload_dir: str | Path,
    client: Any,
    logger: Any,
    uuid_hex_provider: UuidHexProvider = lambda: uuid.uuid4().hex,
    remove_file: RemoveFile = os.remove,
) -> dict[str, Any]:
    tmp_path: Path | None = None
    try:
        original_filename = _safe_audio_filename(getattr(upload_file, "filename", None))
        try:
            content = await read_upload_limited(upload_file, max_bytes=20 * 1024 * 1024)
        except UploadPayloadTooLarge as exc:
            raise MiniMaxFileValidationError(
                "\u58f0\u97f3\u514b\u9686\u97f3\u9891\u4e0d\u80fd\u8d85\u8fc7 20MB",
                status_code=413,
            ) from exc
        _validate_voice_clone_audio(original_filename, content)

        tmp_dir = Path(audio_upload_dir)
        tmp_dir.mkdir(parents=True, exist_ok=True)
        tmp_path = tmp_dir / f"upload_{uuid_hex_provider()[:8]}_{original_filename}"
        tmp_path.write_bytes(content)

        result = await client.file_upload(str(tmp_path), purpose=purpose)
        return {"success": True, "file_id": result.get("file", {}).get("file_id", result.get("file_id", ""))}
    except MiniMaxFileValidationError:
        raise
    except Exception as exc:
        logger.error("MiniMax file upload failed: %s", exc)
        raise MiniMaxFileProviderError(str(exc)) from exc
    finally:
        if tmp_path is not None:
            try:
                remove_file(tmp_path)
            except OSError:
                pass


async def retrieve_minimax_file_response(*, file_id: str, client: Any) -> dict[str, Any]:
    result = await client.file_retrieve(file_id)
    return {"success": True, **result}


async def delete_minimax_file_response(*, file_id: str, client: Any) -> dict[str, Any]:
    result = await client.file_delete(file_id)
    return {"success": True, **result}
