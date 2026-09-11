from __future__ import annotations

import asyncio
import pytest

from services import script_conversation_service as service


class FakeConversationDAO:
    created_message = None
    updated_message = None
    created_version = None
    selected_version = None
    merged_version = None
    confirmed_version = None
    rejected_version = None
    stale_call = None

    @classmethod
    async def fail_stale_messages(cls, script_id, *, stale_after_seconds):
        cls.stale_call = (script_id, stale_after_seconds)
        return 1

    @staticmethod
    async def list_messages(script_id):
        return [{"message_id": "msg_1", "script_id": script_id, "role": "user"}]

    @staticmethod
    async def list_versions(script_id):
        return [{"version_id": "ver_1", "script_id": script_id, "version_no": 1}]

    @classmethod
    async def create_message(cls, **kwargs):
        cls.created_message = kwargs
        return {"message_id": "msg_new", **kwargs}

    @classmethod
    async def update_message(cls, script_id, message_id, **kwargs):
        cls.updated_message = {"script_id": script_id, "message_id": message_id, **kwargs}
        if message_id == "missing":
            return None
        return cls.updated_message

    @classmethod
    async def create_version(cls, **kwargs):
        cls.created_version = kwargs
        return {"version_id": "ver_new", "version_no": 2, **kwargs}

    @classmethod
    async def select_version(cls, script_id, version_id):
        cls.selected_version = (script_id, version_id)
        if version_id == "missing":
            return None
        return {"version_id": version_id, "script_id": script_id}

    @classmethod
    async def merge_version_metadata(cls, script_id, version_id, metadata):
        cls.merged_version = (script_id, version_id, metadata)
        if version_id == "missing":
            return None
        return {"version_id": version_id, "script_id": script_id, "metadata": metadata}

    @classmethod
    async def confirm_version(cls, script_id, version_id, user_id):
        cls.confirmed_version = (script_id, version_id, user_id)
        if version_id == "missing":
            return None
        return {
            "version_id": version_id,
            "script_id": script_id,
            "status": "ready",
            "previous_version_id": "ver_old",
        }

    @classmethod
    async def reject_version(cls, script_id, version_id, user_id):
        cls.rejected_version = (script_id, version_id, user_id)
        if version_id == "missing":
            return None
        return {"version_id": version_id, "script_id": script_id, "status": "rejected"}


async def test_get_conversation_returns_messages_versions_and_current_pointer():
    result = await service.get_script_conversation(
        {"script_id": "script_1", "current_version_id": "ver_1"},
        conversation_dao=FakeConversationDAO,
    )
    assert result["current_version_id"] == "ver_1"
    assert result["messages"][0]["message_id"] == "msg_1"
    assert result["versions"][0]["version_id"] == "ver_1"
    assert FakeConversationDAO.stale_call == ("script_1", 120)


async def test_get_conversation_loads_messages_and_versions_concurrently():
    class ConcurrentDAO:
        active = 0
        max_active = 0

        @staticmethod
        async def fail_stale_messages(script_id, *, stale_after_seconds):
            return 0

        @classmethod
        async def _load(cls, value):
            cls.active += 1
            cls.max_active = max(cls.max_active, cls.active)
            await asyncio.sleep(0)
            cls.active -= 1
            return value

        @classmethod
        async def list_messages(cls, script_id):
            return await cls._load([{"message_id": "msg_1", "script_id": script_id}])

        @classmethod
        async def list_versions(cls, script_id):
            return await cls._load([{"version_id": "ver_1", "script_id": script_id}])

    await service.get_script_conversation(
        {"script_id": "script_1"},
        conversation_dao=ConcurrentDAO,
    )
    assert ConcurrentDAO.max_active == 2


async def test_create_version_forwards_model_and_storyboard_snapshot():
    result = await service.create_script_version(
        episode_id="ep_1",
        script_id="script_1",
        message_id="msg_2",
        base_version_id="ver_1",
        content="镜头01",
        storyboard_items=[{"id": "shot_1"}],
        source="ai",
        status="ready",
        model_alias="金丹",
        provider="deepseek",
        model_name="deepseek-chat",
        metadata={"requestId": "req_1"},
        set_current=True,
        conversation_dao=FakeConversationDAO,
    )
    assert result["version"]["version_id"] == "ver_new"
    assert FakeConversationDAO.created_version["storyboard_items"] == [{"id": "shot_1"}]
    assert FakeConversationDAO.created_version["base_version_id"] == "ver_1"
    assert FakeConversationDAO.created_version["set_current"] is True


async def test_missing_message_and_version_raise_not_found():
    with pytest.raises(service.ScriptConversationItemNotFound):
        await service.revise_script_message(
            script_id="script_1",
            message_id="missing",
            content=None,
            status="failed",
            metadata=None,
            conversation_dao=FakeConversationDAO,
        )
    with pytest.raises(service.ScriptConversationItemNotFound):
        await service.select_script_version(
            script_id="script_1",
            version_id="missing",
            conversation_dao=FakeConversationDAO,
        )


async def test_merge_version_metadata_persists_billing_snapshot():
    result = await service.merge_script_version_metadata(
        script_id="script_1",
        version_id="ver_1",
        metadata={"storyboardDesignCreditCost": 12},
        conversation_dao=FakeConversationDAO,
    )

    assert result["version"]["metadata"]["storyboardDesignCreditCost"] == 12
    assert FakeConversationDAO.merged_version[0:2] == ("script_1", "ver_1")


async def test_confirm_and_reject_draft_are_explicit_actions():
    confirmed = await service.confirm_script_version(
        episode_id="ep_1",
        script_id="script_1",
        version_id="ver_draft",
        user_id="user_1",
        conversation_dao=FakeConversationDAO,
    )
    rejected = await service.reject_script_version(
        script_id="script_1",
        version_id="ver_other",
        user_id="user_1",
        conversation_dao=FakeConversationDAO,
    )

    assert confirmed["previous_version_id"] == "ver_old"
    assert confirmed["version"]["status"] == "ready"
    assert rejected["version"]["status"] == "rejected"
    assert rejected["outcome"] == "rejected"


async def test_reject_reconciles_an_already_confirmed_version_without_404():
    class AlreadyConfirmedConversationDAO(FakeConversationDAO):
        @classmethod
        async def reject_version(cls, script_id, version_id, user_id):
            return {
                "version_id": version_id,
                "script_id": script_id,
                "status": "ready",
                "content": "已确认脚本",
                "rejection_outcome": "already_confirmed",
                "current_version_id": version_id,
            }

    result = await service.reject_script_version(
        script_id="script_1",
        version_id="ver_ready",
        user_id="user_1",
        conversation_dao=AlreadyConfirmedConversationDAO,
    )

    assert result["success"] is True
    assert result["outcome"] == "already_confirmed"
    assert result["current_version_id"] == "ver_ready"
    assert result["version"]["status"] == "ready"


async def test_reject_is_idempotent_for_an_already_rejected_version():
    class AlreadyRejectedConversationDAO(FakeConversationDAO):
        @classmethod
        async def reject_version(cls, script_id, version_id, user_id):
            return {
                "version_id": version_id,
                "script_id": script_id,
                "status": "rejected",
                "rejection_outcome": "already_rejected",
                "current_version_id": "ver_current",
            }

    result = await service.reject_script_version(
        script_id="script_1",
        version_id="ver_rejected",
        user_id="user_1",
        conversation_dao=AlreadyRejectedConversationDAO,
    )

    assert result["outcome"] == "already_rejected"
    assert result["current_version_id"] == "ver_current"
    assert result["version"]["status"] == "rejected"


async def test_confirm_retry_repairs_stale_events_after_primary_commit():
    class AlreadyConfirmedConversationDAO(FakeConversationDAO):
        @classmethod
        async def confirm_version(cls, script_id, version_id, user_id):
            return {
                "version_id": version_id,
                "script_id": script_id,
                "status": "ready",
                "previous_version_id": version_id,
                "base_version_id": "ver_old",
                "patch": {},
            }

    class RetryWorkflowDAO:
        stale_calls = []

        @staticmethod
        async def list_storyboard_targets(**_kwargs):
            return [{
                "item_id": "item_" + "a" * 36,
                "lineage_id": "line_1",
                "episode_id": "ep_1",
                "project_id": "proj_1",
                "audio_segments": [{
                    "segmentId": "item_" + "a" * 36 + ":speech:" + "b" * 36,
                    "kind": "speech",
                    "speaker": "角色",
                }],
                "script_segment_source_text": "",
            }]

        @classmethod
        async def create_stale_event(cls, **kwargs):
            cls.stale_calls.append(kwargs)
            return {"stale_event_id": f"stale_{len(cls.stale_calls)}", **kwargs}

    RetryWorkflowDAO.stale_calls = []
    result = await service.confirm_script_version(
        episode_id="ep_1",
        script_id="script_1",
        version_id="ver_new",
        user_id="user_1",
        conversation_dao=AlreadyConfirmedConversationDAO,
        content_workflow_dao=RetryWorkflowDAO,
    )

    audio_slots = [
        event["target_slot"]
        for event in RetryWorkflowDAO.stale_calls
        if event["target_slot"].startswith("dialogue_audio:")
    ]
    assert result["previous_version_id"] == "ver_new"
    assert len(audio_slots) == 1
    assert len(audio_slots[0]) > 50
    assert RetryWorkflowDAO.stale_calls[0]["detail"]["previousVersionId"] == "ver_old"


async def test_confirm_retry_uses_persisted_adoption_patch_for_a_draft_chain():
    class AlreadyConfirmedConversationDAO(FakeConversationDAO):
        @classmethod
        async def confirm_version(cls, script_id, version_id, user_id):
            return {
                "version_id": version_id,
                "script_id": script_id,
                "status": "ready",
                "previous_version_id": version_id,
                "base_version_id": "ver_3",
                "patch": {
                    "summary": {"changed": 1},
                    "operations": [{"before": ["V3局部内容"], "after": ["V4局部内容"]}],
                },
                "metadata": {
                    "confirmationBaseVersionId": "ver_2",
                    "confirmationPatch": {
                        "summary": {"changed": 2},
                        "operations": [{"before": ["V2正式内容"], "after": ["V4最终内容"]}],
                    },
                },
            }

    class RetryWorkflowDAO:
        stale_calls = []

        @staticmethod
        async def list_storyboard_targets(**_kwargs):
            return [{
                "item_id": "item_" + "a" * 36,
                "lineage_id": "line_1",
                "episode_id": "ep_1",
                "project_id": "proj_1",
                "audio_segments": [],
                "script_segment_source_text": "V2正式内容",
            }]

        @classmethod
        async def create_stale_event(cls, **kwargs):
            cls.stale_calls.append(kwargs)
            return {"stale_event_id": f"stale_{len(cls.stale_calls)}", **kwargs}

    RetryWorkflowDAO.stale_calls = []
    result = await service.confirm_script_version(
        episode_id="ep_1",
        script_id="script_1",
        version_id="ver_4",
        user_id="user_1",
        conversation_dao=AlreadyConfirmedConversationDAO,
        content_workflow_dao=RetryWorkflowDAO,
    )

    assert result["previous_version_id"] == "ver_4"
    assert RetryWorkflowDAO.stale_calls
    detail = RetryWorkflowDAO.stale_calls[0]["detail"]
    assert detail["previousVersionId"] == "ver_2"
    assert detail["patchSummary"]["changed"] == 2


async def test_confirm_decodes_jsonb_patch_strings_before_stale_propagation():
    class JsonStringPatchConversationDAO(FakeConversationDAO):
        @classmethod
        async def confirm_version(cls, script_id, version_id, user_id):
            return {
                "version_id": version_id,
                "script_id": script_id,
                "status": "ready",
                "previous_version_id": "ver_old",
                "base_version_id": "ver_old",
                "patch": '{"summary":{"changed":1},"operations":[]}',
            }

    class WorkflowDAO:
        @staticmethod
        async def list_storyboard_targets(**_kwargs):
            return []

    result = await service.confirm_script_version(
        episode_id="ep_1",
        script_id="script_1",
        version_id="ver_new",
        user_id="user_1",
        conversation_dao=JsonStringPatchConversationDAO,
        content_workflow_dao=WorkflowDAO,
    )

    assert result["version"]["patch"]["summary"]["changed"] == 1
    assert result["stale_propagation_pending"] is False


async def test_confirm_does_not_report_false_failure_after_primary_commit(caplog):
    class ConfirmedConversationDAO(FakeConversationDAO):
        @classmethod
        async def confirm_version(cls, script_id, version_id, user_id):
            return {
                "version_id": version_id,
                "script_id": script_id,
                "status": "ready",
                "previous_version_id": "ver_old",
                "base_version_id": "ver_old",
                "patch": {"operations": []},
            }

    class BrokenWorkflowDAO:
        @staticmethod
        async def list_storyboard_targets(**_kwargs):
            raise RuntimeError("temporary stale propagation failure")

    result = await service.confirm_script_version(
        episode_id="ep_1",
        script_id="script_1",
        version_id="ver_new",
        user_id="user_1",
        conversation_dao=ConfirmedConversationDAO,
        content_workflow_dao=BrokenWorkflowDAO,
    )

    assert result["success"] is True
    assert result["version"]["status"] == "ready"
    assert result["stale_events"] == []
    assert result["stale_propagation_pending"] is True
    assert "stale propagation failed" in caplog.text
