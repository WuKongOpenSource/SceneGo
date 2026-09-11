from datetime import datetime
from pathlib import Path

import pytest

from services import legacy_file_service as svc


class _Logger:
    def __init__(self):
        self.warnings = []
        self.errors = []

    def info(self, *_args, **_kwargs):
        pass

    def debug(self, *_args, **_kwargs):
        pass

    def warning(self, *args, **_kwargs):
        self.warnings.append(args)

    def error(self, *args, **_kwargs):
        self.errors.append(args)


class _VersionDAO:
    row = {"version_id": "v1", "user_id": "yuan"}

    @classmethod
    async def get_version(cls, _version_id):
        return cls.row


class _UserDAO:
    row = {"used_storage_bytes": 0, "storage_quota_gb": 1}

    @classmethod
    async def get_user_by_id(cls, _user_id):
        return cls.row


class _FileDAO:
    records = {}
    created = []
    deleted = []

    @classmethod
    def reset(cls):
        cls.records = {}
        cls.created = []
        cls.deleted = []

    @classmethod
    async def create_file(cls, **kwargs):
        cls.created.append(kwargs)
        record = {"file_id": "file_created", **kwargs}
        cls.records[record["file_id"]] = record
        return record

    @classmethod
    async def get_file(cls, file_id):
        return cls.records.get(file_id)

    @classmethod
    async def delete_file(cls, file_id):
        cls.deleted.append(file_id)


class _ActivityLogDAO:
    logs = []

    @classmethod
    def reset(cls):
        cls.logs = []

    @classmethod
    async def log_activity(cls, **kwargs):
        cls.logs.append(kwargs)


class _Optimization:
    thumbnails = []

    @classmethod
    def reset(cls):
        cls.thumbnails = []

    @staticmethod
    async def calculate_file_hash(path):
        return f"hash:{Path(path).name}"

    @classmethod
    async def create_thumbnail(cls, src, dst):
        cls.thumbnails.append((src, dst))

    @staticmethod
    async def file_chunked_reader(path):
        yield Path(path).read_bytes()


class _Deduplication:
    duplicate = None
    linked = []

    @classmethod
    def reset(cls):
        cls.duplicate = None
        cls.linked = []

    @classmethod
    async def check_duplicate(cls, _file_hash, _user_id):
        return cls.duplicate

    @classmethod
    async def link_duplicate_file(cls, duplicate, version_id, user_id):
        cls.linked.append((duplicate, version_id, user_id))
        return {"file_id": "file_duplicate", "duplicate": duplicate}


class _JwtAuth:
    username = "yuan"

    @classmethod
    def verify_token(cls, _token):
        return cls.username


@pytest.fixture(autouse=True)
def _reset_fakes():
    _VersionDAO.row = {"version_id": "v1", "user_id": "yuan"}
    _UserDAO.row = {"used_storage_bytes": 0, "storage_quota_gb": 1}
    _FileDAO.reset()
    _ActivityLogDAO.reset()
    _Optimization.reset()
    _Deduplication.reset()
    _JwtAuth.username = "yuan"


@pytest.mark.asyncio
async def test_upload_legacy_file_writes_image_and_records_activity(tmp_path):
    result = await svc.upload_legacy_file(
        version_id="v1",
        filename="shot.png",
        content_type="image/png",
        content=b"image-bytes",
        user_id="yuan",
        user_dao=_UserDAO,
        version_dao=_VersionDAO,
        file_dao=_FileDAO,
        activity_log_dao=_ActivityLogDAO,
        file_optimization_service=_Optimization,
        file_deduplication_service=_Deduplication,
        storage_root=tmp_path,
        now_provider=lambda: datetime(2026, 6, 23),
        uuid_hex_provider=lambda: "abcdef1234567890",
    )

    assert result["success"] is True
    created = _FileDAO.created[0]
    assert created["file_type"] == "image"
    assert created["file_path"].endswith("file_abcdef123456.png")
    assert Path(created["file_path"]).read_bytes() == b"image-bytes"
    assert created["metadata"] == {"file_hash": "hash:file_abcdef123456.png"}
    assert _Optimization.thumbnails
    assert _ActivityLogDAO.logs[0]["action"] == "upload_file"


@pytest.mark.asyncio
async def test_upload_legacy_file_rejects_foreign_version_and_quota(tmp_path):
    _VersionDAO.row = {"version_id": "v1", "user_id": "other"}
    with pytest.raises(svc.LegacyFileForbidden):
        await svc.upload_legacy_file(
            version_id="v1",
            filename="shot.png",
            content_type="image/png",
            content=b"x",
            user_id="yuan",
            user_dao=_UserDAO,
            version_dao=_VersionDAO,
            file_dao=_FileDAO,
            activity_log_dao=_ActivityLogDAO,
            file_optimization_service=_Optimization,
            file_deduplication_service=_Deduplication,
            storage_root=tmp_path,
        )

    _VersionDAO.row = {"version_id": "v1", "user_id": "yuan"}
    _UserDAO.row = {"used_storage_bytes": 1, "storage_quota_gb": 0}
    with pytest.raises(svc.LegacyStorageQuotaExceeded):
        await svc.upload_legacy_file(
            version_id="v1",
            filename="shot.png",
            content_type="image/png",
            content=b"x",
            user_id="yuan",
            user_dao=_UserDAO,
            version_dao=_VersionDAO,
            file_dao=_FileDAO,
            activity_log_dao=_ActivityLogDAO,
            file_optimization_service=_Optimization,
            file_deduplication_service=_Deduplication,
            storage_root=tmp_path,
        )


@pytest.mark.asyncio
async def test_upload_legacy_file_links_duplicate(tmp_path):
    _Deduplication.duplicate = {"file_id": "old"}

    result = await svc.upload_legacy_file(
        version_id="v1",
        filename="clip.mp4",
        content_type="video/mp4",
        content=b"video-bytes",
        user_id="yuan",
        user_dao=_UserDAO,
        version_dao=_VersionDAO,
        file_dao=_FileDAO,
        activity_log_dao=_ActivityLogDAO,
        file_optimization_service=_Optimization,
        file_deduplication_service=_Deduplication,
        storage_root=tmp_path,
    )

    assert result["file"]["file_id"] == "file_duplicate"
    assert _FileDAO.created == []
    assert _Deduplication.linked == [({"file_id": "old"}, "v1", "yuan")]


@pytest.mark.asyncio
async def test_get_legacy_download_info_supports_range_and_fallback_paths(tmp_path):
    actual_path = tmp_path / "temp" / "uploads" / "videos" / "yuan" / "202606" / "clip.mp4"
    actual_path.parent.mkdir(parents=True)
    actual_path.write_bytes(b"0123456789")
    _FileDAO.records["file1"] = {
        "file_id": "file1",
        "user_id": "yuan",
        "file_name": "clip.mp4",
        "file_path": "persistent_storage/videos/yuan/202606/clip.mp4",
        "mime_type": "video/mp4",
    }

    async def allow_file(*_args, **_kwargs):
        return _FileDAO.records["file1"]

    info = await svc.get_legacy_download_info(
        file_id="file1",
        range_header="bytes=2-5",
        identity="yuan",
        deploy_root=tmp_path,
        file_dao=_FileDAO,
        logger=_Logger(),
        file_access_checker=allow_file,
    )

    assert Path(info.file_path) == actual_path
    assert info.range_start == 2
    assert info.range_end == 5
    assert info.content_length == 4
    assert info.encoded_filename == "clip.mp4"
    assert info.mime_type == "video/mp4"
    assert info.content_disposition.startswith("inline;")


@pytest.mark.asyncio
async def test_get_legacy_download_info_never_inlines_html_from_stored_mime(tmp_path):
    storage_root = tmp_path / "persistent_storage"
    source = storage_root / "others" / "yuan" / "payload.html"
    source.parent.mkdir(parents=True)
    source.write_text("<script>alert(1)</script>", encoding="utf-8")
    _FileDAO.records["file_html"] = {
        "file_id": "file_html",
        "user_id": "yuan",
        "file_name": "payload.html",
        "file_path": str(source),
        "mime_type": "text/html",
    }

    async def allow_file(*_args, **_kwargs):
        return _FileDAO.records["file_html"]

    info = await svc.get_legacy_download_info(
        file_id="file_html",
        range_header=None,
        identity="yuan",
        deploy_root=tmp_path,
        file_dao=_FileDAO,
        logger=_Logger(),
        file_access_checker=allow_file,
    )

    assert info.mime_type == "application/octet-stream"
    assert info.content_disposition.startswith("attachment;")
    assert info.extra_headers["Content-Security-Policy"].startswith("sandbox")


@pytest.mark.asyncio
async def test_get_legacy_download_info_raises_when_missing(tmp_path):
    with pytest.raises(svc.LegacyFileNotFound):
        await svc.get_legacy_download_info(
            file_id="missing",
            range_header=None,
            identity="yuan",
            deploy_root=tmp_path,
            file_dao=_FileDAO,
            logger=_Logger(),
        )


@pytest.mark.asyncio
async def test_get_legacy_download_info_hides_forbidden_file(tmp_path):
    source = tmp_path / "private.mp4"
    source.write_bytes(b"private")
    _FileDAO.records["file_private"] = {
        "file_id": "file_private",
        "user_id": "another-user",
        "file_name": "private.mp4",
        "file_path": str(source),
        "mime_type": "video/mp4",
    }

    async def deny_file(*_args, **_kwargs):
        raise svc.EntityAccessDenied("denied")

    with pytest.raises(svc.LegacyFileNotFound):
        await svc.get_legacy_download_info(
            file_id="file_private",
            range_header=None,
            identity="yuan",
            deploy_root=tmp_path,
            file_dao=_FileDAO,
            logger=_Logger(),
            file_access_checker=deny_file,
        )


@pytest.mark.asyncio
async def test_get_legacy_download_info_rejects_authorized_path_outside_media_roots(tmp_path):
    source = tmp_path / "outside.mp4"
    source.write_bytes(b"private")
    (tmp_path / "persistent_storage").mkdir()
    _FileDAO.records["file_escape"] = {
        "file_id": "file_escape",
        "user_id": "yuan",
        "file_name": "outside.mp4",
        "file_path": str(source),
        "mime_type": "video/mp4",
    }

    async def allow_file(*_args, **_kwargs):
        return _FileDAO.records["file_escape"]

    with pytest.raises(svc.LegacyFileNotFound):
        await svc.get_legacy_download_info(
            file_id="file_escape",
            range_header=None,
            identity="yuan",
            deploy_root=tmp_path,
            file_dao=_FileDAO,
            logger=_Logger(),
            file_access_checker=allow_file,
        )


@pytest.mark.asyncio
async def test_delete_legacy_file_checks_owner_and_logs_activity():
    _FileDAO.records["file1"] = {"file_id": "file1", "user_id": "yuan"}

    result = await svc.delete_legacy_file(
        file_id="file1",
        user_id="yuan",
        file_dao=_FileDAO,
        activity_log_dao=_ActivityLogDAO,
    )

    assert result == {"success": True, "message": "文件已删除"}
    assert _FileDAO.deleted == ["file1"]
    assert _ActivityLogDAO.logs[0]["action"] == "delete_file"

    with pytest.raises(svc.LegacyFileForbidden):
        await svc.delete_legacy_file(
            file_id="file1",
            user_id="other",
            file_dao=_FileDAO,
            activity_log_dao=_ActivityLogDAO,
        )
