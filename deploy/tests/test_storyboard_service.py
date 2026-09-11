from __future__ import annotations

from dataclasses import dataclass

import pytest

from services import storyboard_service


class FakeStoryboardDAO:
    calls = []
    episode_rows = None
    created = None
    created_rows = []
    updated = None
    updates = []
    deleted = []
    delete_scope = None
    export_kwargs = None
    reordered = None
    batch_kwargs = None
    update_returns_none = False
    delete_returns_false = False
    reorder_returns_false = False

    @classmethod
    async def get_by_episode(cls, episode_id, script_id=None, limit=None, offset=0, fields=None):
        cls.calls.append((episode_id, script_id, limit, offset, fields))
        if cls.episode_rows is not None:
            return cls.episode_rows
        if script_id:
            return [{"item_id": "sb_stale", "bound_assets": "[bad-json"}]
        return [{
            "item_id": "sb_current",
            "bound_assets": '[{"asset_id":"a1"}]',
            "configured_references": '[{"referenceId":"ref-1"}]',
        }]

    @classmethod
    async def get_by_id(cls, item_id):
        if item_id == "missing":
            return None
        return {"item_id": item_id, "episode_id": "ep_1"}

    @classmethod
    async def count_by_episode(cls, episode_id, script_id=None):
        return 1 if script_id else 9

    @classmethod
    async def create(cls, **kwargs):
        cls.created = kwargs
        item_id = "sb_new" if not cls.created_rows else f"sb_new_{len(cls.created_rows) + 1}"
        row = {"item_id": item_id, **kwargs}
        cls.created_rows.append(row)
        return row

    @classmethod
    async def update(cls, item_id, **kwargs):
        cls.updated = {"item_id": item_id, **kwargs}
        cls.updates.append(cls.updated)
        if cls.update_returns_none:
            return None
        return cls.updated

    @classmethod
    async def delete(cls, item_id):
        cls.deleted.append(item_id)
        return not cls.delete_returns_false

    @classmethod
    async def delete_by_episode(cls, episode_id, script_id=None):
        cls.delete_scope = {"episode_id": episode_id, "script_id": script_id}
        return 4

    @classmethod
    async def export_script_transaction(cls, **kwargs):
        cls.export_kwargs = kwargs
        return len(kwargs["storyboard_items"])

    @classmethod
    async def reorder(cls, episode_id, item_ids):
        cls.reordered = {"episode_id": episode_id, "item_ids": item_ids}
        return not cls.reorder_returns_false

    @classmethod
    async def batch_create(cls, episode_id, items, script_id=None):
        cls.batch_kwargs = {"episode_id": episode_id, "items": items, "script_id": script_id}
        return [{"item_id": "sb_batch", **item} for item in items]

    @classmethod
    async def replace_batch(cls, episode_id, items, script_id=None):
        cls.batch_kwargs = {"episode_id": episode_id, "items": items, "script_id": script_id}
        return [{"item_id": "sb_batch", **item} for item in items]


class FakeEpisodeScriptDAO:
    list_raises = False
    row = None

    @classmethod
    async def get_by_id(cls, script_id):
        return cls.row

    @classmethod
    async def list_by_episode(cls, episode_id):
        if cls.list_raises:
            raise RuntimeError("script lookup failed")
        return [{"script_id": "script_a"}, {"script_id": "script_latest"}]


class FakeAssetDAO:
    created = []

    @classmethod
    async def get_by_project(cls, project_id, episode_id, script_id=None):
        return [{"asset_type": "character", "name": "Alice"}]

    @classmethod
    async def create(cls, **kwargs):
        cls.created.append(kwargs)
        return {"asset_id": f"asset_{len(cls.created)}", **kwargs}


class FakeEpisodeDAO:
    missing = False

    @classmethod
    async def get_project_id(cls, episode_id):
        return None if cls.missing else "proj_1"

    @classmethod
    async def get_episode(cls, episode_id):
        if cls.missing:
            return None
        return {"episode_id": episode_id, "project_id": "proj_1"}


async def test_storyboard_access_helpers_delegate_project_scope():
    calls = []

    async def check(project_id, identity, role):
        calls.append((project_id, identity, role))

    item = await storyboard_service.require_storyboard_item_access(
        "sb_1",
        "user_1",
        "member",
        storyboard_dao=FakeStoryboardDAO,
        episode_dao=FakeEpisodeDAO,
        project_access_checker=check,
    )

    assert item["item_id"] == "sb_1"
    assert calls == [("proj_1", "user_1", "member")]


async def test_storyboard_script_must_belong_to_episode():
    FakeEpisodeScriptDAO.row = {"script_id": "script_1", "episode_id": "ep_other"}

    with pytest.raises(storyboard_service.StoryboardScriptNotFound):
        await storyboard_service.require_storyboard_script(
            "ep_1",
            "script_1",
            episode_script_dao=FakeEpisodeScriptDAO,
        )


@dataclass
class FakeMixResult:
    success: bool = True
    mixed_audio_url: str = "/mixed.wav"
    cached: bool = False
    duration_ms: int = 1234


@dataclass
class FakeMixInput:
    dialogue_url: str | None = None
    narration_url: str | None = None
    sfx_url: str | None = None
    dialogue_gain_db: float = 0
    narration_gain_db: float = 0
    sfx_gain_db: float = 0


def setup_function():
    FakeStoryboardDAO.calls = []
    FakeStoryboardDAO.episode_rows = None
    FakeStoryboardDAO.created = None
    FakeStoryboardDAO.created_rows = []
    FakeStoryboardDAO.updated = None
    FakeStoryboardDAO.updates = []
    FakeStoryboardDAO.deleted = []
    FakeStoryboardDAO.delete_scope = None
    FakeStoryboardDAO.export_kwargs = None
    FakeStoryboardDAO.reordered = None
    FakeStoryboardDAO.batch_kwargs = None
    FakeStoryboardDAO.update_returns_none = False
    FakeStoryboardDAO.delete_returns_false = False
    FakeStoryboardDAO.reorder_returns_false = False
    FakeEpisodeScriptDAO.list_raises = False
    FakeEpisodeScriptDAO.row = None
    FakeAssetDAO.created = []
    FakeEpisodeDAO.missing = False


async def test_get_storyboard_items_falls_back_for_stale_script_and_normalizes_assets():
    result = await storyboard_service.get_storyboard_items(
        "ep_1",
        script_id="script_deleted",
        limit=10,
        offset=0,
        include_total=True,
        fields="video",
        storyboard_dao=FakeStoryboardDAO,
        episode_script_dao=FakeEpisodeScriptDAO,
    )

    assert result["fallback_script_id"] == "script_deleted"
    assert result["fallback_reason"] == "stale_script_storyboard"
    assert result["fallback_scope"] == "episode"
    assert result["total"] == 9
    assert result["items"][0]["bound_assets"] == [{"asset_id": "a1"}]
    assert result["items"][0]["configured_references"] == [{"referenceId": "ref-1"}]
    assert FakeStoryboardDAO.calls == [
        ("ep_1", "script_deleted", 10, 0, "video"),
        ("ep_1", None, 10, 0, "video"),
    ]


async def test_get_storyboard_items_rejects_unknown_field_set():
    with pytest.raises(storyboard_service.UnsupportedStoryboardFields):
        await storyboard_service.get_storyboard_items(
            "ep_1",
            script_id=None,
            limit=None,
            offset=0,
            include_total=False,
            fields="full-fat",
            storyboard_dao=FakeStoryboardDAO,
            episode_script_dao=FakeEpisodeScriptDAO,
        )


async def test_create_storyboard_item_uses_latest_script_when_missing():
    result = await storyboard_service.create_storyboard_item(
        "ep_1",
        sort_order=7,
        scene_heading="scene",
        dialogue="dialogue",
        action_text="action",
        camera_movement="pan",
        image_prompt="image",
        video_prompt="video",
        script_id=None,
        storyboard_dao=FakeStoryboardDAO,
        episode_script_dao=FakeEpisodeScriptDAO,
    )

    assert result["item"]["item_id"] == "sb_new"
    assert FakeStoryboardDAO.created["script_id"] == "script_latest"
    assert FakeStoryboardDAO.created["sort_order"] == 7


async def test_update_storyboard_item_preserves_zero_values():
    result = await storyboard_service.update_storyboard_item(
        "sb_1",
        {"sort_order": 0, "audio_duration_ms": 0, "status": "ready"},
        storyboard_dao=FakeStoryboardDAO,
    )

    assert result["success"] is True
    assert FakeStoryboardDAO.updated == {
        "item_id": "sb_1",
        "sort_order": 0,
        "audio_duration_ms": 0,
        "status": "ready",
    }


async def test_update_storyboard_item_only_stales_content_for_real_changes():
    class ExistingStoryboardDAO:
        @staticmethod
        async def get_by_id(_item_id):
            return {"item_id": "sb_1", "episode_id": "ep_1", "image_prompt": "same"}

        @staticmethod
        async def update(item_id, **fields):
            return {
                "item_id": item_id,
                "episode_id": "ep_1",
                "updated_at": "2026-08-20T10:00:00",
                **fields,
            }

    class WorkflowDAO:
        calls = []

        @classmethod
        async def list_storyboard_targets(cls, **_kwargs):
            cls.calls.append("targets")
            return [{"item_id": "sb_1", "lineage_id": "line_1", "episode_id": "ep_1"}]

        @classmethod
        async def create_stale_event(cls, **kwargs):
            cls.calls.append(kwargs)
            return kwargs

    unchanged = await storyboard_service.update_storyboard_item(
        "sb_1",
        {"image_prompt": "same"},
        storyboard_dao=ExistingStoryboardDAO,
        content_workflow_dao=WorkflowDAO,
        updated_by="user_1",
    )
    changed = await storyboard_service.update_storyboard_item(
        "sb_1",
        {"image_prompt": "new"},
        storyboard_dao=ExistingStoryboardDAO,
        content_workflow_dao=WorkflowDAO,
        updated_by="user_1",
    )

    assert unchanged["stale_events"] == []
    assert [event["target_slot"] for event in changed["stale_events"]] == ["keyframe", "video"]


async def test_update_storyboard_item_raises_when_missing():
    FakeStoryboardDAO.update_returns_none = True

    with pytest.raises(storyboard_service.StoryboardItemNotFound):
        await storyboard_service.update_storyboard_item(
            "missing",
            {"status": "missing"},
            storyboard_dao=FakeStoryboardDAO,
        )


async def test_export_script_delegates_transaction_and_counts_inputs():
    result = await storyboard_service.export_script(
        "ep_1",
        project_id="proj_1",
        original_content="original",
        script_content="script",
        storyboard_items=[{"sort_order": 0}, {"sort_order": 1}],
        characters=[{"name": "Alice"}],
        scenes=[{"name": "Room"}],
        props=[{"name": "Sword"}],
        script_id="script_1",
        user_id="user_1",
        storyboard_dao=FakeStoryboardDAO,
        episode_script_dao=FakeEpisodeScriptDAO,
        asset_dao=FakeAssetDAO,
    )

    assert result == {
        "success": True,
        "storyboard_items_created": 2,
        "characters_count": 1,
        "scenes_count": 1,
        "props_count": 1,
    }
    assert FakeStoryboardDAO.export_kwargs["created_by"] == "user_1"


async def test_export_script_can_preserve_existing_storyboards():
    await storyboard_service.export_script(
        "ep_1",
        project_id="proj_1",
        original_content="original",
        script_content="script",
        storyboard_items=[],
        characters=[],
        scenes=[],
        script_id="script_2",
        user_id="user_1",
        storyboard_dao=FakeStoryboardDAO,
        episode_script_dao=FakeEpisodeScriptDAO,
        asset_dao=FakeAssetDAO,
        preserve_existing_storyboards=True,
    )

    assert FakeStoryboardDAO.export_kwargs["script_id"] == "script_2"
    assert FakeStoryboardDAO.export_kwargs["preserve_existing_storyboards"] is True


async def test_reorder_storyboard_items_raises_when_dao_fails():
    FakeStoryboardDAO.reorder_returns_false = True

    with pytest.raises(storyboard_service.StoryboardReorderFailed):
        await storyboard_service.reorder_storyboard_items(
            "ep_1",
            ["sb_2", "sb_1"],
            storyboard_dao=FakeStoryboardDAO,
        )


async def test_mix_storyboard_audio_delegates_to_injected_mixer():
    captured = {}

    async def fake_mixer(item_id, mix_input, *, user_id):
        captured["item_id"] = item_id
        captured["mix_input"] = mix_input
        captured["user_id"] = user_id
        return FakeMixResult()

    result = await storyboard_service.mix_storyboard_audio(
        item_id="sb_1",
        dialogue_url="/d.wav",
        narration_url=None,
        sfx_url=None,
        dialogue_gain_db=1.5,
        narration_gain_db=-3,
        sfx_gain_db=-8,
        user_id="user_1",
        audio_mixer=fake_mixer,
        mix_input_cls=FakeMixInput,
    )

    assert result["mixed_audio_url"] == "/mixed.wav"
    assert captured["item_id"] == "sb_1"
    assert captured["mix_input"].dialogue_gain_db == 1.5


async def test_sync_storyboard_items_updates_existing_audio_without_creating():
    FakeStoryboardDAO.episode_rows = [
        {
            "item_id": "sb_1",
            "episode_id": "ep_1",
            "script_id": "script_1",
            "sort_order": 0,
            "dialogue": "Alice: hi",
            "dialogue_audio_url": "/old.wav",
            "narration_audio_url": None,
            "sfx_audio_url": None,
            "audio_duration_ms": 1000,
            "planned_duration_ms": 3000,
            "bound_assets": '["char:Alice"]',
            "mixed_audio_url": "/old-mix.wav",
            "mixed_audio_hash": "old-hash",
            "generated_image_url": "/keep-image.png",
        }
    ]

    result = await storyboard_service.sync_storyboard_items(
        "ep_1",
        items=[
            {
                "item_id": "sb_1",
                "sort_order": 0,
                "dialogue": "Alice: hi",
                "dialogue_audio_url": "/new.wav",
                "audio_duration_ms": 1200,
                "planned_duration_ms": 3000,
                "bound_assets": ["char:Alice"],
            }
        ],
        script_id="script_1",
        storyboard_dao=FakeStoryboardDAO,
    )

    assert result["created"] == 0
    assert result["updated"] == 1
    assert result["skipped"] == 0
    assert FakeStoryboardDAO.created is None
    assert FakeStoryboardDAO.updates == [
        {
            "item_id": "sb_1",
            "dialogue_audio_url": "/new.wav",
            "audio_duration_ms": 1200,
            "mixed_audio_url": None,
            "mixed_audio_hash": None,
        }
    ]


async def test_sync_storyboard_items_skips_unchanged_existing_rows():
    FakeStoryboardDAO.episode_rows = [
        {
            "item_id": "sb_1",
            "episode_id": "ep_1",
            "script_id": "script_1",
            "sort_order": 0,
            "dialogue": "Alice: hi",
            "dialogue_audio_url": "/same.wav",
            "narration_audio_url": None,
            "sfx_audio_url": None,
            "audio_duration_ms": 1000,
            "planned_duration_ms": 3000,
            "bound_assets": '["char:Alice"]',
        }
    ]

    result = await storyboard_service.sync_storyboard_items(
        "ep_1",
        items=[
            {
                "itemId": "sb_1",
                "sortOrder": 0,
                "dialogue": "Alice: hi",
                "dialogueAudioUrl": "/same.wav",
                "audioDurationMs": 1000,
                "plannedDurationMs": 3000,
                "boundAssets": ["char:Alice"],
            }
        ],
        script_id="script_1",
        storyboard_dao=FakeStoryboardDAO,
    )

    assert result["created"] == 0
    assert result["updated"] == 0
    assert result["skipped"] == 1
    assert FakeStoryboardDAO.created is None
    assert FakeStoryboardDAO.updates == []


async def test_sync_storyboard_items_updates_configured_references():
    FakeStoryboardDAO.episode_rows = [
        {
            "item_id": "sb_1",
            "episode_id": "ep_1",
            "script_id": "script_1",
            "sort_order": 0,
            "configured_references": '[{"referenceId":"old"}]',
            "reference_config_initialized": False,
        }
    ]

    result = await storyboard_service.sync_storyboard_items(
        "ep_1",
        items=[{
            "itemId": "sb_1",
            "sortOrder": 0,
            "configuredReferences": [{"referenceId": "new", "assetId": "asset-1"}],
            "referenceConfigInitialized": True,
        }],
        script_id="script_1",
        storyboard_dao=FakeStoryboardDAO,
    )

    assert result["updated"] == 1
    assert FakeStoryboardDAO.updates == [{
        "item_id": "sb_1",
        "configured_references": [{"referenceId": "new", "assetId": "asset-1"}],
        "reference_config_initialized": True,
    }]


async def test_sync_storyboard_items_updates_ordered_audio_segments():
    FakeStoryboardDAO.episode_rows = [
        {
            "item_id": "sb_1",
            "episode_id": "ep_1",
            "script_id": "script_1",
            "sort_order": 0,
            "audio_segments": "[]",
            "planned_duration_ms": 3000,
        }
    ]
    segments = [
        {
            "segmentId": "sb_1:speech:1",
            "type": "speech",
            "durationMs": 1800,
            "audioUrl": "/audio/line-1.wav",
        },
        {
            "segmentId": "sb_1:silence:2",
            "type": "silence",
            "durationMs": 1200,
        },
    ]

    result = await storyboard_service.sync_storyboard_items(
        "ep_1",
        items=[{
            "itemId": "sb_1",
            "sortOrder": 0,
            "audioSegments": segments,
            "plannedDurationMs": 3000,
        }],
        script_id="script_1",
        storyboard_dao=FakeStoryboardDAO,
    )

    assert result["updated"] == 1
    assert FakeStoryboardDAO.updates == [{
        "item_id": "sb_1",
        "audio_segments": segments,
    }]


async def test_sync_storyboard_items_creates_missing_rows_and_applies_audio_fields():
    FakeStoryboardDAO.episode_rows = []

    result = await storyboard_service.sync_storyboard_items(
        "ep_1",
        items=[
            {
                "sort_order": 2,
                "scene_heading": "Room",
                "action_text": "Alice enters",
                "dialogue": "Alice: hi",
                "camera_movement": "static",
                "image_prompt": "image",
                "video_prompt": "video",
                "dialogue_audio_url": "/new.wav",
                "audio_duration_ms": 1200,
                "planned_duration_ms": 3000,
                "bound_assets": ["char:Alice"],
            }
        ],
        script_id="script_1",
        storyboard_dao=FakeStoryboardDAO,
    )

    assert result["created"] == 1
    assert result["updated"] == 0
    assert result["skipped"] == 0
    assert FakeStoryboardDAO.created["script_id"] == "script_1"
    assert FakeStoryboardDAO.created["sort_order"] == 2
    assert FakeStoryboardDAO.updates == [
        {
            "item_id": "sb_new",
            "dialogue_audio_url": "/new.wav",
            "audio_duration_ms": 1200,
            "mixed_audio_url": None,
            "mixed_audio_hash": None,
        }
    ]


async def test_extract_to_assets_skips_existing_and_blank_names():
    result = await storyboard_service.extract_to_assets(
        "ep_1",
        characters=[{"name": "Alice"}, {"name": " Bob ", "description": "hero"}, {"name": ""}],
        scenes=[{"name": "Room", "description": "interior"}],
        props=[{"name": " Sword ", "description": "weapon"}],
        script_id="script_1",
        user_id="user_1",
        episode_dao=FakeEpisodeDAO,
        asset_dao=FakeAssetDAO,
    )

    assert [asset["name"] for asset in result["assets"]] == ["Bob", "Room", "Sword"]
    assert FakeAssetDAO.created[0]["asset_type"] == "character"
    assert FakeAssetDAO.created[1]["asset_type"] == "scene"
    assert FakeAssetDAO.created[2]["asset_type"] == "prop"


async def test_extract_to_assets_raises_when_episode_missing():
    FakeEpisodeDAO.missing = True

    with pytest.raises(storyboard_service.EpisodeNotFound):
        await storyboard_service.extract_to_assets(
            "missing",
            characters=[],
            scenes=[],
            props=[],
            script_id=None,
            user_id="user_1",
            episode_dao=FakeEpisodeDAO,
            asset_dao=FakeAssetDAO,
        )
