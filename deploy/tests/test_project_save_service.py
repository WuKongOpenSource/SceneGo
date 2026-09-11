import base64
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services import project_save_service as svc


class _ProjectDAO:
    row = None
    saved = []

    @classmethod
    async def get_project(cls, project_id):
        cls.last_project_id = project_id
        return cls.row

    @classmethod
    async def save_or_update_project(cls, **kwargs):
        cls.saved.append(kwargs)
        return kwargs


class _FileDAO:
    pass


class _VersionDAO:
    pass


class _Logger:
    infos = []
    warnings = []
    errors = []

    @classmethod
    def info(cls, *args, **kwargs):
        cls.infos.append((args, kwargs))

    @classmethod
    def warning(cls, *args, **kwargs):
        cls.warnings.append((args, kwargs))

    @classmethod
    def error(cls, *args, **kwargs):
        cls.errors.append((args, kwargs))


class _Project:
    def __init__(self, **kwargs):
        self.project_id = kwargs.pop("project_id", "proj_1")
        self.name = kwargs.pop("name", "Demo")
        self.user_id = kwargs.pop("user_id", None)
        self.created_at = kwargs.pop("created_at", None)
        self.updated_at = kwargs.pop("updated_at", None)
        self._data = kwargs

    def model_dump(self):
        return {
            "project_id": self.project_id,
            "name": self.name,
            "user_id": self.user_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            **self._data,
        }


@pytest.fixture(autouse=True)
def _reset_fakes():
    _ProjectDAO.row = None
    _ProjectDAO.saved = []
    _Logger.infos = []
    _Logger.warnings = []
    _Logger.errors = []


def _data_image(content: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(content).decode("ascii")


@pytest.mark.asyncio
async def test_save_project_response_preserves_existing_collections_and_recovers_urls():
    _ProjectDAO.row = {
        "user_id": "yuan",
        "settings": {
            "video_tasks": [{"storyboard_id": "old"}],
            "generated_images": {
                "shot_1": {
                    "images": [
                        {"url": "/api/files/original/download"},
                        {"url": "/api/files/second/download"},
                    ]
                }
            },
        }
    }
    project = _Project(
        generated_images={
            "shot_1": {
                "selectedImageId": "img_1",
                "images": [
                    {"id": "img_1", "thumbnail": "/thumb/one.webp"},
                    {"id": "img_2", "url": "", "thumbnail": "/thumb/two.webp"},
                    {"id": "img_3", "thumbnail": "/thumb/three.webp"},
                ],
            }
        },
        video_tasks=None,
    )

    result = await svc.save_project_response(
        project,
        username="yuan",
        project_dao=_ProjectDAO,
        file_dao=_FileDAO,
        version_dao=_VersionDAO,
        logger=_Logger,
        now_provider=lambda: datetime(2026, 6, 23, 4, 5, 6),
    )

    saved = _ProjectDAO.saved[0]
    data = saved["project_data"]
    assert result["success"] is True
    assert project.user_id == "yuan"
    assert project.created_at == "2026-06-23T04:05:06"
    assert project.updated_at == "2026-06-23T04:05:06"
    assert data["video_tasks"] == [{"storyboard_id": "old"}]
    assert data["generated_images"]["shot_1"]["images"][0]["url"] == "/api/files/original/download"
    assert data["generated_images"]["shot_1"]["images"][1]["url"] == "/api/files/second/download"
    assert data["generated_images"]["shot_1"]["images"][2]["url"] == "/thumb/three.webp"
    assert saved["user_id"] == "yuan"
    assert saved["project_name"] == "Demo"


@pytest.mark.asyncio
@pytest.mark.parametrize("owner", ["another-user", None, ""])
async def test_save_rejects_non_owner_before_converting_images(owner):
    _ProjectDAO.row = {"user_id": owner, "settings": {"video_tasks": [{"private": True}]}}
    persist = AsyncMock()
    project = _Project(material_library={"scene": [{"url": _data_image(b"fixture")}]})

    with pytest.raises(svc.ProjectSaveForbidden):
        await svc.save_project_response(
            project, username="yuan", project_dao=_ProjectDAO,
            file_dao=_FileDAO, version_dao=_VersionDAO, logger=_Logger,
            persist_image=persist,
        )

    persist.assert_not_awaited()
    assert not _ProjectDAO.saved
    assert project.user_id is None and project.updated_at is None


@pytest.mark.asyncio
async def test_save_fails_closed_if_existing_project_lookup_fails(monkeypatch):
    monkeypatch.setattr(_ProjectDAO, "get_project", AsyncMock(side_effect=RuntimeError("database unavailable")))
    persist = AsyncMock()

    with pytest.raises(RuntimeError, match="database unavailable"):
        await svc.save_project_response(
            _Project(), username="yuan", project_dao=_ProjectDAO,
            file_dao=_FileDAO, version_dao=_VersionDAO, logger=_Logger,
            persist_image=persist,
        )

    persist.assert_not_awaited()
    assert not _ProjectDAO.saved


@pytest.mark.asyncio
async def test_save_does_not_claim_success_when_conditional_write_returns_no_row(monkeypatch):
    _ProjectDAO.row = {"user_id": "yuan", "settings": {}}
    save = AsyncMock(return_value=None)
    monkeypatch.setattr(_ProjectDAO, "save_or_update_project", save)

    with pytest.raises(svc.ProjectSaveForbidden):
        await svc.save_project_response(
            _Project(), username="yuan", project_dao=_ProjectDAO,
            file_dao=_FileDAO, version_dao=_VersionDAO, logger=_Logger,
        )

    save.assert_awaited_once()
    assert not any("Saved project to database" in str(args) for args, _ in _Logger.infos)


@pytest.mark.asyncio
async def test_convert_base64_images_in_project_data_persists_nested_images():
    persist_calls = []

    async def fake_persist(**kwargs):
        persist_calls.append(kwargs)
        return SimpleNamespace(file_url=f"/api/files/{kwargs['context']}/download")

    project_data = {
        "material_library": {
            "scene": [{"url": _data_image(b"material"), "thumbnail": _data_image(b"thumb")}]
        },
        "generated_images": {
            "shot_1": {"images": [{"url": _data_image(b"generated")}]},
            "shot_2": [_data_image(b"legacy")],
        },
        "storyboard": {
            "items": [
                {
                    "id": "shot_1",
                    "references": [{"url": _data_image(b"ref")}],
                    "generatedImages": [_data_image(b"item")],
                }
            ]
        },
        "versions": [
            {
                "data": {
                    "materialLibrary": {"role": [{"url": _data_image(b"version-material")}]},
                    "storyboard": {
                        "items": [
                            {
                                "id": "shot_v",
                                "references": [{"url": _data_image(b"version-ref")}],
                                "generatedImages": [{"url": _data_image(b"version-gen")}],
                            }
                        ]
                    },
                }
            }
        ],
    }

    result = await svc.convert_base64_images_in_project_data(
        project_data,
        username="yuan",
        file_dao=_FileDAO,
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        logger=_Logger,
        persist_image=fake_persist,
    )

    contexts = [call["context"] for call in persist_calls]
    assert "material_scene_0_full" in contexts
    assert "material_scene_0_thumb" in contexts
    assert "generated_shot_1_0_full" in contexts
    assert "generated_shot_2_0" in contexts
    assert "ref_shot_1_0_full" in contexts
    assert "item_shot_1_gen_0" in contexts
    assert "v0_material_role_0" in contexts
    assert "v0_ref_shot_v_0" in contexts
    assert "v0_gen_shot_v_0" in contexts
    assert result["material_library"]["scene"][0]["url"] == "/api/files/material_scene_0_full/download"
    assert result["generated_images"]["shot_2"][0] == "/api/files/generated_shot_2_0/download"


@pytest.mark.asyncio
async def test_convert_base64_images_in_project_data_keeps_original_when_persist_fails():
    original = _data_image(b"broken")

    async def broken_persist(**_kwargs):
        raise RuntimeError("persist failed")

    result = await svc.convert_base64_images_in_project_data(
        {"material_library": {"scene": [{"url": original}]}},
        username="yuan",
        file_dao=_FileDAO,
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        logger=_Logger,
        persist_image=broken_persist,
    )

    assert result["material_library"]["scene"][0]["url"] == original
    assert _Logger.errors
