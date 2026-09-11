from __future__ import annotations

from services import content_workflow_service as service


class FakeWorkflowDAO:
    created_take = None
    selected = None
    stale_events = []

    @classmethod
    def reset(cls):
        cls.created_take = None
        cls.selected = None
        cls.stale_events = []

    @staticmethod
    async def resolve_entity_context(entity_type, entity_id, *, episode_id=None, lineage_id=None):
        assert entity_type == "storyboard_item"
        assert entity_id == "sb_old"
        assert episode_id == "ep_1"
        assert lineage_id == "lineage_1"
        return {
            "entity_type": "storyboard_item",
            "entity_id": "sb_current",
            "entity_lineage_id": "lineage_1",
            "episode_id": "ep_1",
            "project_id": "project_1",
        }

    @classmethod
    async def create_take(cls, **kwargs):
        cls.created_take = {"take_id": "take_1", **kwargs}
        return cls.created_take

    @staticmethod
    async def resolve_stale_for_regenerated_take(**kwargs):
        return [{"stale_event_id": "stale_1", **kwargs}]

    @classmethod
    async def select_take(cls, entity_type, entity_id, slot, take_id, selected_by):
        cls.selected = (entity_type, entity_id, slot, take_id, selected_by)
        return {
            "take_id": take_id,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "entity_lineage_id": "lineage_1",
            "slot": slot,
            "episode_id": "ep_1",
            "project_id": "project_1",
        }

    @classmethod
    async def create_stale_event(cls, **kwargs):
        event = {"stale_event_id": f"stale_{len(cls.stale_events) + 1}", **kwargs}
        cls.stale_events.append(event)
        return event


async def test_late_take_attaches_to_current_lineage_without_auto_select():
    FakeWorkflowDAO.reset()
    take = await service.register_generated_take(
        user_id="user_1",
        file_id="file_1",
        file_type="image",
        entity_type="storyboard_item",
        entity_id="sb_old",
        file_role="generated_image",
        source="ai_image",
        project_id="project_1",
        episode_id="ep_1",
        metadata={"storyboard_lineage_id": "lineage_1", "task_id": "task_1"},
        workflow_dao=FakeWorkflowDAO,
    )

    assert take["entity_id"] == "sb_current"
    assert take["entity_lineage_id"] == "lineage_1"
    assert take["is_late"] is True
    assert take["metadata"]["attachmentPolicy"] == "lineage-no-auto-select"
    assert FakeWorkflowDAO.selected is None
    assert take["resolved_stale_events"] == []


async def test_video_segment_uses_storyboard_request_identity_for_late_detection():
    class VideoWorkflowDAO(FakeWorkflowDAO):
        @staticmethod
        async def resolve_entity_context(entity_type, entity_id, **_kwargs):
            assert (entity_type, entity_id) == ("video_segment", "segment_1")
            return {
                "entity_type": "storyboard_item",
                "entity_id": "shot_1",
                "entity_lineage_id": "line_1",
                "requested_entity_id": "shot_1",
                "is_late_lineage_attachment": False,
                "source_id": "segment_1",
                "episode_id": "ep_1",
                "project_id": "project_1",
            }

    VideoWorkflowDAO.reset()
    take = await service.register_generated_take(
        user_id="user_1",
        file_id=None,
        file_type="video",
        entity_type="video_segment",
        entity_id="segment_1",
        file_role="video",
        source="video_segment",
        project_id="project_1",
        episode_id="ep_1",
        metadata={"task_id": "task_1"},
        workflow_dao=VideoWorkflowDAO,
    )

    assert take["requested_entity_id"] == "shot_1"
    assert take["is_late"] is False


async def test_selecting_keyframe_marks_only_video_stale():
    FakeWorkflowDAO.reset()
    result = await service.select_content_take(
        entity_type="storyboard_item",
        entity_id="sb_current",
        slot="keyframe",
        take_id="take_image",
        selected_by="user_1",
        workflow_dao=FakeWorkflowDAO,
    )

    assert FakeWorkflowDAO.selected == (
        "storyboard_item", "sb_current", "keyframe", "take_image", "user_1"
    )
    assert [event["target_slot"] for event in result["stale_events"]] == ["video"]
    assert result["stale_events"][0]["reason_code"] == "selected_keyframe_changed"
    assert result["resolved_stale_events"][0]["take_id"] == "take_image"


async def test_selecting_video_marks_episode_final_stale():
    FakeWorkflowDAO.reset()
    result = await service.select_content_take(
        entity_type="storyboard_item",
        entity_id="sb_current",
        slot="video",
        take_id="take_video",
        selected_by="user_1",
        workflow_dao=FakeWorkflowDAO,
    )

    event = result["stale_events"][0]
    assert event["target_entity_type"] == "episode"
    assert event["target_entity_id"] == "ep_1"
    assert event["target_slot"] == "final_video"


def test_binding_tag_normalization_accepts_product_aliases():
    assert service.normalize_tag_key("角色:小雨") == "char:小雨"
    assert service.normalize_tag_key("scene:咖啡店") == "scene:咖啡店"


def test_audio_candidate_slot_preserves_clip_identity():
    assert service.slot_for_file("audio", "dialogue_audio:clip_2") == "dialogue_audio:clip_2"
    assert service.slot_for_file("audio", "narration_audio") == "narration_audio"


def test_audio_candidate_slots_follow_each_speech_segment():
    target = {
        "audio_segments": [
            {"segmentId": "clip_dialogue", "kind": "speech", "speaker": "小雨"},
            {"segmentId": "clip_pause", "kind": "silence"},
            {"segment_id": "clip_narration", "type": "speech", "speaker": "旁白"},
        ]
    }

    assert service.audio_candidate_slots_for_target(target) == [
        "dialogue_audio:clip_dialogue",
        "narration_audio:clip_narration",
    ]


async def test_script_patch_only_stales_matching_segments_and_unattributed_legacy_rows():
    class PatchWorkflowDAO(FakeWorkflowDAO):
        @staticmethod
        async def list_storyboard_targets(**_kwargs):
            return [
                {
                    "item_id": "shot_changed",
                    "lineage_id": "line_changed",
                    "episode_id": "ep_1",
                    "script_segment_source_text": "旧对白：我们走。",
                },
                {
                    "item_id": "shot_unaffected",
                    "lineage_id": "line_unaffected",
                    "episode_id": "ep_1",
                    "script_segment_source_text": "完全无关的场景。",
                },
                {
                    "item_id": "shot_legacy",
                    "lineage_id": "line_legacy",
                    "episode_id": "ep_1",
                    "script_segment_source_text": "",
                },
            ]

    PatchWorkflowDAO.reset()
    events = await service.mark_confirmed_script_stale(
        episode_id="ep_1",
        version_id="ver_new",
        previous_version_id="ver_old",
        patch={
            "summary": {"changed": 1},
            "operations": [{"before": ["旧对白：我们走。"], "after": ["新对白：留下。"]}],
        },
        user_id="user_1",
        workflow_dao=PatchWorkflowDAO,
    )

    target_ids = {event["target_entity_id"] for event in events}
    assert target_ids == {"shot_changed", "shot_legacy"}
