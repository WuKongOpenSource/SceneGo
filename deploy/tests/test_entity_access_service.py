import pytest

from services import entity_access_service as service


class EpisodeDAO:
    rows = {"ep_1": {"episode_id": "ep_1", "project_id": "proj_1"}}

    @classmethod
    async def get_episode(cls, episode_id):
        return cls.rows.get(episode_id)

    @classmethod
    async def get_project_id(cls, episode_id):
        row = cls.rows.get(episode_id)
        return row and row["project_id"]


class StoryboardDAO:
    @staticmethod
    async def get_by_id(item_id):
        return {"item_id": item_id, "episode_id": "ep_1"} if item_id == "shot_1" else None


class EmptyDAO:
    @staticmethod
    async def get_by_id(_entity_id):
        return None


@pytest.mark.asyncio
async def test_storyboard_and_legacy_material_resolve_to_episode_project():
    deps = {
        "episode_dao": EpisodeDAO,
        "storyboard_dao": StoryboardDAO,
        "asset_dao": EmptyDAO,
        "video_segment_dao": EmptyDAO,
    }
    storyboard = await service.resolve_entity_scope("storyboard_item", "shot_1", **deps)
    material = await service.resolve_entity_scope("material", "shot_1", **deps)
    assert storyboard == {"project_id": "proj_1", "episode_id": "ep_1"}
    assert material == storyboard


@pytest.mark.asyncio
async def test_unsupported_entity_type_is_denied():
    with pytest.raises(service.EntityAccessDenied):
        await service.resolve_entity_scope("made_up", "anything")


@pytest.mark.asyncio
async def test_project_file_requires_project_access(monkeypatch):
    class FileDAO:
        @staticmethod
        async def get_by_id(_file_id):
            return {"file_id": "file_1", "user_id": "user_1", "project_id": "proj_1"}

    async def deny(*_args, **_kwargs):
        raise service.ProjectAccessDenied("denied")

    monkeypatch.setattr(service, "require_project_access", deny)
    with pytest.raises(service.EntityAccessDenied):
        await service.require_file_access("file_1", "user_1", file_dao=FileDAO)


@pytest.mark.asyncio
async def test_unscoped_file_is_available_only_to_owner(monkeypatch):
    class FileDAO:
        @staticmethod
        async def get_by_id(_file_id):
            return {"file_id": "file_1", "user_id": "user_1"}

    async def canonical(identity, **_kwargs):
        return {"alice": "user_1", "bob": "user_2"}.get(identity)

    monkeypatch.setattr(service, "resolve_user_id", canonical)
    row = await service.require_file_access("file_1", "alice", file_dao=FileDAO)
    assert row["_access_project_id"] == ""
    with pytest.raises(service.EntityAccessDenied):
        await service.require_file_access("file_1", "bob", file_dao=FileDAO)


@pytest.mark.asyncio
async def test_file_access_supports_legacy_get_file_contract(monkeypatch):
    class LegacyFileDAO:
        @staticmethod
        async def get_file(file_id):
            return {"file_id": file_id, "user_id": "user_1"}

    async def canonical(identity, **_kwargs):
        return {"alice": "user_1"}.get(identity)

    monkeypatch.setattr(service, "resolve_user_id", canonical)
    row = await service.require_file_access("file_1", "alice", file_dao=LegacyFileDAO)

    assert row["file_id"] == "file_1"
    assert row["_access_project_id"] == ""


@pytest.mark.asyncio
async def test_file_access_denies_dao_without_supported_lookup():
    class InvalidFileDAO:
        pass

    with pytest.raises(service.EntityAccessDenied):
        await service.require_file_access("file_1", "alice", file_dao=InvalidFileDAO)
