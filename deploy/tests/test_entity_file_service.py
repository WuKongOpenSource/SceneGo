from __future__ import annotations

from unittest.mock import Mock

import pytest

from services import entity_file_service


class FakeFileDAO:
    rows = [
        {"file_id": "file_1", "metadata": '{"a": 1}'},
        {"file_id": "file_2", "metadata": "bad-json"},
    ]
    calls = []

    @classmethod
    async def get_user_files(cls, user_id, file_type, limit, offset):
        cls.calls.append((user_id, file_type, limit, offset))
        return cls.rows


class FakeEntityFileDAO:
    linked = None
    selected = None
    synced = []
    soft_deleted = []
    hard_deleted = []
    batch_deleted = None
    raise_sync = False

    @staticmethod
    async def get_deleted_user_files(user_id, file_type, limit, offset):
        return [{"file_id": "file_deleted", "metadata": '{"model":"Wan"}'}]

    @staticmethod
    async def get_deleted_user_file(file_id, user_id):
        if file_id == "missing":
            return None
        return {
            "file_id": file_id,
            "user_id": user_id,
            "file_path": "persistent_storage/images/deleted.png",
            "metadata": {},
            "is_deleted": True,
        }

    @staticmethod
    async def count_deleted_user_files(user_id, file_type):
        return 1

    @staticmethod
    async def restore(file_id, user_id):
        if file_id == "missing":
            return None
        return {"file_id": file_id, "user_id": user_id, "is_deleted": False}

    @staticmethod
    async def count_user_files(user_id, file_type):
        return 7

    @staticmethod
    async def get_entity_files(entity_type, entity_id, file_role, limit, offset):
        return {"items": [{"file_id": "file_1"}], "total": 1, "limit": limit}

    @classmethod
    async def link_file(cls, file_id, entity_type, entity_id, file_role, is_selected):
        if file_id == "missing":
            return None
        cls.linked = (file_id, entity_type, entity_id, file_role, is_selected)
        return {"file_id": file_id, "entity_id": entity_id}

    @classmethod
    async def select_file(cls, file_id, entity_type, entity_id, file_role):
        if file_id == "missing":
            return None
        cls.selected = (file_id, entity_type, entity_id, file_role)
        return {"file_id": file_id, "file_url": "/storage/a.webp"}

    @classmethod
    async def sync_legacy_url(cls, entity_type, entity_id, file_role, file_url):
        if cls.raise_sync:
            raise RuntimeError("sync failed")
        cls.synced.append((entity_type, entity_id, file_role, file_url))
        return True

    @classmethod
    async def soft_delete(cls, file_id):
        cls.soft_deleted.append(file_id)
        return file_id != "missing"

    @classmethod
    async def hard_delete(cls, file_id, user_id):
        cls.hard_deleted.append((file_id, user_id))
        if file_id == "missing":
            return None
        return {"file_id": file_id, "freed_bytes": 123}

    @classmethod
    async def delete_deleted_user_file_record(cls, file_id, user_id):
        cls.hard_deleted.append((file_id, user_id, "record"))
        return file_id != "missing"


def setup_function():
    FakeFileDAO.calls = []
    FakeEntityFileDAO.linked = None
    FakeEntityFileDAO.selected = None
    FakeEntityFileDAO.synced = []
    FakeEntityFileDAO.soft_deleted = []
    FakeEntityFileDAO.hard_deleted = []
    FakeEntityFileDAO.batch_deleted = None
    FakeEntityFileDAO.raise_sync = False


async def test_list_user_files_caps_limit_and_normalizes_metadata():
    result = await entity_file_service.list_user_files(
        user_id="user_1",
        file_type="image",
        limit=999,
        offset=3,
        file_dao=FakeFileDAO,
        entity_file_dao=FakeEntityFileDAO,
    )

    assert FakeFileDAO.calls == [("user_1", "image", 500, 3)]
    assert result["items"][0]["metadata"] == {"a": 1}
    assert result["items"][1]["metadata"] == {}
    assert result["total"] == 7


async def test_list_entity_files_caps_limit():
    result = await entity_file_service.list_entity_files(
        entity_type="asset",
        entity_id="asset_1",
        file_role=None,
        limit=999,
        offset=0,
        entity_file_dao=FakeEntityFileDAO,
    )

    assert result["success"] is True
    assert result["limit"] == 200


async def test_list_deleted_user_files_and_restore():
    result = await entity_file_service.list_deleted_user_files(
        user_id="user_1",
        file_type=None,
        limit=999,
        offset=0,
        entity_file_dao=FakeEntityFileDAO,
    )
    assert result["total"] == 1
    assert result["items"][0]["metadata"] == {"model": "Wan"}

    restored = await entity_file_service.restore_entity_file(
        file_id="file_deleted",
        user_id="user_1",
        entity_file_dao=FakeEntityFileDAO,
    )
    assert restored["file"]["is_deleted"] is False


async def test_link_entity_file_raises_when_missing():
    with pytest.raises(entity_file_service.EntityFileNotFound):
        await entity_file_service.link_entity_file(
            file_id="missing",
            entity_type="asset",
            entity_id="asset_1",
            file_role="reference_image",
            is_selected=False,
            entity_file_dao=FakeEntityFileDAO,
        )


async def test_select_entity_file_syncs_legacy_url():
    result = await entity_file_service.select_entity_file(
        file_id="file_1",
        entity_type="asset",
        entity_id="asset_1",
        file_role="reference_image",
        entity_file_dao=FakeEntityFileDAO,
    )

    assert result["file"]["file_id"] == "file_1"
    assert FakeEntityFileDAO.synced == [("asset", "asset_1", "reference_image", "/storage/a.webp")]


async def test_select_entity_file_keeps_success_when_legacy_sync_fails():
    FakeEntityFileDAO.raise_sync = True
    logger = Mock()

    result = await entity_file_service.select_entity_file(
        file_id="file_1",
        entity_type="asset",
        entity_id="asset_1",
        file_role="reference_image",
        entity_file_dao=FakeEntityFileDAO,
        logger=logger,
    )

    assert result["success"] is True
    logger.warning.assert_called_once()


async def test_upload_entity_file_saves_and_syncs_media_library():
    saved_calls = []
    media_calls = []

    async def fake_save_generated_file_to_db(**kwargs):
        saved_calls.append(kwargs)
        return {"file_id": "file_new", "file_url": "/storage/new.webp"}

    async def fake_create_from_file(**kwargs):
        media_calls.append(kwargs)
        return {"library_item_id": "lib_1"}

    result = await entity_file_service.upload_entity_file(
        content=b"abc",
        filename="cover.png",
        content_type="image/png",
        entity_type="asset",
        entity_id="asset_1",
        file_role="reference_image",
        episode_id="ep_1",
        user_id="user_1",
        save_generated_file_to_db=fake_save_generated_file_to_db,
        media_library_create_from_file=fake_create_from_file,
    )

    assert result == {"success": True, "file_id": "file_new", "file_url": "/storage/new.webp"}
    assert saved_calls[0]["file_type"] == "image"
    assert saved_calls[0]["original_ext"] == ".png"
    assert media_calls[0]["title"] == "cover.png"


async def test_horizontal_mirror_upload_is_saved_as_a_generated_local_transform():
    saved_calls = []
    media_calls = []

    async def fake_save_generated_file_to_db(**kwargs):
        saved_calls.append(kwargs)
        return {"file_id": "file_mirror", "file_url": "/storage/mirror.png"}

    async def fake_create_from_file(**kwargs):
        media_calls.append(kwargs)

    result = await entity_file_service.upload_entity_file(
        content=b"png",
        filename="mirror.png",
        content_type="image/png",
        entity_type="storyboard_item",
        entity_id="sb_1",
        file_role="generated_image",
        episode_id="ep_1",
        user_id="user_1",
        save_generated_file_to_db=fake_save_generated_file_to_db,
        media_library_create_from_file=fake_create_from_file,
        source="local_transform",
        transform="horizontal_mirror",
    )

    assert result["file_id"] == "file_mirror"
    assert saved_calls[0]["source"] == "local_transform"
    assert saved_calls[0]["extra_metadata"] == {
        "model": "horizontal_mirror",
        "transform": "horizontal_mirror",
    }
    assert media_calls[0]["source"] == "local_transform"


async def test_unknown_local_transform_is_rejected():
    with pytest.raises(entity_file_service.EntityFileTransformInvalid):
        await entity_file_service.upload_entity_file(
            content=b"png",
            filename="bad.png",
            content_type="image/png",
            entity_type="storyboard_item",
            entity_id="sb_1",
            file_role="generated_image",
            episode_id="ep_1",
            user_id="user_1",
            save_generated_file_to_db=lambda **_kwargs: None,
            source="local_transform",
            transform="rotate",
        )


async def test_hard_delete_batch_rejects_more_than_200_files():
    with pytest.raises(entity_file_service.EntityFileBatchTooLarge):
        await entity_file_service.hard_delete_entity_files_batch(
            file_ids=[f"file_{i}" for i in range(201)],
            user_id="user_1",
            risk_ack=True,
            entity_file_dao=FakeEntityFileDAO,
        )


async def test_soft_and_hard_delete_raise_when_missing():
    with pytest.raises(entity_file_service.EntityFileNotFound):
        await entity_file_service.soft_delete_entity_file(
            file_id="missing",
            entity_file_dao=FakeEntityFileDAO,
        )

    with pytest.raises(entity_file_service.EntityFileNotFound):
        await entity_file_service.hard_delete_entity_file(
            file_id="missing",
            user_id="user_1",
            risk_ack=True,
            entity_file_dao=FakeEntityFileDAO,
        )


async def test_hard_delete_requires_explicit_ack_and_scopes_to_current_user():
    with pytest.raises(entity_file_service.EntityFileDeleteRiskNotAcknowledged):
        await entity_file_service.hard_delete_entity_file(
            file_id="file_deleted",
            user_id="user_1",
            risk_ack=False,
            entity_file_dao=FakeEntityFileDAO,
        )

    result = await entity_file_service.hard_delete_entity_file(
        file_id="file_deleted",
        user_id="user_1",
        risk_ack=True,
        entity_file_dao=FakeEntityFileDAO,
    )

    assert result["freed_bytes"] == 123
    assert FakeEntityFileDAO.hard_deleted == [("file_deleted", "user_1")]


async def test_node_local_hard_delete_waits_for_agent_before_removing_record():
    class NodeLocalDAO(FakeEntityFileDAO):
        @staticmethod
        async def get_deleted_user_file(file_id, user_id):
            return {
                "file_id": file_id,
                "user_id": user_id,
                "file_path": "agent://gpu-2/output-1",
                "metadata": {
                    "source": "node_local_output",
                    "node_agent_id": "gpu-2",
                    "node_output_id": "output-1",
                },
                "is_deleted": True,
            }

    calls = []

    async def delete_node_output(**kwargs):
        calls.append(kwargs)
        return {"freed_bytes": 987}

    result = await entity_file_service.hard_delete_entity_file(
        file_id="file_remote",
        user_id="user_1",
        risk_ack=True,
        entity_file_dao=NodeLocalDAO,
        node_output_deleter=delete_node_output,
    )

    assert calls == [{"agent_id": "gpu-2", "output_id": "output-1"}]
    assert result["freed_bytes"] == 987
    assert FakeEntityFileDAO.hard_deleted[-1] == ("file_remote", "user_1", "record")


async def test_run_entity_file_migration_uses_runner():
    async def fake_runner():
        return 3

    result = await entity_file_service.run_entity_file_migration(migration_runner=fake_runner)

    assert result == {"success": True, "recovered": 3}
