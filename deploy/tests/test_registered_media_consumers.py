import base64
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

import services.ai_proxy_reference_service as images
import services.video_voice_reference_service as voices


@pytest.mark.asyncio
@pytest.mark.parametrize("reference", ["file_ref", "/api/files/file_ref/download?x=1", "https://media.example.com/api/files/file_ref/download"])
@pytest.mark.parametrize("provider", ["gemini", "gpt", "doubao"])
async def test_registered_images_reach_every_image_provider_without_losing_provenance(tmp_path, monkeypatch, reference, provider):
    payload = b"registered-reference"
    source = tmp_path / "image.png"
    source.write_bytes(payload)
    record = {"file_id": "file_ref", "file_path": str(source), "file_url": "/storage/image/source.png"}
    dao = SimpleNamespace(get_file=AsyncMock(side_effect=lambda value: record if value == "file_ref" else None))
    monkeypatch.setattr(images, "resolve_allowed_media_file", lambda value, **kwargs: source)
    paths = await images.resolve_registered_reference_paths([reference], file_dao=dao)
    snapshot = []
    options = {"registered_paths": paths, "reference_snapshot": snapshot}
    if provider == "gemini":
        result = images.prepare_gemini_image_parts(prompt="p", references=[reference], logger=Mock(), **options)
        assert base64.b64decode(result[0]["inlineData"]["data"]) == payload
    elif provider == "gpt":
        result = images.prepare_gpt_image_reference_inputs([reference], logger=Mock(), **options)
        assert result[0].content == payload
    else:
        result = images.prepare_doubao_reference_inputs([reference], **options)
        assert base64.b64decode(result[0].split(",", 1)[1]) == payload
    assert len(snapshot) == 1
    assert snapshot[0]["reference_uri"] == reference
    assert snapshot[0]["submitted"] is True


@pytest.mark.asyncio
async def test_registered_reference_outside_storage_is_rejected_before_generation(monkeypatch):
    dao = SimpleNamespace(get_file=AsyncMock(return_value={"file_id": "file_ref", "file_path": "/etc/private"}))
    monkeypatch.setattr(images, "resolve_allowed_media_file", lambda value, **kwargs: None)
    with pytest.raises(images.ReferenceImageError):
        await images.resolve_registered_reference_paths(["/api/files/file_ref/download"], file_dao=dao)


@pytest.mark.asyncio
@pytest.mark.parametrize("reference", ["file_ref", "/api/files/file_ref/download?x=1", "https://media.example.com/api/files/file_ref/download"])
async def test_voice_extraction_materializes_registered_download_without_self_http(tmp_path, monkeypatch, reference):
    import dao_content

    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    record = {"file_id": "file_ref", "file_path": str(source)}
    monkeypatch.setattr(dao_content, "FileDAO", SimpleNamespace(
        get_file=AsyncMock(side_effect=lambda value: record if value == "file_ref" else None),
    ))
    monkeypatch.setattr(voices, "resolve_allowed_media_file", lambda value, **kwargs: source)
    remote = Mock(side_effect=AssertionError("No HTTP request for a registered file"))
    monkeypatch.setattr(voices.aiohttp, "ClientSession", remote)
    destination = tmp_path / "materialized.mp4"
    await voices._materialize_video(reference, str(destination))
    assert destination.read_bytes() == b"video"
    remote.assert_not_called()
