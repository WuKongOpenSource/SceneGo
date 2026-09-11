from pathlib import Path
from types import SimpleNamespace
import hashlib
import json
import shutil
import subprocess
from unittest.mock import AsyncMock

import pytest

from services import public_video_crop_service as svc


class _FileDAO:
    source = {}
    created = []

    @classmethod
    async def get_file(cls, file_id):
        return cls.source if file_id == cls.source.get("file_id") else None

    @classmethod
    async def get_file_by_url(cls, value):
        return cls.source if value == cls.source.get("file_url") else None

    @classmethod
    async def create_file(cls, **kwargs):
        cls.created.append(kwargs)
        return kwargs


class _Logger:
    def info(self, *_args, **_kwargs):
        pass

    def warning(self, *_args, **_kwargs):
        pass

    def error(self, *_args, **_kwargs):
        pass


@pytest.fixture(autouse=True)
def _reset():
    _FileDAO.source = {}
    _FileDAO.created = []


def test_public_crop_storage_owner_key_is_not_path_controlled():
    key = svc._storage_owner_key("../../outside\\escape")

    assert key.startswith("user_")
    assert "/" not in key
    assert "\\" not in key
    assert ".." not in key


async def _allow_file(file_id, identity, role, *, file_dao, **_kwargs):
    assert (file_id, identity, role) == ("file_source", "yuan", "readonly")
    return await file_dao.get_by_id(file_id)


@pytest.mark.asyncio
async def test_public_crop_uses_only_authorized_storage_file(tmp_path):
    deploy_root = tmp_path / "deploy"
    source = deploy_root / "persistent_storage" / "videos" / "yuan" / "source.mp4"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"source-video")
    _FileDAO.source = {
        "file_id": "file_source",
        "file_type": "video",
        "file_path": str(source),
        "file_url": "/api/files/file_source/download",
        "version_id": "version_1",
        "user_id": "yuan",
    }

    def run_ffmpeg(command, **kwargs):
        assert kwargs["timeout"] >= 10
        assert command[0] == "C:/tools/ffmpeg.exe"
        assert str(source) in command
        Path(command[-1]).write_bytes(b"cropped-video")
        return SimpleNamespace(returncode=0, stderr="")

    ids = iter(("a" * 32, "b" * 32, "c" * 32))
    result = await svc.crop_public_video_file(
        video_ref="/api/files/file_source/download",
        start_time=1,
        end_time=3.5,
        identity="yuan",
        file_dao=_FileDAO,
        deploy_root=deploy_root,
        logger=_Logger(),
        file_access_checker=_allow_file,
        storage_root=tmp_path / "output",
        ffmpeg_available=lambda _name: "C:/tools/ffmpeg.exe",
        ffmpeg_runner=run_ffmpeg,
        uuid_hex_provider=lambda: next(ids),
    )

    assert result["file_id"] == "file_aaaaaaaaaaaa"
    assert result["duration"] == 2.5
    assert _FileDAO.created[0]["version_id"] == "version_1"
    assert Path(_FileDAO.created[0]["file_path"]).read_bytes() == b"cropped-video"


@pytest.mark.asyncio
async def test_public_crop_rejects_comfyui_and_outside_storage_paths(tmp_path):
    deploy_root = tmp_path / "deploy"
    storage = deploy_root / "persistent_storage"
    storage.mkdir(parents=True)
    outside = tmp_path / "outside.mp4"
    outside.write_bytes(b"private")

    for value in ("comfyui://output/private.mp4", str(outside)):
        _FileDAO.source = {
            "file_id": "file_source",
            "file_type": "video",
            "file_path": value,
            "user_id": "yuan",
        }
        with pytest.raises(svc.PublicVideoCropAccessDenied):
            await svc.crop_public_video_file(
                video_ref="file_source",
                start_time=0,
                end_time=1,
                identity="yuan",
                file_dao=_FileDAO,
                deploy_root=deploy_root,
                logger=_Logger(),
                file_access_checker=_allow_file,
                media_roots=(storage,),
                ffmpeg_available=lambda _name: "ffmpeg",
            )


@pytest.mark.asyncio
async def test_public_crop_validates_time_before_access(tmp_path):
    with pytest.raises(svc.PublicVideoCropInvalidRequest):
        await svc.crop_public_video_file(
            video_ref="file_source",
            start_time=5,
            end_time=2,
            identity="yuan",
            file_dao=_FileDAO,
            deploy_root=tmp_path,
            logger=_Logger(),
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("with_audio", [False, True])
async def test_public_crop_real_ffmpeg_preserves_original_and_persists_playable_mp4(tmp_path, with_audio):
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    assert ffmpeg and ffprobe, "Media integration tests require FFmpeg and FFprobe on PATH"
    deploy_root = tmp_path / "deploy"
    source = deploy_root / "persistent_storage" / "source.mp4"
    source.parent.mkdir(parents=True)
    command = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error",
               "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=10"]
    if with_audio:
        command += ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=8000"]
    subprocess.run(command + ["-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                              "-threads", "1", "-c:a", "aac", "-y", str(source)],
                   check=True, capture_output=True, timeout=20)
    original_digest = hashlib.sha256(source.read_bytes()).hexdigest()
    _FileDAO.source = {
        "file_id": "file_source", "file_type": "video", "file_path": str(source),
        "version_id": "version_1", "user_id": "yuan",
    }
    output_root = tmp_path / "output"
    result = await svc.crop_public_video_file(
        video_ref="file_source", start_time=0.5, end_time=1.5, identity="yuan",
        file_dao=_FileDAO, deploy_root=deploy_root, logger=_Logger(),
        file_access_checker=_allow_file, storage_root=output_root,
        ffmpeg_available=lambda _name: ffmpeg,
    )
    assert result["success"] is True
    assert result["duration"] == 1
    assert len(_FileDAO.created) == 1
    record = _FileDAO.created[0]
    output = Path(record["file_path"])
    probe = subprocess.run([ffprobe, "-v", "error", "-show_entries",
                            "stream=codec_name,codec_type:format=duration,format_name", "-of", "json", str(output)],
                           check=True, capture_output=True, text=True, timeout=10)
    details = json.loads(probe.stdout)
    assert "mp4" in details["format"]["format_name"]
    assert float(details["format"]["duration"]) == pytest.approx(1, abs=0.15)
    assert any(stream["codec_type"] == "video" and stream["codec_name"] == "h264" for stream in details["streams"])
    assert any(stream["codec_type"] == "audio" for stream in details["streams"]) is with_audio
    subprocess.run([ffmpeg, "-nostdin", "-v", "error", "-i", str(output), "-f", "null", "-"],
                   check=True, capture_output=True, timeout=10)
    assert record["file_id"] == result["file_id"]
    assert record["version_id"] == "version_1"
    assert record["mime_type"] == "video/mp4"
    assert record["metadata"]["duration"] == result["duration"]
    assert result["size"] == record["file_size_bytes"] == output.stat().st_size > 0
    assert hashlib.sha256(source.read_bytes()).hexdigest() == original_digest
    assert list(output_root.rglob("*.tmp")) == []
    assert list(output_root.rglob("*.mp4")) == [output]


@pytest.mark.asyncio
@pytest.mark.parametrize("start,end", [(float("nan"), 1), (0, float("nan")),
                                        (float("inf"), float("inf")), (0, float("inf")),
                                        (-float("inf"), 1)])
async def test_public_crop_rejects_non_finite_times_before_side_effects(tmp_path, start, end):
    checker = AsyncMock(side_effect=AssertionError("Invalid times cannot read files"))
    with pytest.raises(svc.PublicVideoCropInvalidRequest):
        await svc.crop_public_video_file(
            video_ref="file_source", start_time=start, end_time=end, identity="yuan",
            file_dao=_FileDAO, deploy_root=tmp_path, logger=_Logger(),
            file_access_checker=checker, ffmpeg_available=lambda _name: "ffmpeg",
        )
    checker.assert_not_awaited()
    assert _FileDAO.created == []


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["ffmpeg_error", "timeout", "empty", "database_reject", "database_error"])
async def test_failed_crop_never_leaves_a_published_or_temporary_result(tmp_path, monkeypatch, failure):
    deploy_root = tmp_path / "deploy"
    source = deploy_root / "persistent_storage" / "source.mp4"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"unchanged-source")
    _FileDAO.source = {"file_id": "file_source", "file_type": "video", "file_path": str(source)}
    create = AsyncMock(return_value=None)
    if failure == "database_error":
        create.side_effect = RuntimeError("Database unavailable")
    monkeypatch.setattr(_FileDAO, "create_file", create)

    def runner(command, **_kwargs):
        assert command[command.index("-f") + 1] == "mp4"
        Path(command[-1]).write_bytes(b"" if failure == "empty" else b"partial-output")
        if failure == "timeout":
            raise subprocess.TimeoutExpired(command, 1)
        return SimpleNamespace(returncode=1 if failure == "ffmpeg_error" else 0, stderr="")

    output_root = tmp_path / "output"
    with pytest.raises(svc.PublicVideoCropFailed):
        await svc.crop_public_video_file(
            video_ref="file_source", start_time=0, end_time=1, identity="yuan",
            file_dao=_FileDAO, deploy_root=deploy_root, logger=_Logger(),
            file_access_checker=_allow_file, storage_root=output_root,
            ffmpeg_available=lambda _name: "ffmpeg", ffmpeg_runner=runner,
        )
    if failure.startswith("database_"):
        create.assert_awaited_once()
    else:
        create.assert_not_awaited()
    assert source.read_bytes() == b"unchanged-source"
    assert [path for path in output_root.rglob("*") if path.is_file()] == []
