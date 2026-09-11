from pathlib import Path

import pytest

from services.audio_minimax_file_service import (
    MiniMaxFileProviderError,
    MiniMaxFileValidationError,
    delete_minimax_file_response,
    retrieve_minimax_file_response,
    upload_minimax_file_response,
)


class _UploadFile:
    def __init__(self, filename: str, content: bytes):
        self.filename = filename
        self.content = content

    async def read(self, size=-1):
        if not self.content:
            return b""
        if size is None or size < 0:
            chunk, self.content = self.content, b""
        else:
            chunk, self.content = self.content[:size], self.content[size:]
        return chunk


class _Client:
    def __init__(self, upload_result=None, upload_error=None):
        self.upload_result = upload_result or {"file": {"file_id": "mx_file_1"}}
        self.upload_error = upload_error
        self.upload_calls = []
        self.retrieve_calls = []
        self.delete_calls = []

    async def file_upload(self, path, *, purpose):
        self.upload_calls.append((path, purpose))
        if self.upload_error:
            raise self.upload_error
        return self.upload_result

    async def file_retrieve(self, file_id):
        self.retrieve_calls.append(file_id)
        return {"file_id": file_id, "status": "ok"}

    async def file_delete(self, file_id):
        self.delete_calls.append(file_id)
        return {"file_id": file_id, "deleted": True}


class _Logger:
    errors = []

    @classmethod
    def error(cls, *args, **kwargs):
        cls.errors.append((args, kwargs))


@pytest.fixture(autouse=True)
def _reset_logger():
    _Logger.errors = []


@pytest.mark.asyncio
async def test_upload_minimax_file_response_writes_temp_uploads_and_cleans_file(tmp_path: Path):
    client = _Client()
    removed = []

    def fake_remove(path):
        removed.append(Path(path))
        Path(path).unlink()

    result = await upload_minimax_file_response(
        upload_file=_UploadFile("../sample.mp3", b"voice-bytes"),
        purpose="voice_clone",
        audio_upload_dir=tmp_path,
        client=client,
        logger=_Logger,
        uuid_hex_provider=lambda: "abcdef123456",
        remove_file=fake_remove,
    )

    assert result == {"success": True, "file_id": "mx_file_1"}
    uploaded_path, purpose = client.upload_calls[0]
    assert purpose == "voice_clone"
    assert Path(uploaded_path).name == "upload_abcdef12_sample.mp3"
    assert removed == [Path(uploaded_path)]
    assert not Path(uploaded_path).exists()


@pytest.mark.asyncio
async def test_upload_minimax_file_response_accepts_legacy_top_level_file_id(tmp_path: Path):
    client = _Client(upload_result={"file_id": "mx_legacy"})

    result = await upload_minimax_file_response(
        upload_file=_UploadFile("sample.wav", b"voice-bytes"),
        purpose="voice_clone",
        audio_upload_dir=tmp_path,
        client=client,
        logger=_Logger,
        uuid_hex_provider=lambda: "abcdef123456",
    )

    assert result == {"success": True, "file_id": "mx_legacy"}


@pytest.mark.asyncio
async def test_upload_minimax_file_response_validates_extension_and_size(tmp_path: Path):
    client = _Client()

    with pytest.raises(MiniMaxFileValidationError) as ext_exc:
        await upload_minimax_file_response(
            upload_file=_UploadFile("sample.txt", b"voice-bytes"),
            purpose="voice_clone",
            audio_upload_dir=tmp_path,
            client=client,
            logger=_Logger,
        )
    assert ext_exc.value.status_code == 400

    with pytest.raises(MiniMaxFileValidationError) as size_exc:
        await upload_minimax_file_response(
            upload_file=_UploadFile("sample.mp3", b"x" * (20 * 1024 * 1024 + 1)),
            purpose="voice_clone",
            audio_upload_dir=tmp_path,
            client=client,
            logger=_Logger,
        )
    assert size_exc.value.status_code == 413
    assert client.upload_calls == []


@pytest.mark.asyncio
async def test_upload_minimax_file_response_wraps_provider_errors_and_cleans_temp(tmp_path: Path):
    client = _Client(upload_error=RuntimeError("provider down"))
    removed = []

    def fake_remove(path):
        removed.append(Path(path))
        Path(path).unlink()

    with pytest.raises(MiniMaxFileProviderError):
        await upload_minimax_file_response(
            upload_file=_UploadFile("sample.m4a", b"voice-bytes"),
            purpose="voice_clone",
            audio_upload_dir=tmp_path,
            client=client,
            logger=_Logger,
            uuid_hex_provider=lambda: "abcdef123456",
            remove_file=fake_remove,
        )

    assert removed
    assert _Logger.errors


@pytest.mark.asyncio
async def test_retrieve_and_delete_minimax_file_response_wraps_success():
    client = _Client()

    retrieve = await retrieve_minimax_file_response(file_id="mx_1", client=client)
    delete = await delete_minimax_file_response(file_id="mx_1", client=client)

    assert retrieve == {"success": True, "file_id": "mx_1", "status": "ok"}
    assert delete == {"success": True, "file_id": "mx_1", "deleted": True}
    assert client.retrieve_calls == ["mx_1"]
    assert client.delete_calls == ["mx_1"]
