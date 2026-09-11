"""Persistence for unified media takes, selections, bindings and stale events."""
from __future__ import annotations

import json
import uuid
from typing import Any, Dict, Iterable, Optional

from db_manager import get_db_manager


def _json(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False)


def _rows(rows: Iterable[Any]) -> list[Dict[str, Any]]:
    return [dict(row) for row in rows or []]


class ContentWorkflowDAO:
    """SQL-only workflow primitives.

    Business propagation rules intentionally live in
    :mod:`services.content_workflow_service` so they remain unit-testable.
    """

    @staticmethod
    async def resolve_entity_context(
        entity_type: str,
        entity_id: str,
        *,
        episode_id: Optional[str] = None,
        lineage_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None

        normalized_type = {
            "storyboard": "storyboard_item",
            "shot": "storyboard_item",
        }.get(entity_type, entity_type)

        if normalized_type == "video_segment":
            row = await db.fetchrow(
                """
                SELECT 'storyboard_item'::text AS entity_type,
                       si.item_id AS entity_id,
                       si.lineage_id AS entity_lineage_id,
                       si.episode_id,
                       e.project_id,
                       vs.segment_id AS source_id,
                       vs.storyboard_item_id AS requested_entity_id,
                       (vs.storyboard_item_id IS NULL OR vs.storyboard_item_id <> si.item_id)
                           AS is_late_lineage_attachment,
                       vs.task_id AS source_task_id,
                       vs.model AS model_name,
                       vs.input_params AS generation_params
                FROM video_segments vs
                JOIN LATERAL (
                    SELECT current_si.*
                    FROM storyboard_items current_si
                    WHERE current_si.episode_id = vs.episode_id
                      AND (
                          current_si.item_id = vs.storyboard_item_id
                          OR (
                              vs.storyboard_lineage_id IS NOT NULL
                              AND current_si.lineage_id = vs.storyboard_lineage_id
                          )
                      )
                    ORDER BY (current_si.item_id = vs.storyboard_item_id) DESC,
                             current_si.updated_at DESC
                    LIMIT 1
                ) si ON TRUE
                JOIN episodes e ON e.episode_id = si.episode_id
                WHERE vs.segment_id = $1
                """,
                entity_id,
            )
            if row:
                return dict(row)

        if normalized_type == "storyboard_item":
            row = await db.fetchrow(
                """
                SELECT 'storyboard_item'::text AS entity_type,
                       si.item_id AS entity_id,
                       si.lineage_id AS entity_lineage_id,
                       si.episode_id,
                       e.project_id
                FROM storyboard_items si
                JOIN episodes e ON e.episode_id = si.episode_id
                WHERE si.item_id = $1
                """,
                entity_id,
            )
            if row:
                return dict(row)

        if normalized_type == "asset":
            row = await db.fetchrow(
                """
                SELECT 'asset'::text AS entity_type,
                       a.asset_id AS entity_id,
                       a.asset_id AS entity_lineage_id,
                       a.episode_id,
                       a.project_id
                FROM assets a
                WHERE a.asset_id = $1
                """,
                entity_id,
            )
            if row:
                return dict(row)

        if normalized_type == "episode":
            row = await db.fetchrow(
                """
                SELECT 'episode'::text AS entity_type,
                       e.episode_id AS entity_id,
                       e.episode_id AS entity_lineage_id,
                       e.episode_id,
                       e.project_id
                FROM episodes e
                WHERE e.episode_id = $1
                """,
                entity_id,
            )
            if row:
                return dict(row)

        # A result can arrive after the original storyboard row was replaced.
        # The immutable lineage supplied by the task is then the only safe
        # attachment key.  Choose the current row but never mutate selection.
        if episode_id and lineage_id:
            row = await db.fetchrow(
                """
                SELECT 'storyboard_item'::text AS entity_type,
                       si.item_id AS entity_id,
                       si.lineage_id AS entity_lineage_id,
                       si.episode_id,
                       e.project_id
                FROM storyboard_items si
                JOIN episodes e ON e.episode_id = si.episode_id
                WHERE si.episode_id = $1 AND si.lineage_id = $2
                ORDER BY si.updated_at DESC, si.id DESC
                LIMIT 1
                """,
                episode_id,
                lineage_id,
            )
            if row:
                return dict(row)
        return None

    @staticmethod
    async def create_take(
        *,
        user_id: Optional[str],
        project_id: Optional[str],
        episode_id: Optional[str],
        entity_type: str,
        entity_id: str,
        entity_lineage_id: Optional[str],
        slot: str,
        file_id: Optional[str],
        source_type: str,
        source_id: Optional[str],
        source_task_id: Optional[str],
        requested_entity_id: Optional[str],
        requested_lineage_id: Optional[str],
        provider: Optional[str],
        model_name: Optional[str],
        generation_params: Optional[dict],
        metadata: Optional[dict],
        attachment_round: int,
        is_late: bool,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None

        if file_id:
            existing = await db.fetchrow(
                """
                SELECT * FROM content_takes
                WHERE entity_type = $1 AND entity_id = $2
                  AND slot = $3 AND file_id = $4
                """,
                entity_type,
                entity_id,
                slot,
                file_id,
            )
            if existing:
                return dict(existing)
        if source_id:
            existing = await db.fetchrow(
                """
                SELECT * FROM content_takes
                WHERE entity_type = $1 AND entity_id = $2 AND slot = $3
                  AND source_type = $4 AND source_id = $5
                """,
                entity_type,
                entity_id,
                slot,
                source_type,
                source_id,
            )
            if existing:
                return dict(existing)

        take_id = f"take_{uuid.uuid4().hex}"
        row = await db.fetchrow(
            """
            INSERT INTO content_takes (
                take_id, user_id, project_id, episode_id,
                entity_type, entity_id, entity_lineage_id, slot,
                file_id, source_type, source_id, source_task_id,
                requested_entity_id, requested_lineage_id,
                provider, model_name, generation_params, metadata,
                attachment_round, is_late
            )
            VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                $15,$16,$17::jsonb,$18::jsonb,$19,$20
            )
            ON CONFLICT DO NOTHING
            RETURNING *
            """,
            take_id,
            user_id,
            project_id,
            episode_id,
            entity_type,
            entity_id,
            entity_lineage_id,
            slot,
            file_id,
            source_type,
            source_id,
            source_task_id,
            requested_entity_id,
            requested_lineage_id,
            provider,
            model_name,
            _json(generation_params),
            _json(metadata),
            max(0, min(int(attachment_round or 0), 3)),
            bool(is_late),
        )
        if row:
            return dict(row)
        if file_id:
            row = await db.fetchrow(
                """
                SELECT * FROM content_takes
                WHERE entity_type = $1 AND entity_id = $2
                  AND slot = $3 AND file_id = $4
                """,
                entity_type,
                entity_id,
                slot,
                file_id,
            )
        elif source_id:
            row = await db.fetchrow(
                """
                SELECT * FROM content_takes
                WHERE entity_type = $1 AND entity_id = $2 AND slot = $3
                  AND source_type = $4 AND source_id = $5
                """,
                entity_type,
                entity_id,
                slot,
                source_type,
                source_id,
            )
        return dict(row) if row else None

    @staticmethod
    async def list_takes(entity_type: str, entity_id: str, slot: str) -> list[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(
            """
            SELECT ct.*,
                   f.file_url, f.thumbnail_url, f.mime_type,
                   COALESCE(f.file_url, vs.video_url) AS effective_url,
                   COALESCE(f.thumbnail_url, vs.thumbnail_url) AS effective_thumbnail_url,
                   (cs.selected_take_id = ct.take_id) AS is_selected
            FROM content_takes ct
            LEFT JOIN files f ON f.file_id = ct.file_id AND f.is_deleted = FALSE
            LEFT JOIN video_segments vs
              ON ct.source_type = 'video_segment' AND vs.segment_id = ct.source_id
            LEFT JOIN content_selections cs
              ON cs.entity_type = ct.entity_type
             AND cs.entity_id = ct.entity_id
             AND cs.slot = ct.slot
            WHERE ct.entity_type = $1 AND ct.entity_id = $2
              AND ct.slot = $3 AND ct.status = 'active'
            ORDER BY ct.created_at DESC, ct.id DESC
            """,
            entity_type,
            entity_id,
            slot,
        )
        return _rows(rows)

    @staticmethod
    async def select_take(
        entity_type: str,
        entity_id: str,
        slot: str,
        take_id: str,
        selected_by: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        async with db.acquire() as conn:
            async with conn.transaction():
                take = await conn.fetchrow(
                    """
                    SELECT * FROM content_takes
                    WHERE take_id = $1 AND entity_type = $2 AND entity_id = $3
                      AND slot = $4 AND status = 'active'
                    FOR UPDATE
                    """,
                    take_id,
                    entity_type,
                    entity_id,
                    slot,
                )
                if not take:
                    return None
                await conn.execute(
                    """
                    INSERT INTO content_selections (
                        entity_type, entity_id, slot, selected_take_id, selected_by
                    )
                    VALUES ($1,$2,$3,$4,$5)
                    ON CONFLICT (entity_type, entity_id, slot)
                    DO UPDATE SET selected_take_id = EXCLUDED.selected_take_id,
                                  selected_by = EXCLUDED.selected_by,
                                  revision = content_selections.revision + 1,
                                  selected_at = CURRENT_TIMESTAMP
                    """,
                    entity_type,
                    entity_id,
                    slot,
                    take_id,
                    selected_by,
                )
                if take.get("file_id"):
                    await conn.execute(
                        """
                        UPDATE files
                        SET is_selected = (file_id = $1)
                        WHERE entity_id = $2
                          AND entity_type IN ($3, 'storyboard', 'storyboard_item')
                          AND is_deleted = FALSE
                          AND file_role = ANY($4::varchar[])
                        """,
                        take["file_id"],
                        entity_id,
                        entity_type,
                        ContentWorkflowDAO.file_roles_for_slot(slot),
                    )
                selected = dict(take)
                selected["is_selected"] = True
                return selected

    @staticmethod
    def file_roles_for_slot(slot: str) -> list[str]:
        if ":" in slot:
            base_slot = slot.split(":", 1)[0]
            return [slot, base_slot]
        return {
            "keyframe": ["generated_image"],
            "video": ["video"],
            "dialogue_audio": ["dialogue_audio"],
            "narration_audio": ["narration_audio"],
            "sfx_audio": ["sfx"],
            "mixed_audio": ["mixed_audio"],
        }.get(slot, [slot])

    @staticmethod
    async def create_stale_event(
        *,
        project_id: Optional[str],
        episode_id: Optional[str],
        target_entity_type: str,
        target_entity_id: str,
        target_lineage_id: Optional[str],
        target_slot: str,
        source_entity_type: str,
        source_entity_id: Optional[str],
        reason_code: str,
        detail: Optional[dict],
        idempotency_key: Optional[str],
        created_by: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        event_id = f"stale_{uuid.uuid4().hex}"
        row = await db.fetchrow(
            """
            INSERT INTO content_stale_events (
                stale_event_id, project_id, episode_id,
                target_entity_type, target_entity_id, target_lineage_id, target_slot,
                source_entity_type, source_entity_id, reason_code, detail,
                idempotency_key, created_by
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)
            ON CONFLICT DO NOTHING
            RETURNING *
            """,
            event_id,
            project_id,
            episode_id,
            target_entity_type,
            target_entity_id,
            target_lineage_id,
            target_slot,
            source_entity_type,
            source_entity_id,
            reason_code,
            _json(detail),
            idempotency_key,
            created_by,
        )
        if row:
            return dict(row)
        if idempotency_key:
            row = await db.fetchrow(
                "SELECT * FROM content_stale_events WHERE idempotency_key = $1",
                idempotency_key,
            )
        return dict(row) if row else None

    @staticmethod
    async def resolve_stale_for_regenerated_take(
        *,
        entity_type: str,
        entity_id: str,
        entity_lineage_id: Optional[str],
        slot: str,
        resolved_by: Optional[str],
        take_id: str,
    ) -> list[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(
            """
            UPDATE content_stale_events
            SET status = 'regenerated', resolved_by = $5,
                resolved_at = CURRENT_TIMESTAMP,
                resolution_note = 'regenerated by take ' || $6
            WHERE status = 'pending'
              AND target_entity_type = $1
              AND target_slot = $4
              AND (
                  target_entity_id = $2
                  OR ($3::varchar IS NOT NULL AND target_lineage_id = $3)
              )
            RETURNING *
            """,
            entity_type,
            entity_id,
            entity_lineage_id,
            slot,
            resolved_by,
            take_id,
        )
        return _rows(rows)

    @staticmethod
    async def list_stale_events(episode_id: str, status: str = "pending") -> list[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(
            """
            SELECT * FROM content_stale_events
            WHERE episode_id = $1 AND status = $2
            ORDER BY created_at DESC, id DESC
            """,
            episode_id,
            status,
        )
        return _rows(rows)

    @staticmethod
    async def get_stale_event(stale_event_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            "SELECT * FROM content_stale_events WHERE stale_event_id = $1",
            stale_event_id,
        )
        return dict(row) if row else None

    @staticmethod
    async def resolve_stale_event(
        stale_event_id: str,
        *,
        status: str,
        resolved_by: Optional[str],
        resolution_note: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """
            UPDATE content_stale_events
            SET status = $2, resolved_by = $3, resolution_note = $4,
                resolved_at = CURRENT_TIMESTAMP
            WHERE stale_event_id = $1 AND status = 'pending'
            RETURNING *
            """,
            stale_event_id,
            status,
            resolved_by,
            resolution_note,
        )
        return dict(row) if row else None

    @staticmethod
    async def list_storyboard_targets(
        *,
        episode_id: Optional[str] = None,
        project_id: Optional[str] = None,
        tag_key: Optional[str] = None,
        storyboard_item_id: Optional[str] = None,
    ) -> list[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        conditions: list[str] = []
        params: list[Any] = []
        if storyboard_item_id:
            params.append(storyboard_item_id)
            conditions.append(f"si.item_id = ${len(params)}")
        if episode_id:
            params.append(episode_id)
            conditions.append(f"si.episode_id = ${len(params)}")
        if project_id:
            params.append(project_id)
            conditions.append(f"e.project_id = ${len(params)}")
        if tag_key:
            tag_name = tag_key.split(":", 1)[-1].strip().lower()
            params.extend([tag_key.lower(), tag_name])
            tag_index = len(params) - 1
            name_index = len(params)
            conditions.append(
                "("
                f"LOWER(si.bound_assets::text) LIKE '%' || ${tag_index} || '%' "
                f"OR LOWER(si.bound_assets::text) LIKE '%' || ${name_index} || '%' "
                f"OR LOWER(si.configured_references::text) LIKE '%' || ${tag_index} || '%' "
                f"OR LOWER(si.configured_references::text) LIKE '%' || ${name_index} || '%'"
                ")"
            )
        where = " AND ".join(conditions) if conditions else "TRUE"
        rows = await db.fetch(
            f"""
            SELECT si.item_id, si.lineage_id, si.episode_id, e.project_id,
                   si.script_segment_id, si.audio_segments,
                   ess.source_text AS script_segment_source_text
            FROM storyboard_items si
            JOIN episodes e ON e.episode_id = si.episode_id
            LEFT JOIN episode_script_segments ess ON ess.segment_id = si.script_segment_id
            WHERE {where}
            ORDER BY si.sort_order, si.id
            """,
            *params,
        )
        return _rows(rows)

    @staticmethod
    async def upsert_binding(
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
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        async with db.acquire() as conn:
            async with conn.transaction():
                if not is_disabled:
                    asset = await conn.fetchrow(
                        "SELECT asset_id FROM assets WHERE asset_id = $1 AND project_id = $2",
                        asset_id,
                        project_id,
                    )
                    if not asset:
                        return None
                # Project defaults are intentionally episode-agnostic.  Shot
                # overrides derive their episode from the validated item.
                resolved_episode_id = None
                if scope == "shot":
                    shot = await conn.fetchrow(
                        """
                        SELECT si.episode_id
                        FROM storyboard_items si
                        JOIN episodes e ON e.episode_id = si.episode_id
                        WHERE si.item_id = $1 AND e.project_id = $2
                        """,
                        storyboard_item_id,
                        project_id,
                    )
                    if not shot:
                        return None
                    resolved_episode_id = shot["episode_id"]
                    existing = await conn.fetchrow(
                        """
                        SELECT binding_id FROM content_bindings
                        WHERE scope = 'shot' AND storyboard_item_id = $1 AND tag_key = $2
                        FOR UPDATE
                        """,
                        storyboard_item_id,
                        tag_key,
                    )
                else:
                    existing = await conn.fetchrow(
                        """
                        SELECT binding_id FROM content_bindings
                        WHERE scope = 'project' AND project_id = $1 AND tag_key = $2
                        FOR UPDATE
                        """,
                        project_id,
                        tag_key,
                    )
                if existing:
                    row = await conn.fetchrow(
                        """
                        UPDATE content_bindings
                        SET episode_id = $2, storyboard_item_id = $3,
                            asset_id = $4, file_id = $5, is_disabled = $6, locked = $7,
                            binding_version = binding_version + 1,
                            updated_by = $8, updated_at = CURRENT_TIMESTAMP
                        WHERE binding_id = $1
                        RETURNING *
                        """,
                        existing["binding_id"],
                        resolved_episode_id,
                        storyboard_item_id if scope == "shot" else None,
                        asset_id,
                        file_id,
                        is_disabled,
                        locked,
                        user_id,
                    )
                    return dict(row) if row else None
                binding_id = f"binding_{uuid.uuid4().hex}"
                row = await conn.fetchrow(
                    """
                    INSERT INTO content_bindings (
                        binding_id, project_id, episode_id, storyboard_item_id,
                        tag_key, scope, asset_id, file_id, is_disabled, locked,
                        created_by, updated_by
                    )
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
                    RETURNING *
                    """,
                    binding_id,
                    project_id,
                    resolved_episode_id,
                    storyboard_item_id if scope == "shot" else None,
                    tag_key,
                    scope,
                    asset_id,
                    file_id,
                    is_disabled,
                    locked,
                    user_id,
                )
                return dict(row) if row else None

    @staticmethod
    async def delete_binding(binding_id: str, project_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            "DELETE FROM content_bindings WHERE binding_id = $1 AND project_id = $2 RETURNING *",
            binding_id,
            project_id,
        )
        return dict(row) if row else None

    @staticmethod
    async def list_bindings(
        project_id: str,
        *,
        episode_id: Optional[str] = None,
        storyboard_item_id: Optional[str] = None,
    ) -> list[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(
            """
            SELECT cb.*, a.name AS asset_name, a.asset_type,
                   COALESCE(f.file_url, a.thumbnail_url) AS effective_url
            FROM content_bindings cb
            LEFT JOIN assets a ON a.asset_id = cb.asset_id
            LEFT JOIN files f ON f.file_id = cb.file_id AND f.is_deleted = FALSE
            WHERE cb.project_id = $1
              AND ($2::varchar IS NULL OR cb.episode_id = $2 OR cb.scope = 'project')
              AND ($3::varchar IS NULL OR cb.storyboard_item_id = $3 OR cb.scope = 'project')
            ORDER BY cb.tag_key, CASE cb.scope WHEN 'shot' THEN 0 ELSE 1 END
            """,
            project_id,
            episode_id,
            storyboard_item_id,
        )
        return _rows(rows)

    @staticmethod
    async def resolve_bindings(
        project_id: str,
        storyboard_item_id: str,
        tag_keys: list[str],
    ) -> list[Dict[str, Any]]:
        if not tag_keys:
            return []
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(
            """
            SELECT DISTINCT ON (cb.tag_key)
                   cb.*, a.name AS asset_name, a.asset_type,
                   COALESCE(f.file_url, a.thumbnail_url) AS effective_url
            FROM content_bindings cb
            LEFT JOIN assets a ON a.asset_id = cb.asset_id
            LEFT JOIN files f ON f.file_id = cb.file_id AND f.is_deleted = FALSE
            WHERE cb.project_id = $1
              AND cb.tag_key = ANY($3::varchar[])
              AND (cb.scope = 'project' OR cb.storyboard_item_id = $2)
            ORDER BY cb.tag_key, CASE cb.scope WHEN 'shot' THEN 0 ELSE 1 END,
                     cb.updated_at DESC
            """,
            project_id,
            storyboard_item_id,
            tag_keys,
        )
        return _rows(rows)
