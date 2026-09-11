"""Business rules for per-script conversations and immutable versions."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, Optional


logger = logging.getLogger(__name__)


class ScriptConversationError(RuntimeError):
    pass


class ScriptConversationItemNotFound(ScriptConversationError):
    pass


def _json_object(value: Any) -> Dict[str, Any]:
    """Normalize JSON/JSONB values returned by different asyncpg codecs."""
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


async def get_script_conversation(
    script: dict,
    *,
    conversation_dao: Any,
) -> Dict[str, Any]:
    script_id = str(script["script_id"])
    await conversation_dao.fail_stale_messages(script_id, stale_after_seconds=120)
    messages, versions = await asyncio.gather(
        conversation_dao.list_messages(script_id),
        conversation_dao.list_versions(script_id),
    )
    return {
        "success": True,
        "script": dict(script),
        "messages": messages,
        "versions": versions,
        "current_version_id": script.get("current_version_id"),
    }


async def append_script_message(
    *,
    episode_id: str,
    script_id: str,
    role: str,
    content: str,
    status: str,
    model_alias: Optional[str],
    provider: Optional[str],
    model_name: Optional[str],
    reply_to_message_id: Optional[str],
    request_id: Optional[str],
    metadata: Optional[dict],
    conversation_dao: Any,
) -> Dict[str, Any]:
    message = await conversation_dao.create_message(
        episode_id=episode_id,
        script_id=script_id,
        role=role,
        content=content,
        status=status,
        model_alias=model_alias,
        provider=provider,
        model_name=model_name,
        reply_to_message_id=reply_to_message_id,
        request_id=request_id,
        metadata=metadata,
    )
    if not message:
        raise ScriptConversationError("Unable to create script message")
    return {"success": True, "message": message}


async def revise_script_message(
    *,
    script_id: str,
    message_id: str,
    content: Optional[str],
    status: Optional[str],
    metadata: Optional[dict],
    conversation_dao: Any,
) -> Dict[str, Any]:
    message = await conversation_dao.update_message(
        script_id,
        message_id,
        content=content,
        status=status,
        metadata=metadata,
    )
    if not message:
        raise ScriptConversationItemNotFound("Script message not found")
    return {"success": True, "message": message}


async def create_script_version(
    *,
    episode_id: str,
    script_id: str,
    message_id: Optional[str],
    content: str,
    storyboard_items: list,
    source: str,
    status: str,
    model_alias: Optional[str],
    provider: Optional[str],
    model_name: Optional[str],
    metadata: Optional[dict],
    set_current: bool,
    conversation_dao: Any,
    user_id: Optional[str] = None,
    base_version_id: Optional[str] = None,
) -> Dict[str, Any]:
    version = await conversation_dao.create_version(
        episode_id=episode_id,
        script_id=script_id,
        message_id=message_id,
        base_version_id=base_version_id,
        content=content,
        storyboard_items=storyboard_items,
        source=source,
        status=status,
        model_alias=model_alias,
        provider=provider,
        model_name=model_name,
        metadata=metadata,
        set_current=set_current,
        user_id=user_id,
    )
    if not version:
        raise ScriptConversationError("Unable to create script version")
    return {"success": True, "version": version}

async def select_script_version(
    *,
    script_id: str,
    version_id: str,
    conversation_dao: Any,
) -> Dict[str, Any]:
    version = await conversation_dao.select_version(script_id, version_id)
    if not version:
        raise ScriptConversationItemNotFound("Script version not found")
    return {"success": True, "version": version}


async def confirm_script_version(
    *,
    episode_id: str,
    script_id: str,
    version_id: str,
    user_id: Optional[str],
    conversation_dao: Any,
    content_workflow_dao: Any = None,
) -> Dict[str, Any]:
    version = await conversation_dao.confirm_version(script_id, version_id, user_id)
    if not version:
        raise ScriptConversationItemNotFound("Draft script version not found")
    events = []
    previous_version_id = version.pop("previous_version_id", None)
    # PostgreSQL JSONB may be decoded either as a dict or as a JSON string,
    # depending on the active asyncpg codec.  Confirmation must not fail after
    # the primary transaction has committed merely because patch propagation
    # received the string representation.
    version["patch"] = _json_object(version.get("patch"))
    version["metadata"] = _json_object(version.get("metadata"))
    confirmation_base_version_id = version["metadata"].get("confirmationBaseVersionId")
    has_confirmation_patch = "confirmationPatch" in version["metadata"]
    confirmation_patch = _json_object(version["metadata"].get("confirmationPatch"))
    # Confirmation and stale propagation use separate DAO transactions.  If an
    # older deployment confirmed the version but failed while creating stale
    # events, a retry sees the confirmed version as the current pointer.  Fall
    # back to the immutable base version so the idempotent stale events can be
    # repaired instead of being skipped forever.
    propagation_base_version_id = (
        previous_version_id
        if previous_version_id != version_id
        else confirmation_base_version_id or version.get("base_version_id")
    )
    propagation_patch = (
        confirmation_patch
        if has_confirmation_patch and propagation_base_version_id == confirmation_base_version_id
        else version["patch"]
    )
    stale_propagation_pending = False
    if (
        content_workflow_dao is not None
        and propagation_base_version_id
        and propagation_base_version_id != version_id
    ):
        from services.content_workflow_service import mark_confirmed_script_stale

        try:
            events = await mark_confirmed_script_stale(
                episode_id=episode_id,
                version_id=version_id,
                previous_version_id=propagation_base_version_id,
                patch=propagation_patch,
                user_id=user_id,
                workflow_dao=content_workflow_dao,
            )
        except Exception:
            # The version pointer and adapted script were committed by
            # confirm_version already.  Returning a 500 here creates a false
            # failure in the UI and encourages duplicate confirmation clicks.
            # Keep the successful confirmation visible and flag the auxiliary
            # stale propagation for operational reconciliation.
            stale_propagation_pending = True
            logger.exception(
                "script version %s confirmed, but stale propagation failed",
                version_id,
            )
    return {
        "success": True,
        "version": version,
        "previous_version_id": previous_version_id,
        "stale_events": events,
        "stale_propagation_pending": stale_propagation_pending,
    }


async def reject_script_version(
    *,
    script_id: str,
    version_id: str,
    user_id: Optional[str],
    conversation_dao: Any,
) -> Dict[str, Any]:
    version = await conversation_dao.reject_version(script_id, version_id, user_id)
    if not version:
        raise ScriptConversationItemNotFound("Draft script version not found")
    outcome = version.pop("rejection_outcome", "rejected")
    current_version_id = version.pop("current_version_id", None)
    return {
        "success": True,
        "version": version,
        "outcome": outcome,
        "current_version_id": current_version_id,
    }


async def merge_script_version_metadata(
    *,
    script_id: str,
    version_id: str,
    metadata: dict,
    conversation_dao: Any,
) -> Dict[str, Any]:
    version = await conversation_dao.merge_version_metadata(script_id, version_id, metadata)
    if not version:
        raise ScriptConversationItemNotFound("Script version not found")
    return {"success": True, "version": version}
