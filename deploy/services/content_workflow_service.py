"""Unified candidate, selection, binding and stale-propagation rules."""
from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Iterable, Optional


class ContentWorkflowError(RuntimeError):
    pass


class ContentTakeNotFound(ContentWorkflowError):
    pass


class ContentBindingNotFound(ContentWorkflowError):
    pass


class InvalidContentWorkflowRequest(ContentWorkflowError):
    pass


FILE_ROLE_TO_SLOT = {
    "generated_image": "keyframe",
    "image": "keyframe",
    "video": "video",
    "dialogue_audio": "dialogue_audio",
    "narration_audio": "narration_audio",
    "sfx": "sfx_audio",
    "sfx_audio": "sfx_audio",
    "mixed_audio": "mixed_audio",
}


def normalize_entity_type(entity_type: str) -> str:
    return {
        "storyboard": "storyboard_item",
        "shot": "storyboard_item",
    }.get(str(entity_type or "").strip(), str(entity_type or "").strip())


def slot_for_file(file_type: str, file_role: Optional[str]) -> Optional[str]:
    role = str(file_role or "").strip()
    base_role, separator, qualifier = role.partition(":")
    if separator and base_role in FILE_ROLE_TO_SLOT and qualifier:
        return f"{FILE_ROLE_TO_SLOT[base_role]}:{qualifier}"
    if role in FILE_ROLE_TO_SLOT:
        return FILE_ROLE_TO_SLOT[role]
    return {
        "image": "keyframe",
        "video": "video",
        "audio": "audio",
    }.get(str(file_type or "").strip())


def normalize_tag_key(tag_key: str) -> str:
    value = str(tag_key or "").strip()
    if not value or ":" not in value:
        raise InvalidContentWorkflowRequest("tag_key must use type:name format")
    prefix, name = value.split(":", 1)
    prefix = {
        "character": "char",
        "人物": "char",
        "角色": "char",
        "场景": "scene",
        "道具": "prop",
    }.get(prefix.strip().lower(), prefix.strip().lower())
    if prefix not in {"char", "scene", "prop"} or not name.strip():
        raise InvalidContentWorkflowRequest("unsupported binding tag")
    return f"{prefix}:{name.strip()}"


def _idempotency_key(*parts: Optional[str]) -> str:
    raw = "|".join(str(part or "") for part in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def audio_candidate_slots_for_target(target: Dict[str, Any]) -> list[str]:
    segments = target.get("audio_segments") or []
    if isinstance(segments, str):
        try:
            segments = json.loads(segments)
        except (TypeError, ValueError):
            segments = []
    slots: list[str] = []
    for segment in segments if isinstance(segments, list) else []:
        if not isinstance(segment, dict) or (segment.get("kind") or segment.get("type")) != "speech":
            continue
        segment_id = str(segment.get("segmentId") or segment.get("segment_id") or "").strip()
        if not segment_id:
            continue
        prefix = "narration_audio" if str(segment.get("speaker") or "").strip() == "旁白" else "dialogue_audio"
        slots.append(f"{prefix}:{segment_id}")
    return list(dict.fromkeys(slots)) or ["dialogue_audio"]


async def register_generated_take(
    *,
    user_id: Optional[str],
    file_id: Optional[str],
    file_type: str,
    entity_type: Optional[str],
    entity_id: Optional[str],
    file_role: Optional[str],
    source: str,
    project_id: Optional[str],
    episode_id: Optional[str],
    metadata: Optional[dict],
    workflow_dao: Any,
) -> Optional[Dict[str, Any]]:
    """Attach a generated output as a candidate without changing selection.

    The task may carry ``storyboard_lineage_id`` from submission time.  If the
    original item disappeared while the task was running, the DAO resolves the
    current item for that lineage and the new take is attached there as late.
    """
    if not entity_type or not entity_id:
        return None
    slot = slot_for_file(file_type, file_role)
    if not slot:
        return None

    details = dict(metadata or {})
    normalized_type = normalize_entity_type(entity_type)
    requested_value = details.get("requested_entity_id")
    requested_entity_id = (
        str(requested_value)
        if requested_value
        else None if normalized_type == "video_segment" else str(entity_id)
    )
    requested_lineage_id = details.get("storyboard_lineage_id") or details.get("lineage_id")
    resolved_episode_id = episode_id or details.get("episode_id")
    attachment_round = min(3, max(0, int(details.get("attachment_round") or 0)))
    context = await workflow_dao.resolve_entity_context(
        normalized_type,
        str(entity_id),
        episode_id=resolved_episode_id,
        lineage_id=requested_lineage_id,
    )
    if not context:
        return None

    if not details.get("requested_entity_id") and context.get("requested_entity_id"):
        requested_entity_id = str(context["requested_entity_id"])
    requested_lineage_id = requested_lineage_id or context.get("entity_lineage_id")

    source_type = "video_segment" if normalized_type == "video_segment" else (source or "generated")
    source_id = context.get("source_id") or file_id
    source_task_id = details.get("task_id") or context.get("source_task_id")
    model_name = details.get("model_name") or details.get("model") or context.get("model_name")
    generation_params = details.get("generation_params") or context.get("generation_params") or {}
    is_late = bool(
        context.get("is_late_lineage_attachment")
        or (
            requested_lineage_id
            and requested_entity_id
            and (
            str(context.get("entity_id") or "") != requested_entity_id
            or details.get("task_started_version_id") != details.get("current_version_id")
            )
        )
    )
    take = await workflow_dao.create_take(
        user_id=user_id,
        project_id=context.get("project_id") or project_id,
        episode_id=context.get("episode_id") or resolved_episode_id,
        entity_type=context["entity_type"],
        entity_id=context["entity_id"],
        entity_lineage_id=context.get("entity_lineage_id"),
        slot=slot,
        file_id=file_id,
        source_type=source_type,
        source_id=source_id,
        source_task_id=source_task_id,
        requested_entity_id=requested_entity_id,
        requested_lineage_id=requested_lineage_id,
        provider=details.get("provider"),
        model_name=model_name,
        generation_params=generation_params,
        metadata={**details, "attachmentPolicy": "lineage-no-auto-select"},
        attachment_round=attachment_round,
        is_late=is_late,
    )
    if take:
        # A finished task only adds a candidate.  Stale state remains pending
        # until that candidate is explicitly selected, so a late result cannot
        # make an older user selection appear fresh.
        take = {**take, "resolved_stale_events": []}
    return take


async def list_content_takes(
    *,
    entity_type: str,
    entity_id: str,
    slot: str,
    workflow_dao: Any,
) -> Dict[str, Any]:
    items = await workflow_dao.list_takes(normalize_entity_type(entity_type), entity_id, slot)
    return {"success": True, "items": items, "total": len(items)}


async def _mark_downstream_stale_for_selection(
    take: Dict[str, Any],
    *,
    selected_by: Optional[str],
    workflow_dao: Any,
) -> list[Dict[str, Any]]:
    slot = str(take.get("slot") or "")
    base_slot = slot.split(":", 1)[0]
    if base_slot == "video":
        target_entity_type = "episode"
        target_entity_id = str(take.get("episode_id") or "")
        target_lineage_id = target_entity_id
        target_slots = ["final_video"]
    else:
        target_entity_type = str(take.get("entity_type") or "")
        target_entity_id = str(take.get("entity_id") or "")
        target_lineage_id = take.get("entity_lineage_id")
        target_slots = ["video"] if base_slot in {
            "keyframe", "audio", "dialogue_audio", "narration_audio", "sfx_audio", "mixed_audio"
        } else []
    if not target_entity_id:
        return []

    events: list[Dict[str, Any]] = []
    for target_slot in target_slots:
        event = await workflow_dao.create_stale_event(
            project_id=take.get("project_id"),
            episode_id=take.get("episode_id"),
            target_entity_type=target_entity_type,
            target_entity_id=target_entity_id,
            target_lineage_id=target_lineage_id,
            target_slot=target_slot,
            source_entity_type="content_take",
            source_entity_id=take.get("take_id"),
            reason_code=f"selected_{base_slot}_changed",
            detail={"selectedTakeId": take.get("take_id"), "sourceSlot": slot},
            idempotency_key=_idempotency_key(
                "take-selection",
                take.get("take_id"),
                target_entity_type,
                target_entity_id,
                target_slot,
            ),
            created_by=selected_by,
        )
        if event:
            events.append(event)
    return events


async def select_content_take(
    *,
    entity_type: str,
    entity_id: str,
    slot: str,
    take_id: str,
    selected_by: Optional[str],
    workflow_dao: Any,
) -> Dict[str, Any]:
    take = await workflow_dao.select_take(
        normalize_entity_type(entity_type),
        entity_id,
        slot,
        take_id,
        selected_by,
    )
    if not take:
        raise ContentTakeNotFound("take does not belong to the requested slot")
    resolved = await workflow_dao.resolve_stale_for_regenerated_take(
        entity_type=take["entity_type"],
        entity_id=take["entity_id"],
        entity_lineage_id=take.get("entity_lineage_id"),
        slot=take["slot"],
        resolved_by=selected_by,
        take_id=take["take_id"],
    )
    events = await _mark_downstream_stale_for_selection(
        take,
        selected_by=selected_by,
        workflow_dao=workflow_dao,
    )
    return {
        "success": True,
        "take": take,
        "resolved_stale_events": resolved,
        "stale_events": events,
    }


async def list_stale_content(
    episode_id: str,
    *,
    status: str,
    workflow_dao: Any,
) -> Dict[str, Any]:
    if status not in {"pending", "ignored", "regenerated"}:
        raise InvalidContentWorkflowRequest("unsupported stale status")
    items = await workflow_dao.list_stale_events(episode_id, status)
    return {"success": True, "items": items, "total": len(items)}


async def resolve_stale_content(
    stale_event_id: str,
    *,
    status: str,
    resolved_by: Optional[str],
    resolution_note: Optional[str],
    workflow_dao: Any,
) -> Dict[str, Any]:
    if status not in {"ignored", "regenerated"}:
        raise InvalidContentWorkflowRequest("stale event can only be ignored or regenerated")
    event = await workflow_dao.resolve_stale_event(
        stale_event_id,
        status=status,
        resolved_by=resolved_by,
        resolution_note=resolution_note,
    )
    if not event:
        raise ContentWorkflowError("stale event not found or already resolved")
    return {"success": True, "event": event}


async def mark_storyboard_targets_stale(
    targets: Iterable[Dict[str, Any]],
    *,
    slots: Iterable[str],
    source_entity_type: str,
    source_entity_id: Optional[str],
    reason_code: str,
    detail: Optional[dict],
    created_by: Optional[str],
    workflow_dao: Any,
) -> list[Dict[str, Any]]:
    events: list[Dict[str, Any]] = []
    detail_token = hashlib.sha256(
        json.dumps(detail or {}, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()
    for target in targets:
        for slot in slots:
            event = await workflow_dao.create_stale_event(
                project_id=target.get("project_id"),
                episode_id=target.get("episode_id"),
                target_entity_type="storyboard_item",
                target_entity_id=target["item_id"],
                target_lineage_id=target.get("lineage_id"),
                target_slot=slot,
                source_entity_type=source_entity_type,
                source_entity_id=source_entity_id,
                reason_code=reason_code,
                detail=detail or {},
                idempotency_key=_idempotency_key(
                    reason_code,
                    source_entity_id,
                    target.get("lineage_id") or target["item_id"],
                    slot,
                    detail_token,
                ),
                created_by=created_by,
            )
            if event:
                events.append(event)
    return events


async def upsert_content_binding(
    *,
    project_id: str,
    episode_id: Optional[str],
    storyboard_item_id: Optional[str],
    tag_key: str,
    scope: str,
    asset_id: Optional[str],
    file_id: Optional[str],
    is_disabled: bool,
    locked: bool,
    user_id: Optional[str],
    workflow_dao: Any,
) -> Dict[str, Any]:
    if scope not in {"project", "shot"}:
        raise InvalidContentWorkflowRequest("scope must be project or shot")
    if scope == "shot" and not storyboard_item_id:
        raise InvalidContentWorkflowRequest("shot scope requires storyboard_item_id")
    if not is_disabled and not asset_id:
        raise InvalidContentWorkflowRequest("active binding requires asset_id")
    normalized_tag = normalize_tag_key(tag_key)
    binding = await workflow_dao.upsert_binding(
        project_id=project_id,
        episode_id=episode_id,
        storyboard_item_id=storyboard_item_id,
        tag_key=normalized_tag,
        scope=scope,
        asset_id=asset_id,
        file_id=file_id,
        is_disabled=is_disabled,
        locked=locked,
        user_id=user_id,
    )
    if not binding:
        raise InvalidContentWorkflowRequest("asset or storyboard item is outside this project")
    targets = await workflow_dao.list_storyboard_targets(
        storyboard_item_id=storyboard_item_id if scope == "shot" else None,
        project_id=project_id if scope == "project" else None,
        tag_key=normalized_tag,
    )
    events = await mark_storyboard_targets_stale(
        targets,
        slots=("keyframe", "video"),
        source_entity_type="content_binding",
        source_entity_id=binding["binding_id"],
        reason_code="binding_changed",
        detail={
            "tagKey": normalized_tag,
            "scope": scope,
            "assetId": asset_id,
            "disabled": is_disabled,
            "bindingVersion": binding.get("binding_version"),
        },
        created_by=user_id,
        workflow_dao=workflow_dao,
    )
    return {"success": True, "binding": binding, "stale_events": events}


async def delete_content_binding(
    binding_id: str,
    *,
    project_id: str,
    user_id: Optional[str],
    workflow_dao: Any,
) -> Dict[str, Any]:
    binding = await workflow_dao.delete_binding(binding_id, project_id)
    if not binding:
        raise ContentBindingNotFound("binding not found")
    targets = await workflow_dao.list_storyboard_targets(
        storyboard_item_id=binding.get("storyboard_item_id") if binding.get("scope") == "shot" else None,
        project_id=project_id if binding.get("scope") == "project" else None,
        tag_key=binding.get("tag_key"),
    )
    events = await mark_storyboard_targets_stale(
        targets,
        slots=("keyframe", "video"),
        source_entity_type="content_binding",
        source_entity_id=binding_id,
        reason_code="binding_removed",
        detail={"tagKey": binding.get("tag_key"), "scope": binding.get("scope")},
        created_by=user_id,
        workflow_dao=workflow_dao,
    )
    return {"success": True, "binding": binding, "stale_events": events}


async def list_content_bindings(
    project_id: str,
    *,
    episode_id: Optional[str],
    storyboard_item_id: Optional[str],
    workflow_dao: Any,
) -> Dict[str, Any]:
    items = await workflow_dao.list_bindings(
        project_id,
        episode_id=episode_id,
        storyboard_item_id=storyboard_item_id,
    )
    return {"success": True, "items": items, "total": len(items)}


async def resolve_content_bindings(
    *,
    project_id: str,
    storyboard_item_id: str,
    tag_keys: list[str],
    workflow_dao: Any,
) -> Dict[str, Any]:
    normalized = [normalize_tag_key(tag) for tag in dict.fromkeys(tag_keys)]
    items = await workflow_dao.resolve_bindings(project_id, storyboard_item_id, normalized)
    by_tag = {item["tag_key"]: item for item in items}
    return {
        "success": True,
        "items": items,
        "resolved": [by_tag[tag] for tag in normalized if tag in by_tag],
        "missing": [tag for tag in normalized if tag not in by_tag],
    }


async def mark_confirmed_script_stale(
    *,
    episode_id: str,
    version_id: str,
    previous_version_id: Optional[str],
    patch: Optional[dict] = None,
    user_id: Optional[str],
    workflow_dao: Any,
) -> list[Dict[str, Any]]:
    targets = await workflow_dao.list_storyboard_targets(episode_id=episode_id)
    operations = (patch or {}).get("operations") or []
    changed_lines = {
        str(line).strip()
        for operation in operations
        for key in ("before", "after")
        for line in (operation.get(key) or [])
        if str(line).strip()
    }
    if changed_lines:
        attributable = [
            target
            for target in targets
            if str(target.get("script_segment_source_text") or "").strip()
        ]
        if attributable:
            targets = [
                target
                for target in targets
                if not str(target.get("script_segment_source_text") or "").strip()
                or any(
                        line in str(target.get("script_segment_source_text") or "")
                        or str(target.get("script_segment_source_text") or "").strip() in line
                        for line in changed_lines
                    )
            ]
    events: list[Dict[str, Any]] = []
    detail = {
        "versionId": version_id,
        "previousVersionId": previous_version_id,
        "patchSummary": (patch or {}).get("summary") or {},
    }
    for target in targets:
        events.extend(await mark_storyboard_targets_stale(
            [target],
            slots=("keyframe", *audio_candidate_slots_for_target(target), "video"),
            source_entity_type="episode_script_version",
            source_entity_id=version_id,
            reason_code="script_version_confirmed",
            detail=detail,
            created_by=user_id,
            workflow_dao=workflow_dao,
        ))
    return events
