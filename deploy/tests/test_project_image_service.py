import base64
from datetime import datetime

import pytest

from services import project_image_service as svc


class _ProjectDAO:
    projects = []
    saved = []

    @classmethod
    async def get_user_projects(cls, username):
        cls.last_user = username
        return cls.projects

    @classmethod
    async def save_or_update_project(cls, **kwargs):
        cls.saved.append(kwargs)
        return kwargs


class _VersionDAO:
    versions = []
    created = []

    @classmethod
    async def get_project_versions(cls, project_id):
        cls.last_project_id = project_id
        return cls.versions

    @classmethod
    async def create_version(cls, **kwargs):
        cls.created.append(kwargs)
        return {"version_id": "ver_created"}


class _FileDAO:
    created = []

    @classmethod
    async def create_file(cls, **kwargs):
        cls.created.append(kwargs)
        return {**kwargs, "file_id": kwargs["file_id"]}


class _Logger:
    infos = []

    @classmethod
    def info(cls, *args, **kwargs):
        cls.infos.append((args, kwargs))


@pytest.fixture(autouse=True)
def _reset_fakes():
    _ProjectDAO.projects = []
    _ProjectDAO.saved = []
    _VersionDAO.versions = []
    _VersionDAO.created = []
    _FileDAO.created = []
    _Logger.infos = []


def _data_image(content: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(content).decode("ascii")


@pytest.mark.asyncio
async def test_persist_project_embedded_base64_image_creates_default_version_and_webp_file(tmp_path):
    uuid_values = iter(["img1234567890", "proj123456789"])

    result = await svc.persist_project_embedded_base64_image(
        username="yuan",
        image_data=_data_image(b"raw-image"),
        context="scene/intro:full",
        file_dao=_FileDAO,
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        logger=_Logger,
        storage_root=tmp_path,
        now_provider=lambda: datetime(2026, 6, 23),
        uuid_hex_provider=lambda: next(uuid_values),
        webp_converter=lambda *_args, **_kwargs: b"webp-image",
    )

    expected_path = tmp_path / "images" / "yuan" / "202606" / "file_img123456789_scene_intro_full.webp"
    assert result.file_id == "file_img123456789"
    assert result.file_url == "/api/files/file_img123456789/download"
    assert result.file_path == str(expected_path)
    assert expected_path.read_bytes() == b"webp-image"
    assert _ProjectDAO.saved[0]["project_id"] == "proj_proj12345678"
    assert _VersionDAO.created[0]["project_id"] == "proj_proj12345678"
    created = _FileDAO.created[0]
    assert created["version_id"] == "ver_created"
    assert created["file_name"] == "scene/intro:full.webp"
    assert created["mime_type"] == "image/webp"
    assert created["metadata"] == {"source": "base64_convert", "context": "scene/intro:full"}


@pytest.mark.asyncio
async def test_persist_project_embedded_base64_image_reuses_existing_version_and_raw_fallback(tmp_path):
    _ProjectDAO.projects = [{"project_id": "proj_existing"}]
    _VersionDAO.versions = [{"version_id": "ver_existing"}]

    result = await svc.persist_project_embedded_base64_image(
        username="yuan",
        image_data=_data_image(b"raw-image"),
        context="generated_shot_1",
        file_dao=_FileDAO,
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        logger=_Logger,
        storage_root=tmp_path,
        now_provider=lambda: datetime(2026, 6, 23),
        uuid_hex_provider=lambda: "img1234567890",
        webp_converter=lambda *_args, **_kwargs: None,
    )

    assert result.file_url == "/api/files/file_img123456789/download"
    assert _ProjectDAO.saved == []
    assert _VersionDAO.created == []
    assert (tmp_path / "images" / "yuan" / "202606" / "file_img123456789_generated_shot_1.webp").read_bytes() == b"raw-image"
    assert _FileDAO.created[0]["version_id"] == "ver_existing"


@pytest.mark.asyncio
async def test_persist_export_storyboard_base64_image_uses_existing_version(tmp_path):
    item = {"id": "shot_1", "scene": "Opening", "shotNumber": "3"}

    result = await svc.persist_export_storyboard_base64_image(
        username="yuan",
        image_data=_data_image(b"png-image"),
        storyboard_item=item,
        version_id="ver_export",
        file_dao=_FileDAO,
        logger=_Logger,
        storage_root=tmp_path,
        now_provider=lambda: datetime(2026, 6, 23),
        timestamp_provider=lambda: 1234567890,
        uuid_hex_provider=lambda: "exp1234567890",
    )

    expected_path = tmp_path / "images" / "yuan" / "202606" / "exported_shot_1_1234567890.png"
    assert result.file_id == "file_exp123456789"
    assert result.file_url == "/api/files/file_exp123456789/download"
    assert expected_path.read_bytes() == b"png-image"
    created = _FileDAO.created[0]
    assert created["version_id"] == "ver_export"
    assert created["file_name"] == "Opening_shot_1.png"
    assert created["file_path"] == str(expected_path)
    assert created["metadata"] == {
        "source": "export_to_video",
        "storyboard_id": "shot_1",
        "scene": "Opening",
        "shot_number": "3",
    }
