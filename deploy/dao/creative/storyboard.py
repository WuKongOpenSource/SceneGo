


import uuid
import json
from typing import List, Dict, Any, Optional

from db_manager import get_db_manager


def _int_or_none(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


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
        except (TypeError, ValueError):
            return []
    return value if isinstance(value, list) else []


def _reference_config_initialized(
    configured_references: Any,
    initialized: Any = False,
) -> bool:
    return bool(initialized or _json_list_value(configured_references))


def _prepare_storyboard_items_for_export(
    existing_rows: List[Dict[str, Any]],
    storyboard_items: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Preserve storyboard ids so generated files stay attached after re-export."""
    by_item_id: Dict[str, Dict[str, Any]] = {}
    by_segment: Dict[tuple[str, str], Dict[str, Any]] = {}
    by_sort_order: Dict[int, List[Dict[str, Any]]] = {}

    for raw_row in existing_rows:
        row = dict(raw_row or {})
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

    prepared: List[Dict[str, Any]] = []
    used_item_ids: set[str] = set()

    for raw_item in storyboard_items:
        item = dict(raw_item or {})
        matched: Optional[Dict[str, Any]] = None

        incoming_id = _row_value(item, "item_id", "itemId")
        if incoming_id:
            row = by_item_id.get(str(incoming_id))
            if row and str(_row_value(row, "item_id", "itemId")) not in used_item_ids:
                matched = row

        if matched is None:
            segment_id = _row_value(item, "script_segment_id", "scriptSegmentId")
            source_shot_no = _row_value(item, "source_video_shot_no", "sourceVideoShotNo")
            if segment_id and source_shot_no:
                row = by_segment.get((str(segment_id), str(source_shot_no)))
                if row and str(_row_value(row, "item_id", "itemId")) not in used_item_ids:
                    matched = row

        if matched is None:
            sort_order = _int_or_none(_row_value(item, "sort_order", "sortOrder"))
            if sort_order is not None:
                for row in by_sort_order.get(sort_order, []):
                    row_id = str(_row_value(row, "item_id", "itemId"))
                    if row_id not in used_item_ids:
                        matched = row
                        break

        if matched:
            matched_id = str(_row_value(matched, "item_id", "itemId"))
            used_item_ids.add(matched_id)
            item["_preserved_item_id"] = matched_id
            if not item.get("generated_image_url") and not item.get("generatedImageUrl"):
                generated_image_url = _row_value(matched, "generated_image_url", "generatedImageUrl")
                if generated_image_url:
                    item["generated_image_url"] = generated_image_url
            if "configured_references" not in item and "configuredReferences" not in item:
                configured_references = _row_value(
                    matched,
                    "configured_references",
                    "configuredReferences",
                )
                if configured_references is not None:
                    item["configured_references"] = _json_list_value(configured_references)
            if (
                "reference_config_initialized" not in item
                and "referenceConfigInitialized" not in item
            ):
                initialized = _row_value(
                    matched,
                    "reference_config_initialized",
                    "referenceConfigInitialized",
                )
                if initialized is not None:
                    item["reference_config_initialized"] = bool(initialized)

        prepared.append(item)

    return prepared


class StoryboardDAO:
    FIELD_SETS = {
        "audio": (
            "item_id",
            "lineage_id",
            "episode_id",
            "script_id",
            "sort_order",
            "script_segment_id",
            "source_video_shot_no",
            "dialogue",
            "generated_image_url",
            "dialogue_audio_url",
            "narration_audio_url",
            "sfx_audio_url",
            "mixed_audio_url",
            "audio_duration_ms",
            "planned_duration_ms",
            "audio_segments",
            "video_script_block",
            "status",
        ),
        "video": (
            "item_id",
            "lineage_id",
            "episode_id",
            "script_id",
            "sort_order",
            "script_segment_id",
            "source_video_shot_no",
            "video_script_block",
            "action_text",
            "dialogue",
            "image_prompt",
            "video_prompt",
            "generated_image_url",
            "audio_duration_ms",
            "planned_duration_ms",
            "audio_segments",
            "status",
        ),
        "audio_stage": (
            "item_id",
            "lineage_id",
            "episode_id",
            "script_id",
            "sort_order",
            "script_segment_id",
            "source_video_shot_no",
            "video_script_block",
            "scene_heading",
            "action_text",
            "dialogue",
            "camera_movement",
            "image_prompt",
            "video_prompt",
            "bound_assets",
            "dialogue_audio_url",
            "narration_audio_url",
            "sfx_audio_url",
            "mixed_audio_url",
            "audio_duration_ms",
            "planned_duration_ms",
            "audio_segments",
            "status",
        ),
        "materials": (
            "item_id",
            "lineage_id",
            "episode_id",
            "script_id",
            "sort_order",
            "script_segment_id",
            "source_video_shot_no",
            "scene_heading",
            "action_text",
            "dialogue",
            "camera_movement",
            "image_prompt",
            "video_prompt",
            "generated_image_url",
            "bound_assets",
            "configured_references",
            "reference_config_initialized",
            "planned_duration_ms",
            "video_script_block",
            "status",
        ),
    }

    @staticmethod
    def _select_columns(fields: Optional[str] = None) -> str:
        if not fields:
            return "*"
        columns = StoryboardDAO.FIELD_SETS.get(fields)
        if not columns:
            return "*"
        return ", ".join(columns)

    @staticmethod
    async def create(
        episode_id: str,
        sort_order: int,
        scene_heading: str = '',
        action_text: str = '',
        dialogue: str = '',
        camera_movement: str = '',
        image_prompt: str = '',
        video_prompt: str = '',
        bound_assets: list = None,
        configured_references: list = None,
        reference_config_initialized: bool = False,
        script_id: Optional[str] = None,

        script_segment_id: Optional[str] = None,
        source_video_shot_no: str = '',
        video_script_block: str = '',
        shot_size: str = '',
        camera_angle: str = '',

        generated_image_url: str = '',
        planned_duration_ms: Optional[int] = None,
        lineage_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        item_id = f"sb_{uuid.uuid4().hex[:12]}"
        query = """
            INSERT INTO storyboard_items
                (item_id, lineage_id, episode_id, sort_order, scene_heading, action_text,
                 dialogue, camera_movement, image_prompt, video_prompt, bound_assets,
                 configured_references, reference_config_initialized, script_id,
                 script_segment_id, source_video_shot_no,
                 video_script_block, shot_size, camera_angle,
                 generated_image_url, planned_duration_ms)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
                    $12::jsonb, $13, $14, $15, $16, $17, $18, $19, $20, $21)
            RETURNING *
        """
        return await db.fetchrow(
            query, item_id, lineage_id, episode_id, sort_order,
            scene_heading, action_text, dialogue,
            camera_movement, image_prompt, video_prompt,
            json.dumps(bound_assets or [], ensure_ascii=False),
            json.dumps(configured_references or [], ensure_ascii=False),
            _reference_config_initialized(configured_references, reference_config_initialized),
            script_id, script_segment_id, source_video_shot_no,
            video_script_block, shot_size, camera_angle,
            (generated_image_url or None), planned_duration_ms,
        )

    @staticmethod
    async def batch_create(episode_id: str, items: list, script_id: Optional[str] = None) -> List[Dict[str, Any]]:

        db = get_db_manager()
        if not db:
            return []
        results = []
        for item in items:
            row = await StoryboardDAO.create(
                episode_id=episode_id,
                sort_order=item.get('sort_order', 0),
                scene_heading=item.get('scene_heading', ''),
                action_text=item.get('action_text', ''),
                dialogue=item.get('dialogue', ''),
                camera_movement=item.get('camera_movement', ''),
                image_prompt=item.get('image_prompt', ''),
                video_prompt=item.get('video_prompt', ''),
                bound_assets=item.get('bound_assets'),
                configured_references=item.get('configured_references', item.get('configuredReferences')),
                reference_config_initialized=_reference_config_initialized(
                    item.get('configured_references', item.get('configuredReferences')),
                    item.get(
                        'reference_config_initialized',
                        item.get('referenceConfigInitialized', False),
                    ),
                ),
                script_id=script_id or item.get('script_id'),
                script_segment_id=item.get('script_segment_id'),
                source_video_shot_no=item.get('source_video_shot_no', ''),
                video_script_block=item.get('video_script_block', ''),
                shot_size=item.get('shot_size', ''),
                camera_angle=item.get('camera_angle', ''),
                generated_image_url=item.get('generated_image_url', ''),
                planned_duration_ms=item.get('planned_duration_ms'),
                lineage_id=item.get('lineage_id') or item.get('lineageId'),
            )
            if row:
                results.append(dict(row))
        return results

    @staticmethod
    async def replace_batch(
        episode_id: str,
        items: list,
        script_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Replace one script's active storyboard without breaking matched links."""
        db = get_db_manager()
        if not db:
            return []

        async with db.acquire() as conn:
            async with conn.transaction():
                if script_id:
                    existing_rows = await conn.fetch(
                        """SELECT * FROM storyboard_items
                           WHERE episode_id = $1 AND script_id = $2
                           ORDER BY sort_order ASC FOR UPDATE""",
                        episode_id,
                        script_id,
                    )
                else:
                    existing_rows = await conn.fetch(
                        """SELECT * FROM storyboard_items
                           WHERE episode_id = $1 AND script_id IS NULL
                           ORDER BY sort_order ASC FOR UPDATE""",
                        episode_id,
                    )

                prepared = _prepare_storyboard_items_for_export(
                    [dict(row) for row in existing_rows],
                    items,
                )
                retained_ids: list[str] = []

                for item in prepared:
                    item_id = str(item.get('_preserved_item_id') or '')
                    generated_image_url = item.get('generated_image_url') or item.get('generatedImageUrl') or None
                    if item_id:
                        row = await conn.fetchrow(
                            """
                            UPDATE storyboard_items
                            SET sort_order = $3,
                                scene_heading = $4,
                                action_text = $5,
                                dialogue = $6,
                                camera_movement = $7,
                                image_prompt = $8,
                                video_prompt = $9,
                                bound_assets = $10::jsonb,
                                configured_references = $11::jsonb,
                                reference_config_initialized = $12,
                                planned_duration_ms = $13,
                                script_id = $14,
                                script_segment_id = $15,
                                source_video_shot_no = $16,
                                video_script_block = $17,
                                shot_size = $18,
                                camera_angle = $19,
                                generated_image_url = COALESCE($20, generated_image_url),
                                updated_at = CURRENT_TIMESTAMP
                            WHERE item_id = $1 AND episode_id = $2
                            RETURNING *
                            """,
                            item_id,
                            episode_id,
                            item.get('sort_order', 0),
                            item.get('scene_heading', ''),
                            item.get('action_text', ''),
                            item.get('dialogue', ''),
                            item.get('camera_movement', ''),
                            item.get('image_prompt', ''),
                            item.get('video_prompt', ''),
                            json.dumps(item.get('bound_assets', []), ensure_ascii=False),
                            json.dumps(
                                item.get('configured_references', item.get('configuredReferences', [])),
                                ensure_ascii=False,
                            ),
                            _reference_config_initialized(
                                item.get('configured_references', item.get('configuredReferences')),
                                item.get(
                                    'reference_config_initialized',
                                    item.get('referenceConfigInitialized', False),
                                ),
                            ),
                            item.get('planned_duration_ms'),
                            script_id or item.get('script_id'),
                            item.get('script_segment_id'),
                            item.get('source_video_shot_no', ''),
                            item.get('video_script_block', ''),
                            item.get('shot_size', ''),
                            item.get('camera_angle', ''),
                            generated_image_url,
                        )
                        if row:
                            retained_ids.append(item_id)
                        continue

                    item_id = str(item.get('item_id') or item.get('itemId') or f"sb_{uuid.uuid4().hex[:12]}")
                    item['_preserved_item_id'] = item_id
                    await StoryboardDAO.batch_create_transactional(
                        conn,
                        episode_id,
                        [item],
                        script_id=script_id,
                    )
                    retained_ids.append(item_id)

                if script_id:
                    if retained_ids:
                        await conn.execute(
                            """DELETE FROM storyboard_items
                               WHERE episode_id = $1 AND script_id = $2
                                 AND NOT (item_id = ANY($3::varchar[]))""",
                            episode_id,
                            script_id,
                            retained_ids,
                        )
                    else:
                        await conn.execute(
                            "DELETE FROM storyboard_items WHERE episode_id = $1 AND script_id = $2",
                            episode_id,
                            script_id,
                        )
                    rows = await conn.fetch(
                        """SELECT * FROM storyboard_items
                           WHERE episode_id = $1 AND script_id = $2
                           ORDER BY sort_order ASC""",
                        episode_id,
                        script_id,
                    )
                else:
                    if retained_ids:
                        await conn.execute(
                            """DELETE FROM storyboard_items
                               WHERE episode_id = $1 AND script_id IS NULL
                                 AND NOT (item_id = ANY($2::varchar[]))""",
                            episode_id,
                            retained_ids,
                        )
                    else:
                        await conn.execute(
                            "DELETE FROM storyboard_items WHERE episode_id = $1 AND script_id IS NULL",
                            episode_id,
                        )
                    rows = await conn.fetch(
                        """SELECT * FROM storyboard_items
                           WHERE episode_id = $1 AND script_id IS NULL
                           ORDER BY sort_order ASC""",
                        episode_id,
                    )
                return [dict(row) for row in rows]

    @staticmethod
    async def batch_create_transactional(conn, episode_id: str, items: list, script_id: Optional[str] = None) -> int:

        count = 0
        for item in items:
            item_id = (
                item.get('_preserved_item_id')
                or item.get('item_id')
                or item.get('itemId')
                or f"sb_{uuid.uuid4().hex[:12]}"
            )
            sid = script_id or item.get('script_id')
            await conn.execute("""
                INSERT INTO storyboard_items
                    (item_id, lineage_id, episode_id, sort_order, scene_heading, action_text,
                     dialogue, camera_movement, image_prompt, video_prompt,
                     bound_assets, configured_references, reference_config_initialized,
                     planned_duration_ms, script_id,
                     script_segment_id, source_video_shot_no, video_script_block,
                     shot_size, camera_angle, generated_image_url)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14,
                        $15, $16, $17, $18, $19, $20, $21)
            """,
                item_id,
                item.get('lineage_id') or item.get('lineageId'),
                episode_id,
                item.get('sort_order', 0),
                item.get('scene_heading', ''),
                item.get('action_text', ''),
                item.get('dialogue', ''),
                item.get('camera_movement', ''),
                item.get('image_prompt', ''),
                item.get('video_prompt', ''),
                json.dumps(item.get('bound_assets', []), ensure_ascii=False),
                json.dumps(
                    item.get('configured_references', item.get('configuredReferences', [])),
                    ensure_ascii=False,
                ),
                _reference_config_initialized(
                    item.get('configured_references', item.get('configuredReferences')),
                    item.get(
                        'reference_config_initialized',
                        item.get('referenceConfigInitialized', False),
                    ),
                ),
                item.get('planned_duration_ms'),
                sid,
                item.get('script_segment_id'),
                item.get('source_video_shot_no', ''),
                item.get('video_script_block', ''),
                item.get('shot_size', ''),
                item.get('camera_angle', ''),
                item.get('generated_image_url') or item.get('generatedImageUrl') or None,
            )
            count += 1
        return count

    @staticmethod
    async def delete_by_episode_transactional(conn, episode_id: str, script_id: Optional[str] = None) -> int:
        if script_id:
            result = await conn.execute(
                "DELETE FROM storyboard_items WHERE episode_id = $1 AND script_id = $2",
                episode_id,
                script_id,
            )
        else:
            result = await conn.execute("DELETE FROM storyboard_items WHERE episode_id = $1", episode_id)
        try:
            return int(result.split()[-1])
        except Exception:
            return 0

    @staticmethod
    async def export_script_transaction(
        *,
        episode_script_dao: Any,
        asset_dao: Any,
        episode_id: str,
        project_id: str,
        original_content: str,
        script_content: str,
        storyboard_items: List[Dict[str, Any]],
        characters: List[Dict[str, Any]],
        scenes: List[Dict[str, Any]],
        props: Optional[List[Dict[str, Any]]] = None,
        script_id: Optional[str],
        created_by: str,
        preserve_existing_storyboards: bool = False,
    ) -> int:
        db = get_db_manager()
        if not db:
            raise RuntimeError("database unavailable")

        async with db.acquire() as conn:
            async with conn.transaction():
                if script_id:
                    existing_rows = await conn.fetch(
                        "SELECT * FROM storyboard_items WHERE episode_id = $1 AND script_id = $2 ORDER BY sort_order ASC",
                        episode_id,
                        script_id,
                    )
                else:
                    existing_rows = await conn.fetch(
                        "SELECT * FROM storyboard_items WHERE episode_id = $1 ORDER BY sort_order ASC",
                        episode_id,
                    )
                prepared_storyboard_items = _prepare_storyboard_items_for_export(
                    [dict(row) for row in existing_rows],
                    storyboard_items,
                )
                await episode_script_dao.upsert_transactional(
                    conn,
                    episode_id,
                    original_content=original_content,
                    adapted_script=script_content,
                    script_id=script_id,
                    metadata={
                        "extracted_characters": [c.get("name", "") for c in characters],
                        "extracted_scenes": [s.get("name", "") for s in scenes],
                        "extracted_props": [p.get("name", "") for p in (props or [])],
                    },
                )
                created = 0
                if not preserve_existing_storyboards:
                    await StoryboardDAO.delete_by_episode_transactional(conn, episode_id, script_id=script_id)
                    if prepared_storyboard_items:
                        created = await StoryboardDAO.batch_create_transactional(
                            conn,
                            episode_id,
                            prepared_storyboard_items,
                            script_id=script_id,
                        )
                await asset_dao.create_missing_episode_assets_transactional(
                    conn,
                    project_id=project_id,
                    episode_id=episode_id,
                    script_id=script_id,
                    asset_type="character",
                    items=characters,
                    created_by=created_by,
                )
                await asset_dao.create_missing_episode_assets_transactional(
                    conn,
                    project_id=project_id,
                    episode_id=episode_id,
                    script_id=script_id,
                    asset_type="scene",
                    items=scenes,
                    created_by=created_by,
                )
                await asset_dao.create_missing_episode_assets_transactional(
                    conn,
                    project_id=project_id,
                    episode_id=episode_id,
                    script_id=script_id,
                    asset_type="prop",
                    items=props or [],
                    created_by=created_by,
                )
        return created

    @staticmethod
    async def get_by_id(item_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM storyboard_items WHERE item_id = $1", item_id
        )

    @staticmethod
    async def get_by_episode(
        episode_id: str,
        script_id: Optional[str] = None,
        limit: Optional[int] = None,
        offset: int = 0,
        fields: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        limit = max(1, min(int(limit), 500)) if limit is not None else None
        offset = max(0, int(offset or 0))
        select_columns = StoryboardDAO._select_columns(fields)
        if script_id:
            if limit is not None:
                return await db.fetch(
                    f"""
                    SELECT {select_columns} FROM storyboard_items
                    WHERE episode_id = $1 AND script_id = $2
                    ORDER BY sort_order ASC
                    LIMIT $3 OFFSET $4
                    """,
                    episode_id, script_id, limit, offset
                )
            return await db.fetch(
                f"SELECT {select_columns} FROM storyboard_items WHERE episode_id = $1 AND script_id = $2 ORDER BY sort_order ASC",
                episode_id, script_id
            )
        if limit is not None:
            return await db.fetch(
                f"""
                SELECT {select_columns} FROM storyboard_items
                WHERE episode_id = $1
                ORDER BY sort_order ASC
                LIMIT $2 OFFSET $3
                """,
                episode_id, limit, offset
            )
        return await db.fetch(
            f"SELECT {select_columns} FROM storyboard_items WHERE episode_id = $1 ORDER BY sort_order ASC",
            episode_id
        )

    @staticmethod
    async def count_by_episode(episode_id: str, script_id: Optional[str] = None) -> int:
        db = get_db_manager()
        if not db:
            return 0
        if script_id:
            value = await db.fetchval(
                "SELECT COUNT(*) FROM storyboard_items WHERE episode_id = $1 AND script_id = $2",
                episode_id, script_id
            )
        else:
            value = await db.fetchval(
                "SELECT COUNT(*) FROM storyboard_items WHERE episode_id = $1",
                episode_id
            )
        return int(value or 0)

    @staticmethod
    async def update(item_id: str, **kwargs) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        allowed = {
            'sort_order', 'scene_heading', 'action_text', 'dialogue',
            'camera_movement', 'image_prompt', 'video_prompt',
            'generated_image_url', 'status',
            'dialogue_audio_url', 'narration_audio_url', 'sfx_audio_url',
            'audio_duration_ms', 'planned_duration_ms',
            'audio_segments',
            'mixed_audio_url', 'mixed_audio_hash',  # Task 2: backend audio mix cache

            'script_segment_id', 'source_video_shot_no', 'video_script_block',
            'shot_size', 'camera_angle',
            'reference_config_initialized',
        }
        nullable_fields = {
            'dialogue_audio_url',
            'narration_audio_url',
            'sfx_audio_url',
            'audio_duration_ms',
            'planned_duration_ms',
            'mixed_audio_url',
            'mixed_audio_hash',
        }
        json_fields = {'bound_assets', 'configured_references', 'audio_segments'}
        sets, vals, idx = [], [], 1
        for key, val in kwargs.items():
            if key in json_fields and val is not None:
                sets.append(f"{key} = ${idx}::jsonb")
                vals.append(json.dumps(val, ensure_ascii=False))
                idx += 1
            elif key in allowed and (val is not None or key in nullable_fields):
                sets.append(f"{key} = ${idx}")
                vals.append(val)
                idx += 1
        if not sets:
            return await StoryboardDAO.get_by_id(item_id)
        vals.append(item_id)
        query = f"UPDATE storyboard_items SET {', '.join(sets)} WHERE item_id = ${idx} RETURNING *"
        return await db.fetchrow(query, *vals)

    @staticmethod
    async def reorder(episode_id: str, item_ids: List[str]) -> bool:
        db = get_db_manager()
        if not db:
            return False
        try:
            async with db.acquire() as conn:
                for order, iid in enumerate(item_ids):
                    await conn.execute(
                        "UPDATE storyboard_items SET sort_order = $1 WHERE item_id = $2 AND episode_id = $3",
                        order, iid, episode_id
                    )
            return True
        except Exception:
            return False

    @staticmethod
    async def delete(item_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM storyboard_items WHERE item_id = $1", item_id
        )
        return result == "DELETE 1"

    @staticmethod
    async def delete_by_episode(episode_id: str, script_id: Optional[str] = None) -> int:

        db = get_db_manager()
        if not db:
            return 0
        if script_id:
            result = await db.execute(
                "DELETE FROM storyboard_items WHERE episode_id = $1 AND script_id = $2",
                episode_id, script_id
            )
        else:
            result = await db.execute(
                "DELETE FROM storyboard_items WHERE episode_id = $1", episode_id
            )
        try:
            return int(result.split()[-1])
        except Exception:
            return 0
