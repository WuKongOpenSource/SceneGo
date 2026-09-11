from datetime import datetime
from types import SimpleNamespace

import pytest

from services import project_video_task_service as svc


class _ProjectDAO:
    row = None
    saved = []

    @classmethod
    async def get_project(cls, project_id):
        if cls.row is None:
            return None
        return {**cls.row, "project_id": project_id}

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
    pass


class _StoryboardDAO:
    rows = {}
    calls = []

    @classmethod
    async def get_by_id(cls, item_id):
        cls.calls.append(item_id)
        row = cls.rows.get(item_id)
        return {**row} if row else None


class _EntityFileDAO:
    selected_files = {}
    entity_files = {}
    selected_calls = []
    entity_file_calls = []

    @classmethod
    async def get_selected_file(cls, entity_type, entity_id, file_role):
        cls.selected_calls.append((entity_type, entity_id, file_role))
        row = cls.selected_files.get((entity_type, entity_id, file_role))
        return {**row} if row else None

    @classmethod
    async def get_entity_files(cls, entity_type, entity_id, file_role=None, limit=50, offset=0):
        cls.entity_file_calls.append((entity_type, entity_id, file_role, limit, offset))
        rows = cls.entity_files.get((entity_type, entity_id, file_role), [])
        return {"items": [{**row} for row in rows], "total": len(rows)}


class _ContentWorkflowDAO:
    calls = []

    @classmethod
    async def resolve_bindings(cls, project_id, item_id, tag_keys):
        cls.calls.append((project_id, item_id, tag_keys))
        return [
            {
                "binding_id": "binding_shot",
                "binding_version": 3,
                "tag_key": "char:小悟",
                "scope": "shot",
                "asset_id": "asset_new",
                "file_id": "file_new",
                "effective_url": "/storage/new-reference.webp",
                "is_disabled": False,
                "locked": True,
            }
        ]


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


@pytest.fixture(autouse=True)
def _reset_fakes():
    _ProjectDAO.row = {
        "user_id": "yuan",
        "project_name": "Demo",
        "description": "desc",
        "settings": {
            "storyboard": {
                "items": [
                    {
                        "id": "shot_1",
                        "videoPrompt": "move camera",
                        "actionText": "walk to the door",
                        "dialogue": "hello",
                        "characters": ["A"],
                        "scene": "Opening",
                    },
                    {
                        "id": "shot_2",
                        "videoPrompt": "wide shot",
                        "dialogue": "",
                        "characters": [],
                        "scene": "Room",
                    },
                ]
            },
            "generated_images": {
                "shot_1": {
                    "selectedImageId": "img_2",
                    "images": [
                        {"id": "img_1", "url": "/api/files/first/download"},
                        {"id": "img_2", "thumbnail": "/storage/selected-thumb.webp"},
                    ],
                },
                "shot_2": {
                    "images": [
                        {
                            "id": "img_3",
                            "url": "data:image/png;base64,ZmFrZQ==",
                        }
                    ]
                },
            },
            "video_tasks": [{"storyboard_id": "old"}],
            "stage": 3,
        },
    }
    _ProjectDAO.saved = []
    _VersionDAO.versions = [{"version_id": "ver_existing"}]
    _VersionDAO.created = []
    _StoryboardDAO.rows = {}
    _StoryboardDAO.calls = []
    _EntityFileDAO.selected_files = {}
    _EntityFileDAO.entity_files = {}
    _EntityFileDAO.selected_calls = []
    _EntityFileDAO.entity_file_calls = []
    _ContentWorkflowDAO.calls = []
    _Logger.infos = []
    _Logger.warnings = []
    _Logger.errors = []


@pytest.mark.asyncio
async def test_export_project_to_video_response_uses_selected_images_and_saves_stage():
    result = await svc.export_project_to_video_response(
        "proj_1",
        selected_items=["shot_1"],
        username="yuan",
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        file_dao=_FileDAO,
        logger=_Logger,
        now_provider=lambda: datetime(2026, 6, 23, 1, 2, 3),
    )

    assert result == {
        "success": True,
        "exported_count": 1,
        "video_tasks": [
            {
                "storyboard_id": "shot_1",
                "image_url": "/storage/selected-thumb.webp",
                "video_prompt": "move camera",
                "action_text": "walk to the door",
                "dialogue": "hello",
                "characters": ["A"],
                "scene": "Opening",
            }
        ],
    }
    saved = _ProjectDAO.saved[0]
    assert saved["project_id"] == "proj_1"
    assert saved["project_name"] == "Demo"
    assert saved["description"] == "desc"
    assert saved["project_data"]["stage"] == 4
    assert saved["project_data"]["updated_at"] == "2026-06-23T01:02:03"
    assert saved["project_data"]["video_tasks"] == result["video_tasks"]
    assert _VersionDAO.created == []


@pytest.mark.asyncio
async def test_export_project_to_video_response_persists_base64_and_creates_version():
    _VersionDAO.versions = []
    persist_calls = []

    async def fake_persist(**kwargs):
        persist_calls.append(kwargs)
        return SimpleNamespace(file_id="file_new", file_url="/api/files/file_new/download")

    result = await svc.export_project_to_video_response(
        "proj_1",
        selected_items=["shot_2"],
        username="yuan",
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        file_dao=_FileDAO,
        logger=_Logger,
        now_provider=lambda: datetime(2026, 6, 23),
        persist_image=fake_persist,
    )

    assert result["video_tasks"][0]["image_url"] == "/api/files/file_new/download"
    assert _VersionDAO.created[0]["project_id"] == "proj_1"
    assert _VersionDAO.created[0]["version_name"] == "\u5bfc\u51fa\u7248\u672c"
    assert persist_calls[0]["version_id"] == "ver_created"
    assert persist_calls[0]["storyboard_item"]["id"] == "shot_2"


@pytest.mark.asyncio
async def test_export_project_to_video_response_falls_back_to_base64_when_persist_fails():
    async def broken_persist(**_kwargs):
        raise RuntimeError("convert failed")

    result = await svc.export_project_to_video_response(
        "proj_1",
        selected_items=["shot_2"],
        username="yuan",
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        file_dao=_FileDAO,
        logger=_Logger,
        persist_image=broken_persist,
    )

    assert result["video_tasks"][0]["image_url"].startswith("data:image/png;base64,")
    assert _Logger.errors
    assert _Logger.warnings


@pytest.mark.asyncio
async def test_export_project_to_video_response_prefers_current_selected_entity_file():
    _StoryboardDAO.rows = {
        "shot_1": {
            "item_id": "shot_1",
            "video_prompt": "db prompt",
            "action_text": "db action",
            "dialogue": "db line",
            "generated_image_url": "/storage/db-current.webp",
            "bound_assets": ["char:小悟", "scene:教室"],
        }
    }
    _EntityFileDAO.selected_files = {
        ("storyboard_item", "shot_1", "generated_image"): {
            "file_id": "file_selected",
            "file_url": "/storage/entity-selected.webp",
            "is_selected": True,
        }
    }

    result = await svc.export_project_to_video_response(
        "proj_1",
        selected_items=["shot_1"],
        username="yuan",
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        file_dao=_FileDAO,
        logger=_Logger,
        storyboard_dao=_StoryboardDAO,
        entity_file_dao=_EntityFileDAO,
    )

    task = result["video_tasks"][0]
    assert task["image_url"] == "/storage/entity-selected.webp"
    assert task["video_prompt"] == "db prompt"
    assert task["action_text"] == "db action"
    assert task["dialogue"] == "db line"
    assert task["characters"] == ["小悟"]
    assert task["scene"] == "教室"
    assert _StoryboardDAO.calls == ["shot_1"]
    assert _EntityFileDAO.selected_calls == [("storyboard_item", "shot_1", "generated_image")]


@pytest.mark.asyncio
async def test_export_project_to_video_resolves_latest_binding_at_task_creation():
    _StoryboardDAO.rows = {
        "shot_1": {
            "item_id": "shot_1",
            "video_prompt": "db prompt",
            "generated_image_url": "/storage/keyframe.webp",
            "bound_assets": ["char:小悟"],
        }
    }

    result = await svc.export_project_to_video_response(
        "proj_1",
        selected_items=["shot_1"],
        username="yuan",
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        file_dao=_FileDAO,
        logger=_Logger,
        storyboard_dao=_StoryboardDAO,
        entity_file_dao=_EntityFileDAO,
        content_workflow_dao=_ContentWorkflowDAO,
    )

    assert _ContentWorkflowDAO.calls == [("proj_1", "shot_1", ["char:小悟"])]
    assert result["video_tasks"][0]["resolved_bindings"] == [
        {
            "binding_id": "binding_shot",
            "binding_version": 3,
            "tag_key": "char:小悟",
            "scope": "shot",
            "asset_id": "asset_new",
            "file_id": "file_new",
            "file_url": "/storage/new-reference.webp",
            "is_disabled": False,
            "locked": True,
        }
    ]


@pytest.mark.asyncio
async def test_export_project_to_video_response_exports_db_only_storyboard_item():
    _StoryboardDAO.rows = {
        "sb_db_only": {
            "item_id": "sb_db_only",
            "video_prompt": "new db prompt",
            "action_text": "new db action",
            "dialogue": "new db line",
            "generated_image_url": "/storage/db-only.webp",
            "bound_assets": ["char:小空"],
        }
    }

    result = await svc.export_project_to_video_response(
        "proj_1",
        selected_items=["sb_db_only"],
        username="yuan",
        project_dao=_ProjectDAO,
        version_dao=_VersionDAO,
        file_dao=_FileDAO,
        logger=_Logger,
        storyboard_dao=_StoryboardDAO,
        entity_file_dao=_EntityFileDAO,
    )

    assert result["exported_count"] == 1
    assert result["video_tasks"] == [
        {
            "storyboard_id": "sb_db_only",
            "image_url": "/storage/db-only.webp",
            "video_prompt": "new db prompt",
            "action_text": "new db action",
            "dialogue": "new db line",
            "characters": ["小空"],
            "scene": "",
        }
    ]


@pytest.mark.asyncio
async def test_clear_project_video_tasks_response_saves_empty_tasks():
    result = await svc.clear_project_video_tasks_response(
        "proj_1",
        username="yuan",
        project_dao=_ProjectDAO,
        logger=_Logger,
    )

    assert result == {"success": True, "cleared_count": 1}
    assert _ProjectDAO.saved[0]["project_data"]["video_tasks"] == []


@pytest.mark.asyncio
async def test_video_task_service_handles_missing_and_forbidden_project():
    _ProjectDAO.row = None
    with pytest.raises(svc.ProjectVideoTaskNotFound):
        await svc.clear_project_video_tasks_response(
            "proj_missing",
            username="yuan",
            project_dao=_ProjectDAO,
            logger=_Logger,
        )

    _ProjectDAO.row = {"user_id": "owner", "settings": {}}
    with pytest.raises(svc.ProjectVideoTaskForbidden):
        await svc.export_project_to_video_response(
            "proj_1",
            selected_items=[],
            username="visitor",
            project_dao=_ProjectDAO,
            version_dao=_VersionDAO,
            file_dao=_FileDAO,
            logger=_Logger,
        )
