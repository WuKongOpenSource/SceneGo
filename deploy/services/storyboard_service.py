"""Storyboard item, export, asset extraction, and audio mix business logic."""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Dict, Iterable, Optional

from services.project_access_service import ProjectAccessDenied


SUPPORTED_STORYBOARD_FIELDS = {"audio", "video", "audio_stage", "materials"}

SYNC_UPDATE_FIELDS = (
    ("dialogue", ("dialogue",)),
    ("dialogue_audio_url", ("dialogue_audio_url", "dialogueAudioUrl")),
    ("narration_audio_url", ("narration_audio_url", "narrationAudioUrl")),
    ("sfx_audio_url", ("sfx_audio_url", "sfxAudioUrl")),
    ("audio_duration_ms", ("audio_duration_ms", "audioDurationMs")),
    ("planned_duration_ms", ("planned_duration_ms", "plannedDurationMs")),
    ("audio_segments", ("audio_segments", "audioSegments")),
    ("bound_assets", ("bound_assets", "boundAssets")),
    ("configured_references", ("configured_references", "configuredReferences")),
    ("reference_config_initialized", ("reference_config_initialized", "referenceConfigInitialized")),
)
AUDIO_URL_FIELDS = {"dialogue_audio_url", "narration_audio_url", "sfx_audio_url"}


class StoryboardServiceError(RuntimeError):
    pass


class UnsupportedStoryboardFields(StoryboardServiceError):
    pass


class StoryboardItemNotFound(StoryboardServiceError):
    pass


class StoryboardCreateFailed(StoryboardServiceError):
    pass


class StoryboardReorderFailed(StoryboardServiceError):
    pass


class EpisodeNotFound(StoryboardServiceError):
    pass


class StoryboardScriptNotFound(StoryboardServiceError):
    pass


def _row_to_dict(row: Any) -> Optional[Dict[str, Any]]:
    return dict(row) if row is not None else None


def _rows_to_dicts(rows: Iterable[Any]) -> list[Dict[str, Any]]:
    return [_normalize_bound_assets(dict(row)) for row in rows]


def _stable_value(value: Any) -> str:
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith(("[", "{")):
            try:
                value = json.loads(stripped)
            except (TypeError, ValueError):
                pass
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


async def require_storyboard_episode_access(
    episode_id: str,
    identity: str,
    role: str,
    *,
    episode_dao: Any,
    project_access_checker: Any,
) -> str:
    project_id = await episode_dao.get_project_id(episode_id)
    if not project_id:
        raise EpisodeNotFound("Episode not found")
    try:
        await project_access_checker(project_id, identity, role)
    except ProjectAccessDenied as exc:
        raise EpisodeNotFound("Episode not found") from exc
    return str(project_id)


async def require_storyboard_item_access(
    item_id: str,
    identity: str,
    role: str,
    *,
    storyboard_dao: Any,
    episode_dao: Any,
    project_access_checker: Any,
) -> Dict[str, Any]:
    item = await storyboard_dao.get_by_id(item_id)
    if not item:
        raise StoryboardItemNotFound("Storyboard item not found")
    await require_storyboard_episode_access(
        str(item["episode_id"]),
        identity,
        role,
        episode_dao=episode_dao,
        project_access_checker=project_access_checker,
    )
    return dict(item)


async def require_storyboard_script(
    episode_id: str,
    script_id: Optional[str],
    *,
    episode_script_dao: Any,
) -> None:
    if not script_id:
        return
    script = await episode_script_dao.get_by_id(script_id)
    if not script or str(script.get("episode_id") or "") != episode_id:
        raise StoryboardScriptNotFound("Script not found for this episode")


def normalize_storyboard_fields(fields: Optional[str]) -> Optional[str]:
    selected_fields = (fields or "").strip().lower() or None
    if selected_fields and selected_fields not in SUPPORTED_STORYBOARD_FIELDS:
        raise UnsupportedStoryboardFields(f"unsupported storyboard fields: {selected_fields}")
    return selected_fields


def _normalize_bound_assets(item: Dict[str, Any]) -> Dict[str, Any]:
    for field in ("bound_assets", "configured_references", "audio_segments"):
        if isinstance(item.get(field), str):
            try:
                parsed = json.loads(item[field]) if item[field] else []
                item[field] = parsed if isinstance(parsed, list) else []
            except Exception:
                item[field] = []
    return item


def _value_for_keys(data: Dict[str, Any], *keys: str) -> tuple[bool, Any]:
    for key in keys:
        if key in data:
            return True, data[key]
    return False, None


def _row_value(row: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row:
            return row[key]
    return None


def _json_list_value(value: Any) -> list[Any]:
    if isinstance(value, str):
        try:
            parsed = json.loads(value) if value else []
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []
    return value if isinstance(value, list) else []


def _comparable_storyboard_value(field: str, value: Any) -> Any:
    if field in {"bound_assets", "configured_references", "audio_segments"}:
        return _json_list_value(value)
    if field in AUDIO_URL_FIELDS:
        return value or None
    return value


def _int_or_none(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _match_storyboard_item(
    item: Dict[str, Any],
    *,
    by_item_id: Dict[str, Dict[str, Any]],
    by_segment: Dict[tuple[str, str], Dict[str, Any]],
    by_sort_order: Dict[int, list[Dict[str, Any]]],
    used_item_ids: set[str],
) -> Optional[Dict[str, Any]]:
    _, item_id = _value_for_keys(item, "item_id", "itemId")
    if item_id:
        row = by_item_id.get(str(item_id))
        if row and str(_row_value(row, "item_id", "itemId")) not in used_item_ids:
            return row

    _, segment_id = _value_for_keys(item, "script_segment_id", "scriptSegmentId")
    _, source_shot_no = _value_for_keys(item, "source_video_shot_no", "sourceVideoShotNo")
    if segment_id and source_shot_no:
        row = by_segment.get((str(segment_id), str(source_shot_no)))
        if row and str(_row_value(row, "item_id", "itemId")) not in used_item_ids:
            return row

    present_sort_order, sort_order = _value_for_keys(item, "sort_order", "sortOrder")
    if present_sort_order:
        sort_order_int = _int_or_none(sort_order)
        if sort_order_int is None:
            return None
        for row in by_sort_order.get(sort_order_int, []):
            row_id = str(_row_value(row, "item_id", "itemId"))
            if row_id not in used_item_ids:
                return row
    return None


def _sync_update_fields(item: Dict[str, Any], row: Dict[str, Any]) -> Dict[str, Any]:
    updates: Dict[str, Any] = {}
    audio_changed = False
    for field, keys in SYNC_UPDATE_FIELDS:
        present, incoming = _value_for_keys(item, *keys)
        if not present:
            continue
        current = _row_value(row, field)
        incoming_cmp = _comparable_storyboard_value(field, incoming)
        current_cmp = _comparable_storyboard_value(field, current)
        if incoming_cmp == current_cmp:
            continue
        updates[field] = incoming_cmp if field in {"bound_assets", "configured_references", "audio_segments"} or field in AUDIO_URL_FIELDS else incoming
        if field in AUDIO_URL_FIELDS:
            audio_changed = True
    if audio_changed:
        updates["mixed_audio_url"] = None
        updates["mixed_audio_hash"] = None
    return updates


def _creation_kwargs_from_sync_item(
    episode_id: str,
    item: Dict[str, Any],
    script_id: Optional[str],
) -> Dict[str, Any]:
    def value(default: Any, *keys: str) -> Any:
        present, found = _value_for_keys(item, *keys)
        return found if present else default

    return {
        "episode_id": episode_id,
        "sort_order": _int_or_none(value(0, "sort_order", "sortOrder")) or 0,
        "scene_heading": value("", "scene_heading", "sceneHeading"),
        "action_text": value("", "action_text", "actionText"),
        "dialogue": value("", "dialogue"),
        "camera_movement": value("", "camera_movement", "cameraMovement"),
        "image_prompt": value("", "image_prompt", "imagePrompt"),
        "video_prompt": value("", "video_prompt", "videoPrompt"),
        "bound_assets": _json_list_value(value([], "bound_assets", "boundAssets")),
        "configured_references": _json_list_value(
            value([], "configured_references", "configuredReferences")
        ),
        "reference_config_initialized": bool(
            value(False, "reference_config_initialized", "referenceConfigInitialized")
        ),
        "script_id": script_id or value(None, "script_id", "scriptId"),
        "script_segment_id": value(None, "script_segment_id", "scriptSegmentId"),
        "source_video_shot_no": value("", "source_video_shot_no", "sourceVideoShotNo"),
        "video_script_block": value("", "video_script_block", "videoScriptBlock"),
        "shot_size": value("", "shot_size", "shotSize"),
        "camera_angle": value("", "camera_angle", "cameraAngle"),
        "planned_duration_ms": _int_or_none(value(None, "planned_duration_ms", "plannedDurationMs")),
    }


def _audio_update_fields_from_sync_item(item: Dict[str, Any]) -> Dict[str, Any]:
    updates: Dict[str, Any] = {}
    audio_changed = False
    for field, keys in SYNC_UPDATE_FIELDS:
        if field not in AUDIO_URL_FIELDS and field not in {"audio_duration_ms", "audio_segments"}:
            continue
        present, incoming = _value_for_keys(item, *keys)
        if not present:
            continue
        updates[field] = (
            (incoming or None)
            if field in AUDIO_URL_FIELDS
            else _json_list_value(incoming)
            if field == "audio_segments"
            else incoming
        )
        if field in AUDIO_URL_FIELDS:
            audio_changed = True
    if audio_changed:
        updates["mixed_audio_url"] = None
        updates["mixed_audio_hash"] = None
    return updates


async def get_storyboard_items(
    episode_id: str,
    *,
    script_id: Optional[str],
    limit: Optional[int],
    offset: int,
    include_total: bool,
    fields: Optional[str],
    storyboard_dao: Any,
    episode_script_dao: Any,
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    selected_fields = normalize_storyboard_fields(fields)
    items = await storyboard_dao.get_by_episode(
        episode_id,
        script_id=script_id,
        limit=limit,
        offset=offset,
        fields=selected_fields,
    )
    fallback_script_id: Optional[str] = None
    fallback_reason: Optional[str] = None
    fallback_total: Optional[int] = None
    requested_script_total: Optional[int] = None

    if script_id:
        try:
            script = await episode_script_dao.get_by_id(script_id)
            script_belongs_to_episode = bool(script and script.get("episode_id") == episode_id)
        except Exception as exc:
            if logger:
                logger.warning(
                    "get_storyboard_items: script ownership check failed ep=%s script=%s: %s",
                    episode_id,
                    script_id,
                    exc,
                )
            script_belongs_to_episode = True

        if not script_belongs_to_episode:
            requested_script_total = await storyboard_dao.count_by_episode(episode_id, script_id=script_id)
            fallback_total = await storyboard_dao.count_by_episode(episode_id, script_id=None)
            should_fallback = fallback_total > requested_script_total
        else:
            should_fallback = False

        if should_fallback:
            fallback_items = await storyboard_dao.get_by_episode(
                episode_id,
                script_id=None,
                limit=limit,
                offset=offset,
                fields=selected_fields,
            )
            if fallback_items:
                items = fallback_items
                fallback_script_id = script_id
                fallback_reason = "stale_script_storyboard"

    result = [_normalize_bound_assets(dict(item)) for item in items]
    payload: Dict[str, Any] = {"success": True, "items": result}
    if fallback_script_id:
        payload["fallback_script_id"] = fallback_script_id
        payload["fallback_reason"] = fallback_reason
        payload["fallback_scope"] = "episode"
    if include_total:
        if fallback_script_id and fallback_total is not None:
            total = fallback_total
        elif script_id and requested_script_total is not None:
            total = requested_script_total
        else:
            total = await storyboard_dao.count_by_episode(
                episode_id,
                script_id=None if fallback_script_id else script_id,
            )
        payload["total"] = total
        payload["limit"] = limit
        payload["offset"] = max(0, int(offset or 0))
    return payload


async def create_storyboard_item(
    episode_id: str,
    *,
    sort_order: int,
    scene_heading: Optional[str],
    dialogue: Optional[str],
    action_text: Optional[str],
    camera_movement: Optional[str],
    image_prompt: Optional[str],
    video_prompt: Optional[str],
    configured_references: Optional[list] = None,
    reference_config_initialized: bool = False,
    script_id: Optional[str],
    storyboard_dao: Any,
    episode_script_dao: Any,
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    resolved_script_id = script_id
    if not resolved_script_id:
        try:
            scripts = await episode_script_dao.list_by_episode(episode_id)
            if scripts:
                resolved_script_id = scripts[-1].get("script_id")
        except Exception as exc:
            if logger:
                logger.warning("create_storyboard_item: fallback script_id failed ep=%s: %s", episode_id, exc)

    item = await storyboard_dao.create(
        episode_id=episode_id,
        sort_order=sort_order,
        scene_heading=scene_heading,
        dialogue=dialogue,
        action_text=action_text,
        camera_movement=camera_movement,
        image_prompt=image_prompt,
        video_prompt=video_prompt,
        configured_references=configured_references,
        reference_config_initialized=reference_config_initialized,
        script_id=resolved_script_id,
    )
    if not item:
        raise StoryboardCreateFailed("Storyboard create failed")
    return {"success": True, "item": _normalize_bound_assets(dict(item))}


async def update_storyboard_item(
    item_id: str,
    fields: Dict[str, Any],
    *,
    storyboard_dao: Any,
    content_workflow_dao: Any = None,
    updated_by: Optional[str] = None,
) -> Dict[str, Any]:
    if any(field in fields for field in AUDIO_URL_FIELDS):
        fields = {
            **fields,
            "mixed_audio_url": None,
            "mixed_audio_hash": None,
        }
    previous = None
    get_by_id = getattr(storyboard_dao, "get_by_id", None)
    if callable(get_by_id):
        previous_row = await get_by_id(item_id)
        previous = dict(previous_row) if previous_row else None
    item = await storyboard_dao.update(item_id, **fields)
    if not item:
        raise StoryboardItemNotFound("Storyboard item not found")
    stale_events = []
    if content_workflow_dao is not None:
        changed_fields = sorted(
            field
            for field, value in fields.items()
            if previous is None or _stable_value(previous.get(field)) != _stable_value(value)
        )
        keyframe_fields = {
            "scene_heading", "action_text", "image_prompt", "bound_assets",
            "configured_references", "shot_size", "camera_angle",
        }
        video_fields = keyframe_fields | {
            "video_prompt", "camera_movement", "planned_duration_ms",
        }
        audio_fields = {"dialogue"}
        slots: list[str] = []
        if set(changed_fields) & keyframe_fields:
            slots.append("keyframe")
        if set(changed_fields) & audio_fields:
            slots.append("dialogue_audio")
        if set(changed_fields) & (video_fields | audio_fields):
            slots.append("video")
        if slots:
            from services.content_workflow_service import (
                audio_candidate_slots_for_target,
                mark_storyboard_targets_stale,
            )

            targets = await content_workflow_dao.list_storyboard_targets(storyboard_item_id=item_id)
            value_fingerprint = hashlib.sha256(
                json.dumps(
                    {
                        "before": {field: previous.get(field) for field in changed_fields} if previous else {},
                        "after": {field: fields.get(field) for field in changed_fields},
                        "updatedAt": item.get("updated_at") if hasattr(item, "get") else None,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                    default=str,
                ).encode("utf-8")
            ).hexdigest()
            for target in targets:
                target_slots = [slot for slot in slots if slot != "dialogue_audio"]
                if "dialogue_audio" in slots:
                    target_slots.extend(audio_candidate_slots_for_target(target))
                stale_events.extend(await mark_storyboard_targets_stale(
                    [target],
                    slots=target_slots,
                    source_entity_type="storyboard_item",
                    source_entity_id=item_id,
                    reason_code="storyboard_content_changed",
                    detail={"fields": changed_fields, "changeId": value_fingerprint},
                    created_by=updated_by,
                    workflow_dao=content_workflow_dao,
                ))
    return {
        "success": True,
        "item": _normalize_bound_assets(dict(item)),
        "stale_events": stale_events,
    }


async def delete_storyboard_item(
    item_id: str,
    *,
    storyboard_dao: Any,
) -> Dict[str, Any]:
    ok = await storyboard_dao.delete(item_id)
    if not ok:
        raise StoryboardItemNotFound("Storyboard item not found")
    return {"success": True}


async def delete_all_storyboard_items(
    episode_id: str,
    *,
    script_id: Optional[str],
    storyboard_dao: Any,
) -> Dict[str, Any]:
    count = await storyboard_dao.delete_by_episode(episode_id, script_id=script_id)
    return {"success": True, "deleted": count}


async def export_script(
    episode_id: str,
    *,
    project_id: str,
    original_content: str,
    script_content: str,
    storyboard_items: list[dict],
    characters: list[dict],
    scenes: list[dict],
    props: list[dict] | None = None,
    script_id: Optional[str],
    user_id: str,
    storyboard_dao: Any,
    episode_script_dao: Any,
    asset_dao: Any,
    preserve_existing_storyboards: bool = False,
) -> Dict[str, Any]:
    created = await storyboard_dao.export_script_transaction(
        episode_script_dao=episode_script_dao,
        asset_dao=asset_dao,
        episode_id=episode_id,
        project_id=project_id,
        original_content=original_content,
        script_content=script_content,
        storyboard_items=storyboard_items,
        characters=characters,
        scenes=scenes,
        props=props or [],
        script_id=script_id,
        preserve_existing_storyboards=preserve_existing_storyboards,
        created_by=user_id,
    )
    return {
        "success": True,
        "storyboard_items_created": created,
        "characters_count": len(characters),
        "scenes_count": len(scenes),
        "props_count": len(props or []),
    }


async def reorder_storyboard_items(
    episode_id: str,
    item_ids: list[str],
    *,
    storyboard_dao: Any,
) -> Dict[str, Any]:
    ok = await storyboard_dao.reorder(episode_id, item_ids)
    if not ok:
        raise StoryboardReorderFailed("Storyboard reorder failed")
    return {"success": True}


async def mix_storyboard_audio(
    *,
    item_id: str,
    dialogue_url: Optional[str],
    narration_url: Optional[str],
    sfx_url: Optional[str],
    dialogue_gain_db: float,
    narration_gain_db: float,
    sfx_gain_db: float,
    user_id: str,
    audio_mixer: Optional[Any] = None,
    mix_input_cls: Optional[Any] = None,
) -> Dict[str, Any]:
    if not (dialogue_url or narration_url or sfx_url):
        raise ValueError("at least one of dialogue/narration/sfx url is required")

    if audio_mixer is None or mix_input_cls is None:
        from audio_mix_service import MixInput, mix_storyboard_audio as default_audio_mixer

        audio_mixer = audio_mixer or default_audio_mixer
        mix_input_cls = mix_input_cls or MixInput

    result = await audio_mixer(
        item_id,
        mix_input_cls(
            dialogue_url=dialogue_url,
            narration_url=narration_url,
            sfx_url=sfx_url,
            dialogue_gain_db=dialogue_gain_db,
            narration_gain_db=narration_gain_db,
            sfx_gain_db=sfx_gain_db,
        ),
        user_id=user_id,
    )
    return {
        "success": result.success,
        "mixed_audio_url": result.mixed_audio_url,
        "cached": result.cached,
        "duration_ms": result.duration_ms,
    }


async def batch_create_storyboard_items(
    episode_id: str,
    *,
    items: list,
    script_id: Optional[str],
    storyboard_dao: Any,
) -> Dict[str, Any]:
    created = await storyboard_dao.replace_batch(episode_id, items, script_id=script_id)
    return {"success": True, "items": _rows_to_dicts(created)}


async def sync_storyboard_items(
    episode_id: str,
    *,
    items: list[dict],
    script_id: Optional[str],
    storyboard_dao: Any,
) -> Dict[str, Any]:
    existing_rows = _rows_to_dicts(
        await storyboard_dao.get_by_episode(episode_id, script_id=script_id)
    )
    by_item_id: Dict[str, Dict[str, Any]] = {}
    by_segment: Dict[tuple[str, str], Dict[str, Any]] = {}
    by_sort_order: Dict[int, list[Dict[str, Any]]] = {}

    for row in existing_rows:
        item_id = _row_value(row, "item_id", "itemId")
        if item_id:
            by_item_id[str(item_id)] = row
        segment_id = _row_value(row, "script_segment_id", "scriptSegmentId")
        source_shot_no = _row_value(row, "source_video_shot_no", "sourceVideoShotNo")
        if segment_id and source_shot_no:
            by_segment[(str(segment_id), str(source_shot_no))] = row
        sort_order = _int_or_none(_row_value(row, "sort_order", "sortOrder"))
        if sort_order is not None:
            by_sort_order.setdefault(sort_order, []).append(row)

    created_count = 0
    updated_count = 0
    skipped_count = 0
    synced_items: list[Dict[str, Any]] = []
    used_item_ids: set[str] = set()

    for raw_item in items:
        item = dict(raw_item or {})
        matched = _match_storyboard_item(
            item,
            by_item_id=by_item_id,
            by_segment=by_segment,
            by_sort_order=by_sort_order,
            used_item_ids=used_item_ids,
        )

        if matched:
            matched_id = str(_row_value(matched, "item_id", "itemId"))
            used_item_ids.add(matched_id)
            updates = _sync_update_fields(item, matched)
            if updates:
                updated = await storyboard_dao.update(matched_id, **updates)
                synced_items.append(dict(updated) if updated else {**matched, **updates})
                updated_count += 1
            else:
                synced_items.append(matched)
                skipped_count += 1
            continue

        created = await storyboard_dao.create(**_creation_kwargs_from_sync_item(episode_id, item, script_id))
        if not created:
            continue
        created_count += 1
        created_row = dict(created)
        created_id = _row_value(created_row, "item_id", "itemId")
        audio_updates = _audio_update_fields_from_sync_item(item)
        if created_id and audio_updates:
            updated = await storyboard_dao.update(str(created_id), **audio_updates)
            if updated:
                created_row = dict(updated)
        synced_items.append(created_row)

    return {
        "success": True,
        "created": created_count,
        "updated": updated_count,
        "skipped": skipped_count,
        "items": synced_items,
    }


async def extract_to_assets(
    episode_id: str,
    *,
    characters: list,
    scenes: list,
    props: list | None = None,
    script_id: Optional[str],
    user_id: str,
    episode_dao: Any,
    asset_dao: Any,
) -> Dict[str, Any]:
    episode = await episode_dao.get_episode(episode_id)
    if not episode:
        raise EpisodeNotFound("Episode not found")
    project_id = str(episode["project_id"])

    existing_assets = await asset_dao.get_by_project(project_id, episode_id, script_id=script_id)
    existing_names = {(asset["asset_type"], asset["name"]) for asset in existing_assets}

    created = []
    for asset_type, rows in (("character", characters), ("scene", scenes), ("prop", props or [])):
        for row in rows:
            name = row.get("name", "").strip()
            if not name or (asset_type, name) in existing_names:
                continue
            asset = await asset_dao.create(
                project_id=project_id,
                asset_type=asset_type,
                name=name,
                created_by=user_id,
                episode_id=episode_id,
                description=row.get("description", ""),
                script_id=script_id,
            )
            if asset:
                created.append(dict(asset))
                existing_names.add((asset_type, name))
    return {"success": True, "assets": created}
