"""Project asset business logic."""
from __future__ import annotations

import logging
import json
from typing import Any, Dict, Iterable, Optional


class AssetServiceError(RuntimeError):
    pass


class AssetCreateFailed(AssetServiceError):
    pass


class AssetNotFound(AssetServiceError):
    pass


def _rows_to_dicts(rows: Iterable[Any]) -> list[Dict[str, Any]]:
    return [dict(row) for row in rows]


def _normalize_asset_name(name: Any) -> str:
    return " ".join(str(name or "").strip().lower().split())


def _safe_list(value: Any) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []
    return []


def _safe_dict(value: Any) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _file_url_key(entity_file: Dict[str, Any]) -> Optional[str]:
    for key in ("file_url", "file_path", "file_id"):
        value = entity_file.get(key)
        if value:
            return str(value)
    return None


def _asset_file_keys(files: list[Dict[str, Any]]) -> set[str]:
    return {key for key in (_file_url_key(entity_file) for entity_file in files) if key}


def _asset_has_design(asset: Dict[str, Any], files: list[Dict[str, Any]]) -> bool:
    return bool(
        asset.get("thumbnail_url")
        or _safe_list(asset.get("reference_images"))
        or any(_file_url_key(entity_file) for entity_file in files)
    )


def _asset_image_count(asset: Dict[str, Any], files: list[Dict[str, Any]]) -> int:
    keys = set()
    thumb = asset.get("thumbnail_url")
    if thumb:
        keys.add(str(thumb))
    keys.update(str(url) for url in _safe_list(asset.get("reference_images")) if url)
    keys.update(_asset_file_keys(files))
    return len(keys)


def _asset_preview_url(asset: Dict[str, Any], files: list[Dict[str, Any]]) -> Optional[str]:
    thumb = asset.get("thumbnail_url")
    if thumb:
        return str(thumb)
    for url in _safe_list(asset.get("reference_images")):
        if url:
            return str(url)
    for entity_file in files:
        value = entity_file.get("file_url") or entity_file.get("file_path")
        if value:
            return str(value)
    return None


def _asset_key(asset: Dict[str, Any]) -> tuple[str, str]:
    return (str(asset.get("asset_type") or ""), _normalize_asset_name(asset.get("name")))


def _dedupe_list(values: Iterable[Any]) -> list:
    result = []
    seen = set()
    for value in values:
        if value in (None, ""):
            continue
        key = json.dumps(value, ensure_ascii=False, sort_keys=True) if isinstance(value, (dict, list)) else str(value)
        if key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


def _episode_label(row: Dict[str, Any]) -> str:
    name = str(row.get("episode_name") or "").strip()
    if name:
        return name
    number = row.get("episode_number")
    if number not in (None, ""):
        return f"第{number}集"
    return str(row.get("episode_id") or "")


async def _build_episode_lookup(project_id: str, episode_dao: Any = None) -> dict[str, str]:
    if not episode_dao:
        return {}
    try:
        rows = await episode_dao.get_episodes(project_id)
    except Exception:
        return {}
    return {
        str(row.get("episode_id")): _episode_label(dict(row))
        for row in rows
        if row.get("episode_id")
    }


async def _copy_source_files_to_target(
    *,
    source: Dict[str, Any],
    target: Dict[str, Any],
    source_files: list[Dict[str, Any]],
    target_files: list[Dict[str, Any]],
    entity_file_dao: Any,
    logger: Optional[logging.Logger] = None,
) -> int:
    copied_files = 0
    target_keys = _asset_file_keys(target_files)
    target_keys.update(str(url) for url in _safe_list(target.get("reference_images")) if url)
    if target.get("thumbnail_url"):
        target_keys.add(str(target["thumbnail_url"]))

    for entity_file in source_files:
        source_key = _file_url_key(entity_file)
        if source_key and source_key in target_keys:
            continue
        try:
            copied = await entity_file_dao.copy_file(
                entity_file["file_id"],
                "asset",
                target["asset_id"],
                entity_file.get("file_role", "reference_image"),
            )
        except Exception as exc:
            if logger:
                logger.warning("同步已有设计文件失败: %s", exc)
            continue
        if copied:
            copied_files += 1
            copied_key = _file_url_key(copied)
            if copied_key:
                target_keys.add(copied_key)
    return copied_files


async def _merge_source_design_to_target(
    *,
    source: Dict[str, Any],
    target: Dict[str, Any],
    source_files: list[Dict[str, Any]],
    target_files: list[Dict[str, Any]],
    overwrite: bool,
    asset_dao: Any,
    entity_file_dao: Any,
    logger: Optional[logging.Logger] = None,
) -> tuple[Optional[Dict[str, Any]], int]:
    source_refs = _safe_list(source.get("reference_images"))
    target_refs = _safe_list(target.get("reference_images"))
    source_style = _safe_dict(source.get("style_params"))
    target_style = _safe_dict(target.get("style_params"))
    source_tags = _safe_list(source.get("tags"))
    target_tags = _safe_list(target.get("tags"))

    update_fields: Dict[str, Any] = {}
    source_thumb = source.get("thumbnail_url")
    if source_thumb and (overwrite or not target.get("thumbnail_url")):
        update_fields["thumbnail_url"] = source_thumb

    merged_refs = _dedupe_list([*([] if overwrite else target_refs), *source_refs])
    if merged_refs and (overwrite or merged_refs != target_refs):
        update_fields["reference_images"] = merged_refs

    if source_style and (overwrite or not target_style):
        update_fields["style_params"] = source_style
    if source_tags and (overwrite or not target_tags):
        update_fields["tags"] = source_tags
    if source.get("description") and (overwrite or not target.get("description")):
        update_fields["description"] = source.get("description")

    updated_asset = None
    if update_fields:
        updated = await asset_dao.update(target["asset_id"], **update_fields)
        if updated:
            updated_asset = dict(updated)
            target = {**target, **updated_asset}

    copied_files = await _copy_source_files_to_target(
        source=source,
        target=target,
        source_files=source_files,
        target_files=target_files,
        entity_file_dao=entity_file_dao,
        logger=logger,
    )
    return updated_asset, copied_files


async def list_assets(
    project_id: str,
    *,
    episode_id: Optional[str],
    asset_type: Optional[str],
    script_id: Optional[str],
    asset_dao: Any,
    entity_file_dao: Any,
) -> Dict[str, Any]:
    assets = await asset_dao.get_by_project(project_id, episode_id, asset_type, script_id=script_id)
    assets_list = _rows_to_dicts(assets)
    asset_ids = [asset["asset_id"] for asset in assets_list]

    files_map = {}
    if asset_ids:
        files_map = await entity_file_dao.get_files_for_entities("asset", asset_ids)

    for asset in assets_list:
        asset["entity_files"] = files_map.get(asset["asset_id"], [])

    return {"success": True, "assets": assets_list}


async def create_asset(
    *,
    project_id: str,
    asset_type: str,
    name: str,
    user_id: str,
    episode_id: Optional[str],
    script_id: Optional[str],
    description: Optional[str],
    reference_images: Optional[list],
    asset_dao: Any,
) -> Dict[str, Any]:
    asset = await asset_dao.create(
        project_id=project_id,
        asset_type=asset_type,
        name=name,
        created_by=user_id,
        episode_id=episode_id,
        description=description or "",
        reference_images=reference_images,
        script_id=script_id,
    )
    if not asset:
        raise AssetCreateFailed("Asset create failed")
    return {"success": True, "asset": dict(asset)}


async def list_sync_existing_design_candidates(
    *,
    project_id: str,
    episode_id: str,
    script_id: Optional[str],
    asset_types: Optional[list[str]],
    asset_dao: Any,
    entity_file_dao: Any,
    episode_dao: Any = None,
) -> Dict[str, Any]:
    allowed_types = {"character", "scene", "prop"}
    requested_types = set(asset_types or allowed_types) & allowed_types
    if not requested_types:
        requested_types = allowed_types

    target_rows = _rows_to_dicts(await asset_dao.get_by_project(project_id, episode_id, None, script_id=script_id))
    source_rows = _rows_to_dicts(await asset_dao.get_by_project(project_id, None, None, script_id=None))
    target_assets = [
        row
        for row in target_rows
        if row.get("episode_id") == episode_id
        and (script_id is None or row.get("script_id") == script_id)
        and row.get("asset_type") in requested_types
    ]
    source_assets = [
        row
        for row in source_rows
        if row.get("project_id") == project_id
        and row.get("episode_id")
        and row.get("episode_id") != episode_id
        and row.get("asset_type") in requested_types
    ]

    all_asset_ids = [asset["asset_id"] for asset in target_assets + source_assets if asset.get("asset_id")]
    files_map: dict[str, list[Dict[str, Any]]] = {}
    if all_asset_ids:
        files_map = await entity_file_dao.get_files_for_entities("asset", all_asset_ids)

    episode_lookup = await _build_episode_lookup(project_id, episode_dao)
    target_index = {_asset_key(asset): asset for asset in target_assets if _asset_key(asset)[1]}
    candidates: list[Dict[str, Any]] = []
    for asset in source_assets:
        key = _asset_key(asset)
        if not key[1]:
            continue
        files = files_map.get(asset["asset_id"], [])
        target = target_index.get(key)
        target_files = files_map.get(target["asset_id"], []) if target else []
        source_episode_id = asset.get("episode_id")
        candidates.append(
            {
                "asset_id": asset.get("asset_id"),
                "asset_type": asset.get("asset_type"),
                "name": asset.get("name") or "",
                "description": asset.get("description") or "",
                "source_episode_id": source_episode_id,
                "source_episode_label": episode_lookup.get(str(source_episode_id), str(source_episode_id or "")),
                "script_id": asset.get("script_id"),
                "thumbnail_url": asset.get("thumbnail_url"),
                "preview_url": _asset_preview_url(asset, files),
                "image_count": _asset_image_count(asset, files),
                "has_design": _asset_has_design(asset, files),
                "exists_in_target": target is not None,
                "target_asset_id": target.get("asset_id") if target else None,
                "target_has_design": _asset_has_design(target, target_files) if target else False,
                "created_at": asset.get("created_at"),
            }
        )

    candidates.sort(
        key=lambda item: (
            str(item.get("source_episode_label") or item.get("source_episode_id") or ""),
            str(item.get("asset_type") or ""),
            str(item.get("name") or ""),
        )
    )
    return {"success": True, "candidates": candidates, "candidate_count": len(candidates)}


async def update_asset(
    asset_id: str,
    fields: Dict[str, Any],
    *,
    asset_dao: Any,
) -> Dict[str, Any]:
    update_with_binding_rename = getattr(asset_dao, "update_with_binding_rename", None)
    if fields.get("name") is not None and callable(update_with_binding_rename):
        asset = await update_with_binding_rename(asset_id, **fields)
    else:
        asset = await asset_dao.update(asset_id, **fields)
    if not asset:
        raise AssetNotFound("Asset not found")
    return {"success": True, "asset": dict(asset)}


async def delete_asset(
    asset_id: str,
    *,
    asset_dao: Any,
) -> Dict[str, Any]:
    ok = await asset_dao.delete(asset_id)
    if not ok:
        raise AssetNotFound("Asset not found")
    return {"success": True}


async def sync_existing_designs(
    *,
    project_id: str,
    episode_id: str,
    script_id: Optional[str],
    asset_types: Optional[list[str]],
    overwrite: bool,
    source_asset_ids: Optional[list[str]] = None,
    user_id: Optional[str] = None,
    asset_dao: Any,
    entity_file_dao: Any,
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    allowed_types = {"character", "scene", "prop"}
    requested_types = set(asset_types or allowed_types) & allowed_types
    if not requested_types:
        requested_types = allowed_types

    target_rows = _rows_to_dicts(await asset_dao.get_by_project(project_id, episode_id, None, script_id=script_id))
    source_rows = _rows_to_dicts(await asset_dao.get_by_project(project_id, None, None, script_id=None))
    target_assets = [
        row
        for row in target_rows
        if row.get("episode_id") == episode_id
        and (script_id is None or row.get("script_id") == script_id)
        and row.get("asset_type") in requested_types
    ]
    source_assets = [
        row
        for row in source_rows
        if row.get("project_id") == project_id
        and row.get("episode_id") != episode_id
        and row.get("asset_type") in requested_types
    ]

    if source_asset_ids is not None:
        selected_ids = [str(asset_id) for asset_id in _dedupe_list(source_asset_ids)]
        source_by_id = {str(row.get("asset_id")): row for row in source_assets if row.get("asset_id")}
        selected_sources = [source_by_id[asset_id] for asset_id in selected_ids if asset_id in source_by_id]
        skipped_not_found = len(selected_ids) - len(selected_sources)

        all_asset_ids = [asset["asset_id"] for asset in target_assets + selected_sources if asset.get("asset_id")]
        files_map: dict[str, list[Dict[str, Any]]] = {}
        if all_asset_ids:
            files_map = await entity_file_dao.get_files_for_entities("asset", all_asset_ids)

        target_index = {_asset_key(asset): asset for asset in target_assets if _asset_key(asset)[1]}
        created_assets: list[Dict[str, Any]] = []
        updated_assets: list[Dict[str, Any]] = []
        copied_files = 0
        skipped_existing = 0
        skipped_no_name = 0

        for source in selected_sources:
            source_key = _asset_key(source)
            if not source_key[1]:
                skipped_no_name += 1
                continue

            source_files = files_map.get(source["asset_id"], [])
            target = target_index.get(source_key)
            if target:
                target_files = files_map.get(target["asset_id"], [])
                if not overwrite and _asset_has_design(target, target_files):
                    skipped_existing += 1
                    continue
                updated, copied = await _merge_source_design_to_target(
                    source=source,
                    target=target,
                    source_files=source_files,
                    target_files=target_files,
                    overwrite=overwrite,
                    asset_dao=asset_dao,
                    entity_file_dao=entity_file_dao,
                    logger=logger,
                )
                if updated:
                    updated_assets.append(updated)
                    target_index[source_key] = {**target, **updated}
                copied_files += copied
                continue

            created = await asset_dao.copy_to(
                asset_id=source["asset_id"],
                target_episode_id=episode_id,
                target_script_id=script_id,
                created_by=user_id or source.get("created_by") or "system",
            )
            if not created:
                skipped_not_found += 1
                continue
            created_asset = dict(created)
            created_assets.append(created_asset)
            target_index[source_key] = created_asset
            copied_files += await _copy_source_files_to_target(
                source=source,
                target=created_asset,
                source_files=source_files,
                target_files=[],
                entity_file_dao=entity_file_dao,
                logger=logger,
            )

        return {
            "success": True,
            "matched": len(selected_sources),
            "synced": len(created_assets) + len(updated_assets),
            "created": len(created_assets),
            "updated": len(updated_assets),
            "copied_files": copied_files,
            "skipped_existing": skipped_existing,
            "skipped_no_match": skipped_not_found,
            "skipped_no_name": skipped_no_name,
            "created_assets": created_assets,
            "updated_assets": updated_assets,
        }

    all_asset_ids = [asset["asset_id"] for asset in target_assets + source_assets if asset.get("asset_id")]
    files_map: dict[str, list[Dict[str, Any]]] = {}
    if all_asset_ids:
        files_map = await entity_file_dao.get_files_for_entities("asset", all_asset_ids)

    source_index: dict[tuple[str, str], list[Dict[str, Any]]] = {}
    for asset in source_assets:
        key = _asset_key(asset)
        if not key[1]:
            continue
        files = files_map.get(asset["asset_id"], [])
        if not _asset_has_design(asset, files):
            continue
        source_index.setdefault(key, []).append(asset)

    synced = 0
    matched = 0
    copied_files = 0
    skipped_existing = 0
    skipped_no_match = 0
    updated_assets: list[Dict[str, Any]] = []

    for target in target_assets:
        target_key = _asset_key(target)
        if not target_key[1]:
            continue

        target_files = files_map.get(target["asset_id"], [])
        if not overwrite and _asset_has_design(target, target_files):
            skipped_existing += 1
            continue

        source = next(
            (
                item
                for item in source_index.get(target_key, [])
                if item.get("asset_id") != target.get("asset_id")
            ),
            None,
        )
        if not source:
            skipped_no_match += 1
            continue

        matched += 1
        source_files = files_map.get(source["asset_id"], [])
        source_refs = _safe_list(source.get("reference_images"))
        target_refs = _safe_list(target.get("reference_images"))
        source_style = _safe_dict(source.get("style_params"))
        target_style = _safe_dict(target.get("style_params"))
        source_tags = _safe_list(source.get("tags"))
        target_tags = _safe_list(target.get("tags"))

        update_fields: Dict[str, Any] = {}
        source_thumb = source.get("thumbnail_url")
        if source_thumb and (overwrite or not target.get("thumbnail_url")):
            update_fields["thumbnail_url"] = source_thumb

        merged_refs = _dedupe_list([*([] if overwrite else target_refs), *source_refs])
        if merged_refs and (overwrite or merged_refs != target_refs):
            update_fields["reference_images"] = merged_refs

        if source_style and (overwrite or not target_style):
            update_fields["style_params"] = source_style
        if source_tags and (overwrite or not target_tags):
            update_fields["tags"] = source_tags
        if source.get("description") and (overwrite or not target.get("description")):
            update_fields["description"] = source.get("description")

        if update_fields:
            updated = await asset_dao.update(target["asset_id"], **update_fields)
            if updated:
                updated_assets.append(dict(updated))

        target_keys = _asset_file_keys(target_files)
        target_keys.update(str(url) for url in target_refs if url)
        if source_thumb:
            target_keys.add(str(source_thumb))
        target_keys.update(str(url) for url in source_refs if url and url in target_refs)

        for entity_file in source_files:
            source_key = _file_url_key(entity_file)
            if source_key and source_key in target_keys:
                continue
            try:
                copied = await entity_file_dao.copy_file(
                    entity_file["file_id"],
                    "asset",
                    target["asset_id"],
                    entity_file.get("file_role", "reference_image"),
                )
            except Exception as exc:
                if logger:
                    logger.warning("同步已有设计文件失败: %s", exc)
                continue
            if copied:
                copied_files += 1
                copied_key = _file_url_key(copied)
                if copied_key:
                    target_keys.add(copied_key)

        synced += 1

    return {
        "success": True,
        "matched": matched,
        "synced": synced,
        "copied_files": copied_files,
        "skipped_existing": skipped_existing,
        "skipped_no_match": skipped_no_match,
        "updated_assets": updated_assets,
    }


async def share_asset(
    asset_id: str,
    *,
    target_episode_id: str,
    target_script_id: str,
    user_id: str,
    asset_dao: Any,
    entity_file_dao: Any,
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    new_asset = await asset_dao.copy_to(
        asset_id=asset_id,
        target_episode_id=target_episode_id,
        target_script_id=target_script_id,
        created_by=user_id,
    )
    if not new_asset:
        raise AssetNotFound("Source asset not found")

    copied_files = []
    try:
        source_files = await entity_file_dao.get_entity_files("asset", asset_id)
        for entity_file in source_files.get("items", []):
            copied = await entity_file_dao.copy_file(
                entity_file["file_id"],
                "asset",
                new_asset["asset_id"],
                entity_file.get("file_role", "reference_image"),
            )
            if copied:
                copied_files.append(copied)
    except Exception as exc:
        if logger:
            logger.warning("复制资产关联文件失败: %s", exc)

    return {"success": True, "asset": dict(new_asset), "copied_files": len(copied_files)}
