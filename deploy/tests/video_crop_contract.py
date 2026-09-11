"""Shared authorization and output invariants for the two crop implementations."""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from services.entity_access_service import EntityAccessDenied
from services import public_video_crop_service as public_crop


def file_dao(record):
    async def create(**values):
        return values

    return SimpleNamespace(
        get_file=AsyncMock(side_effect=lambda key: record if key == record.get("file_id") else None),
        get_file_by_url=AsyncMock(side_effect=lambda url: record if url == record.get("file_url") else None),
        create_file=AsyncMock(side_effect=create),
    )


async def owned_source(file_id, identity, role, *, file_dao):
    assert (file_id, identity, role) == ("file_source", "owner", "readonly")
    return await file_dao.get_by_id(file_id)


class VideoCropContract:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("reference", ["file_source", "/api/files/file_source/download?download=1", "/storage/source.mp4"])
    async def test_source_resolution_always_checks_record_acl(self, reference):
        record = {"file_id": "file_source", "file_url": "/storage/source.mp4"}
        files = file_dao(record)
        checker = AsyncMock(side_effect=owned_source)
        resolved = await self.authorize(reference, files, checker)
        assert resolved == "file_source"
        checker.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_unregistered_source_is_not_authorized(self):
        checker = AsyncMock(side_effect=AssertionError("An unregistered file has no ACL"))
        with pytest.raises(self.access_error):
            await self.authorize("/storage/another-owner/private.mp4", file_dao({}), checker)
        checker.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_denied_source_is_not_authorized(self):
        checker = AsyncMock(side_effect=EntityAccessDenied("private permission details"))
        with pytest.raises(self.access_error) as error:
            await self.authorize("file_source", file_dao({"file_id": "file_source"}), checker)
        assert "private permission details" not in str(error.value)
        checker.assert_awaited_once()

    def source(self, tmp_path):
        source = tmp_path / "persistent_storage" / "source.mp4"
        source.parent.mkdir()
        source.write_bytes(b"original-video")
        return source, file_dao({
            "file_id": "file_source", "file_path": str(source), "file_name": "source.mp4",
            "file_type": "video", "user_id": "owner", "version_id": "version_source",
        })

    @pytest.mark.asyncio
    async def test_crop_persists_media_record_without_replacing_original(self, tmp_path):
        source, files = self.source(tmp_path)
        commands = []

        def runner(command, **_kwargs):
            commands.append(command)
            Path(command[-1]).write_bytes(b"cropped-video")
            return SimpleNamespace(returncode=0, stderr="")

        result = await self.crop(tmp_path, files, runner, lambda _name: "ffmpeg")
        assert result["success"] is True and result["duration"] == 2.5
        assert result["size"] == len(b"cropped-video")
        files.create_file.assert_awaited_once()
        saved = files.create_file.await_args.kwargs
        assert saved["file_id"] == result["file_id"]
        assert saved["file_url"] == result["url"]
        assert saved["user_id"] == "owner" and saved["file_type"] == "video"
        assert saved["mime_type"] == "video/mp4"
        assert saved["metadata"]["duration"] == 2.5
        assert Path(saved["file_path"]).read_bytes() == b"cropped-video"
        assert source.read_bytes() == b"original-video"
        assert len(commands) == 1 and not Path(commands[0][-1]).exists()
        input_path = Path(commands[0][commands[0].index("-i") + 1])
        assert input_path == source or not input_path.exists()

    @pytest.mark.asyncio
    async def test_missing_ffmpeg_does_not_create_result(self, tmp_path):
        source, files = self.source(tmp_path)
        runner = Mock(side_effect=AssertionError("Missing FFmpeg cannot execute"))
        with pytest.raises(self.unavailable_error):
            await self.crop(tmp_path, files, runner, lambda _name: None)
        runner.assert_not_called()
        files.create_file.assert_not_awaited()
        assert source.read_bytes() == b"original-video"

    @pytest.mark.asyncio
    async def test_ffmpeg_failure_cleans_temporary_output_without_persisting(self, tmp_path):
        source, files = self.source(tmp_path)
        commands = []

        def runner(command, **_kwargs):
            commands.append(command)
            Path(command[-1]).write_bytes(b"incomplete-output")
            return SimpleNamespace(returncode=1, stderr="invalid media")

        with pytest.raises(self.failed_error):
            await self.crop(tmp_path, files, runner, lambda _name: "ffmpeg")
        files.create_file.assert_not_awaited()
        assert len(commands) == 1 and not Path(commands[0][-1]).exists()
        assert source.read_bytes() == b"original-video"


class PublicVideoCropAdapter:
    access_error = public_crop.PublicVideoCropAccessDenied
    unavailable_error = public_crop.PublicVideoCropUnavailable
    failed_error = public_crop.PublicVideoCropFailed

    async def authorize(self, reference, files, checker):
        record = await public_crop.require_public_video_source(
            reference, "owner", file_dao=files, file_access_checker=checker,
        )
        return record["file_id"]

    async def crop(self, tmp_path, files, runner, available):
        return await public_crop.crop_public_video_file(
            video_ref="file_source", start_time=1, end_time=3.5, identity="owner",
            file_dao=files, deploy_root=tmp_path, logger=Mock(), file_access_checker=owned_source,
            media_roots=(tmp_path / "persistent_storage",), storage_root=tmp_path / "output",
            ffmpeg_available=available, ffmpeg_runner=runner,
        )
