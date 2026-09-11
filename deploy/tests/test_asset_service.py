from __future__ import annotations

from unittest.mock import Mock

import pytest

from services import asset_service


class FakeAssetDAO:
    default_rows = [
        {"asset_id": "asset_1", "project_id": "proj_1", "asset_type": "character", "name": "主角"},
        {"asset_id": "asset_2", "project_id": "proj_1", "asset_type": "scene", "name": "教室"},
    ]
    rows = list(default_rows)
    created = None
    updated = None
    updates = []
    deleted = []
    copied = None
    renamed = None

    @classmethod
    async def get_by_project(cls, project_id, episode_id=None, asset_type=None, script_id=None):
        return [
            row
            for row in cls.rows
            if row["project_id"] == project_id
            and (asset_type is None or row["asset_type"] == asset_type)
        ]

    @classmethod
    async def create(cls, **kwargs):
        cls.created = kwargs
        return {"asset_id": "asset_new", **kwargs}

    @classmethod
    async def update(cls, asset_id, **kwargs):
        cls.updated = {"asset_id": asset_id, **kwargs}
        cls.updates.append(cls.updated)
        if asset_id == "missing":
            return None
        return cls.updated

    @classmethod
    async def get_by_id(cls, asset_id):
        return next((row for row in cls.rows if row["asset_id"] == asset_id), None)

    @classmethod
    async def rename_bound_references(cls, asset, new_name):
        cls.renamed = {"asset": dict(asset), "new_name": new_name}
        return 1

    @classmethod
    async def update_with_binding_rename(cls, asset_id, **kwargs):
        previous = await cls.get_by_id(asset_id)
        updated = await cls.update(asset_id, **kwargs)
        if previous and updated and kwargs.get("name"):
            await cls.rename_bound_references(previous, kwargs["name"])
        return updated

    @classmethod
    async def delete(cls, asset_id):
        cls.deleted.append(asset_id)
        return asset_id != "missing"

    @classmethod
    async def copy_to(cls, **kwargs):
        cls.copied = kwargs
        if kwargs["asset_id"] == "missing":
            return None
        return {
            "asset_id": "asset_copy",
            "project_id": "proj_1",
            "asset_type": "character",
            "name": "主角",
        }


class FakeEntityFileDAO:
    copied = []
    raise_on_get = False
    files_map = {
        "asset_1": [{"file_id": "file_1", "entity_type": "asset"}],
    }

    @classmethod
    async def get_files_for_entities(cls, entity_type, entity_ids):
        return {
            entity_id: [dict(file, entity_type=file.get("entity_type", entity_type)) for file in cls.files_map.get(entity_id, [])]
            for entity_id in entity_ids
            if entity_id in cls.files_map
        }

    @classmethod
    async def get_entity_files(cls, entity_type, entity_id):
        if cls.raise_on_get:
            raise RuntimeError("copy source unavailable")
        return {
            "items": [
                {"file_id": "file_1", "file_role": "reference_image"},
                {"file_id": "file_2"},
            ],
        }

    @classmethod
    async def copy_file(cls, source_file_id, target_entity_type, target_entity_id, file_role):
        cls.copied.append(
            {
                "source_file_id": source_file_id,
                "target_entity_type": target_entity_type,
                "target_entity_id": target_entity_id,
                "file_role": file_role,
            }
        )
        return {"file_id": f"{source_file_id}_copy"}


def setup_function():
    FakeAssetDAO.rows = list(FakeAssetDAO.default_rows)
    FakeAssetDAO.created = None
    FakeAssetDAO.updated = None
    FakeAssetDAO.updates = []
    FakeAssetDAO.deleted = []
    FakeAssetDAO.copied = None
    FakeAssetDAO.renamed = None
    FakeEntityFileDAO.copied = []
    FakeEntityFileDAO.raise_on_get = False
    FakeEntityFileDAO.files_map = {
        "asset_1": [{"file_id": "file_1", "entity_type": "asset"}],
    }


async def test_list_assets_attaches_entity_files():
    result = await asset_service.list_assets(
        "proj_1",
        episode_id="ep_1",
        asset_type=None,
        script_id="script_1",
        asset_dao=FakeAssetDAO,
        entity_file_dao=FakeEntityFileDAO,
    )

    assert result["success"] is True
    assert result["assets"][0]["entity_files"] == [{"file_id": "file_1", "entity_type": "asset"}]
    assert result["assets"][1]["entity_files"] == []


async def test_create_asset_passes_expected_fields():
    result = await asset_service.create_asset(
        project_id="proj_1",
        asset_type="character",
        name="主角",
        user_id="user_1",
        episode_id="ep_1",
        script_id="script_1",
        description=None,
        reference_images=["/ref.png"],
        asset_dao=FakeAssetDAO,
    )

    assert result["asset"]["asset_id"] == "asset_new"
    assert FakeAssetDAO.created == {
        "project_id": "proj_1",
        "asset_type": "character",
        "name": "主角",
        "created_by": "user_1",
        "episode_id": "ep_1",
        "description": "",
        "reference_images": ["/ref.png"],
        "script_id": "script_1",
    }


async def test_update_asset_raises_when_missing():
    with pytest.raises(asset_service.AssetNotFound):
        await asset_service.update_asset("missing", {"name": "新名"}, asset_dao=FakeAssetDAO)


async def test_update_asset_renames_existing_storyboard_bindings():
    result = await asset_service.update_asset("asset_1", {"name": "新主角"}, asset_dao=FakeAssetDAO)

    assert result["success"] is True
    assert FakeAssetDAO.renamed == {
        "asset": FakeAssetDAO.default_rows[0],
        "new_name": "新主角",
    }


async def test_delete_asset_returns_success():
    result = await asset_service.delete_asset("asset_1", asset_dao=FakeAssetDAO)

    assert result == {"success": True}
    assert FakeAssetDAO.deleted == ["asset_1"]


async def test_share_asset_copies_linked_files():
    result = await asset_service.share_asset(
        "asset_1",
        target_episode_id="ep_2",
        target_script_id="script_2",
        user_id="user_1",
        asset_dao=FakeAssetDAO,
        entity_file_dao=FakeEntityFileDAO,
    )

    assert result["success"] is True
    assert result["asset"]["asset_id"] == "asset_copy"
    assert result["copied_files"] == 2
    assert FakeAssetDAO.copied == {
        "asset_id": "asset_1",
        "target_episode_id": "ep_2",
        "target_script_id": "script_2",
        "created_by": "user_1",
    }
    assert FakeEntityFileDAO.copied[1]["file_role"] == "reference_image"


async def test_share_asset_keeps_asset_when_file_copy_fails():
    FakeEntityFileDAO.raise_on_get = True
    logger = Mock()

    result = await asset_service.share_asset(
        "asset_1",
        target_episode_id="ep_2",
        target_script_id="script_2",
        user_id="user_1",
        asset_dao=FakeAssetDAO,
        entity_file_dao=FakeEntityFileDAO,
        logger=logger,
    )

    assert result["success"] is True
    assert result["copied_files"] == 0
    logger.warning.assert_called_once()


async def test_share_asset_raises_when_source_missing():
    with pytest.raises(asset_service.AssetNotFound):
        await asset_service.share_asset(
            "missing",
            target_episode_id="ep_2",
            target_script_id="script_2",
            user_id="user_1",
            asset_dao=FakeAssetDAO,
            entity_file_dao=FakeEntityFileDAO,
        )


async def test_list_sync_existing_design_candidates_uses_other_episode_assets_when_current_empty():
    class FakeEpisodeDAO:
        @classmethod
        async def get_episodes(cls, project_id):
            return [
                {"episode_id": "ep_1", "episode_number": 1, "episode_name": "第一集"},
                {"episode_id": "ep_2", "episode_number": 2, "episode_name": "第二集"},
            ]

    FakeAssetDAO.rows = [
        {
            "asset_id": "source_char",
            "project_id": "proj_1",
            "episode_id": "ep_1",
            "script_id": "script_1",
            "asset_type": "character",
            "name": "小悟",
            "description": "第一集角色设计",
            "thumbnail_url": "/thumb.png",
            "reference_images": ["/ref.png"],
        },
        {
            "asset_id": "shared_char",
            "project_id": "proj_1",
            "episode_id": None,
            "asset_type": "character",
            "name": "共享角色",
            "thumbnail_url": "/shared.png",
        },
    ]
    FakeEntityFileDAO.files_map = {
        "source_char": [{"file_id": "file_src", "file_role": "reference_image", "file_url": "/entity-ref.png"}],
    }

    result = await asset_service.list_sync_existing_design_candidates(
        project_id="proj_1",
        episode_id="ep_2",
        script_id="script_2",
        asset_types=["character", "scene", "prop"],
        asset_dao=FakeAssetDAO,
        entity_file_dao=FakeEntityFileDAO,
        episode_dao=FakeEpisodeDAO,
    )

    assert result["success"] is True
    assert result["candidate_count"] == 1
    candidate = result["candidates"][0]
    assert candidate["asset_id"] == "source_char"
    assert candidate["source_episode_label"] == "第一集"
    assert candidate["exists_in_target"] is False
    assert candidate["has_design"] is True
    assert candidate["image_count"] == 3


async def test_sync_existing_designs_copies_selected_asset_into_current_episode():
    FakeAssetDAO.rows = [
        {
            "asset_id": "source_char",
            "project_id": "proj_1",
            "episode_id": "ep_1",
            "script_id": "script_1",
            "asset_type": "character",
            "name": "小悟",
            "description": "第一集角色设计",
            "thumbnail_url": "/thumb.png",
            "reference_images": ["/ref.png"],
            "style_params": {"ai_prompt": "hero prompt"},
            "tags": ["hero"],
        },
    ]
    FakeEntityFileDAO.files_map = {
        "source_char": [{"file_id": "file_src", "file_role": "reference_image", "file_url": "/entity-ref.png"}],
    }

    result = await asset_service.sync_existing_designs(
        project_id="proj_1",
        episode_id="ep_2",
        script_id="script_2",
        asset_types=["character", "scene", "prop"],
        overwrite=False,
        source_asset_ids=["source_char"],
        user_id="user_2",
        asset_dao=FakeAssetDAO,
        entity_file_dao=FakeEntityFileDAO,
    )

    assert result["success"] is True
    assert result["created"] == 1
    assert result["updated"] == 0
    assert result["synced"] == 1
    assert FakeAssetDAO.copied == {
        "asset_id": "source_char",
        "target_episode_id": "ep_2",
        "target_script_id": "script_2",
        "created_by": "user_2",
    }
    assert FakeEntityFileDAO.copied == [
        {
            "source_file_id": "file_src",
            "target_entity_type": "asset",
            "target_entity_id": "asset_copy",
            "file_role": "reference_image",
        }
    ]


async def test_sync_existing_designs_fills_selected_same_name_empty_asset():
    FakeAssetDAO.rows = [
        {
            "asset_id": "target_char",
            "project_id": "proj_1",
            "episode_id": "ep_2",
            "script_id": "script_2",
            "asset_type": "character",
            "name": "小悟",
            "description": "",
            "reference_images": [],
            "style_params": {},
            "tags": [],
        },
        {
            "asset_id": "source_char",
            "project_id": "proj_1",
            "episode_id": "ep_1",
            "script_id": "script_1",
            "asset_type": "character",
            "name": "小悟",
            "description": "第一集角色设计",
            "thumbnail_url": "/thumb.png",
            "reference_images": ["/ref.png"],
        },
    ]
    FakeEntityFileDAO.files_map = {
        "source_char": [{"file_id": "file_src", "file_role": "reference_image", "file_url": "/entity-ref.png"}],
        "target_char": [],
    }

    result = await asset_service.sync_existing_designs(
        project_id="proj_1",
        episode_id="ep_2",
        script_id="script_2",
        asset_types=["character"],
        overwrite=False,
        source_asset_ids=["source_char"],
        user_id="user_2",
        asset_dao=FakeAssetDAO,
        entity_file_dao=FakeEntityFileDAO,
    )

    assert result["created"] == 0
    assert result["updated"] == 1
    assert FakeAssetDAO.updated["asset_id"] == "target_char"
    assert FakeAssetDAO.updated["thumbnail_url"] == "/thumb.png"
    assert FakeEntityFileDAO.copied[0]["target_entity_id"] == "target_char"


async def test_sync_existing_designs_copies_same_name_design_to_current_episode():
    FakeAssetDAO.rows = [
        {
            "asset_id": "target_char",
            "project_id": "proj_1",
            "episode_id": "ep_2",
            "script_id": "script_2",
            "asset_type": "character",
            "name": "主角",
            "description": "",
            "reference_images": [],
            "style_params": {},
            "tags": [],
        },
        {
            "asset_id": "source_char",
            "project_id": "proj_1",
            "episode_id": "ep_1",
            "script_id": "script_1",
            "asset_type": "character",
            "name": "主角",
            "description": "第一集角色设定",
            "thumbnail_url": "/thumb.png",
            "reference_images": ["/ref.png"],
            "style_params": {"ai_prompt": "hero prompt"},
            "tags": ["hero"],
        },
    ]
    FakeEntityFileDAO.files_map = {
        "source_char": [{"file_id": "file_src", "file_role": "reference_image", "file_url": "/entity-ref.png"}],
        "target_char": [],
    }

    result = await asset_service.sync_existing_designs(
        project_id="proj_1",
        episode_id="ep_2",
        script_id="script_2",
        asset_types=["character", "scene", "prop"],
        overwrite=False,
        asset_dao=FakeAssetDAO,
        entity_file_dao=FakeEntityFileDAO,
    )

    assert result["success"] is True
    assert result["matched"] == 1
    assert result["synced"] == 1
    assert result["copied_files"] == 1
    assert FakeAssetDAO.updated == {
        "asset_id": "target_char",
        "thumbnail_url": "/thumb.png",
        "reference_images": ["/ref.png"],
        "style_params": {"ai_prompt": "hero prompt"},
        "tags": ["hero"],
        "description": "第一集角色设定",
    }
    assert FakeEntityFileDAO.copied == [
        {
            "source_file_id": "file_src",
            "target_entity_type": "asset",
            "target_entity_id": "target_char",
            "file_role": "reference_image",
        }
    ]


async def test_sync_existing_designs_keeps_current_design_without_overwrite():
    FakeAssetDAO.rows = [
        {
            "asset_id": "target_scene",
            "project_id": "proj_1",
            "episode_id": "ep_2",
            "script_id": "script_2",
            "asset_type": "scene",
            "name": "教室",
            "reference_images": ["/current.png"],
        },
        {
            "asset_id": "source_scene",
            "project_id": "proj_1",
            "episode_id": "ep_1",
            "script_id": "script_1",
            "asset_type": "scene",
            "name": "教室",
            "reference_images": ["/old.png"],
        },
    ]
    FakeEntityFileDAO.files_map = {}

    result = await asset_service.sync_existing_designs(
        project_id="proj_1",
        episode_id="ep_2",
        script_id="script_2",
        asset_types=["scene"],
        overwrite=False,
        asset_dao=FakeAssetDAO,
        entity_file_dao=FakeEntityFileDAO,
    )

    assert result["synced"] == 0
    assert result["skipped_existing"] == 1
    assert FakeAssetDAO.updates == []
    assert FakeEntityFileDAO.copied == []
