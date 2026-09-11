from __future__ import annotations

import base64
import io
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image

import services.provider_media_input_service as service
from services.provider_media_input_service import (
    ProviderMediaInputError,
    materialize_provider_image_reference,
    provider_audio_or_video_reference,
    provider_image_reference_to_data_uri,
)
from services.remote_content_service import RemoteContentTooLarge


def _png_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (2, 2), "white").save(output, format="PNG")
    return output.getvalue()


class FileDAO:
    def __init__(self, record=None):
        self.record = record

    async def get_file(self, reference):
        return self.record if self.record and reference == self.record.get("file_id") else None

    async def get_file_by_name(self, reference):
        return self.record if self.record and reference == self.record.get("file_name") else None

    async def get_file_by_url(self, reference):
        return self.record if self.record and reference == self.record.get("file_url") else None


class Response:
    def __init__(self, content: bytes, *, content_type="image/png", declared=None):
        self.status_code = 200
        self.headers = {"Content-Type": content_type}
        if declared is not None:
            self.headers["Content-Length"] = str(declared)
        self.content = content
        self.closed = False

    def iter_content(self, chunk_size):
        yield self.content

    def close(self):
        self.closed = True


@pytest.mark.asyncio
async def test_materializes_bounded_image_data_uri():
    payload = base64.b64encode(_png_bytes()).decode("ascii")
    path = await materialize_provider_image_reference(
        f"data:image/png;base64,{payload}",
        file_dao=FileDAO(),
    )
    try:
        assert Path(path).suffix == ".png"
        assert Path(path).read_bytes() == _png_bytes()
    finally:
        Path(path).unlink(missing_ok=True)


@pytest.mark.asyncio
async def test_rejects_database_file_outside_configured_media_roots(tmp_path):
    outside = tmp_path / "outside.png"
    outside.write_bytes(_png_bytes())
    dao = FileDAO({"file_id": "file_outside", "file_path": str(outside)})

    with pytest.raises(ProviderMediaInputError, match="outside configured"):
        await materialize_provider_image_reference("file_outside", file_dao=dao)


@pytest.mark.asyncio
async def test_public_remote_image_is_bounded_and_disallows_redirect_following():
    response = Response(_png_bytes())
    with patch.object(service, "assert_public_http_url"), patch.object(service.requests, "get", return_value=response) as get:
        path = await materialize_provider_image_reference(
            "https://media.example.invalid/frame.png",
            file_dao=FileDAO(),
        )
    try:
        assert Path(path).exists()
        assert get.call_args.kwargs["allow_redirects"] is False
        assert get.call_args.kwargs["stream"] is True
        assert response.closed is True
    finally:
        Path(path).unlink(missing_ok=True)


@pytest.mark.asyncio
async def test_remote_declared_size_is_rejected_before_body_read():
    response = Response(_png_bytes(), declared=10_000)
    with patch.object(service, "assert_public_http_url"), patch.object(service.requests, "get", return_value=response):
        with pytest.raises(RemoteContentTooLarge):
            await materialize_provider_image_reference(
                "https://media.example.invalid/frame.png",
                file_dao=FileDAO(),
                max_bytes=100,
            )
    assert response.closed is True


@pytest.mark.asyncio
@pytest.mark.parametrize("reference", ["file-1", "/api/files/file-1/download", "https://media.example.com/api/files/file-1/download?x=1"])
async def test_registered_image_is_converted_to_verified_data_uri(monkeypatch, tmp_path, reference):
    media_root = tmp_path / "media"
    media_root.mkdir()
    source = media_root / "source.png"
    source.write_bytes(_png_bytes())
    dao = FileDAO({"file_id": "file-1", "file_path": str(source)})
    monkeypatch.setattr(
        service,
        "resolve_allowed_media_file",
        lambda value, *, deploy_root: Path(value),
    )

    result = await provider_image_reference_to_data_uri(reference, file_dao=dao)

    assert result.startswith("data:image/png;base64,")
    assert base64.b64decode(result.split(",", 1)[1]) == _png_bytes()


@pytest.mark.asyncio
async def test_data_uri_mime_declaration_cannot_bypass_real_image_validation():
    payload = base64.b64encode(b"not-an-image").decode("ascii")

    with pytest.raises(ProviderMediaInputError, match="safe decodable image"):
        await provider_image_reference_to_data_uri(
            f"data:image/png;base64,{payload}",
            file_dao=FileDAO(),
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("reference", ["audio-1", "/api/files/audio-1/download", "https://media.example.com/api/files/audio-1/download?x=1"])
async def test_registered_audio_is_bounded_and_inlined(monkeypatch, tmp_path, reference):
    media_root = tmp_path / "media"
    media_root.mkdir()
    source = media_root / "sample.mp3"
    source.write_bytes(b"ID3-audio")
    dao = FileDAO({
        "file_id": "audio-1",
        "file_path": str(source),
        "mime_type": "audio/mpeg",
    })
    monkeypatch.setattr(
        service,
        "resolve_allowed_media_file",
        lambda value, *, deploy_root: Path(value),
    )

    result = await provider_audio_or_video_reference(
        reference,
        media_kind="audio",
        file_dao=dao,
        max_bytes=100,
    )

    assert result == "data:audio/mpeg;base64," + base64.b64encode(b"ID3-audio").decode("ascii")


@pytest.mark.asyncio
async def test_public_video_url_is_validated_but_not_fetched():
    with patch.object(service, "assert_public_http_url") as validate, \
         patch.object(service.requests, "get") as get:
        result = await provider_audio_or_video_reference(
            "https://media.example.invalid/reference.mp4",
            media_kind="video",
            file_dao=FileDAO(),
        )

    assert result == "https://media.example.invalid/reference.mp4"
    validate.assert_called_once_with(result)
    get.assert_not_called()
