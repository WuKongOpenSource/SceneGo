"""DAO helpers for episode final-video composition."""
from __future__ import annotations

import json
from typing import Any, Dict, List

from db_manager import get_db_manager


class EpisodeComposeDAO:
    @staticmethod
    async def list_storyboard_audio_rows(episode_id: str, item_ids: List[str]) -> List[Dict[str, Any]]:
        rows = await get_db_manager().fetch(
            """SELECT item_id,mixed_audio_url,dialogue_audio_url,narration_audio_url,
                      sfx_audio_url,audio_duration_ms FROM storyboard_items
               WHERE episode_id=$1 AND item_id=ANY($2::text[])""", episode_id, item_ids,
        )
        return [dict(row) for row in rows]

    @staticmethod
    async def list_shot_take_rows(episode_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        rows = await db.fetch(
            """
            SELECT COALESCE(si.item_id, vs.segment_id) AS item_id, vs.sort_order,
                   si.scene_heading, si.dialogue,
                   si.mixed_audio_url AS audio_url,
                   si.dialogue_audio_url, si.narration_audio_url, si.sfx_audio_url,
                   si.audio_segments,
                   COALESCE(si.audio_duration_ms,0) AS audio_ms,
                   vs.segment_id,
                   COALESCE(NULLIF(vs.video_url, ''), entity_video.file_url) AS video_url,
                   COALESCE(entity_video.created_at, vs.created_at) AS created_at,
                   COALESCE(entity_video.thumbnail_url, legacy_file.thumbnail_url) AS thumbnail_url,
                   unified_take.take_id,
                   (content_selection.selected_take_id = unified_take.take_id) AS is_selected
            FROM video_segments vs
            LEFT JOIN storyboard_items si
              ON vs.episode_id = si.episode_id
             AND (
                 vs.storyboard_item_id = si.item_id
                 OR (
                     vs.storyboard_lineage_id IS NOT NULL
                     AND vs.storyboard_lineage_id = si.lineage_id
                 )
             )
            LEFT JOIN LATERAL (
                SELECT f.file_id, f.file_url, f.thumbnail_url, f.created_at
                FROM files f
                WHERE f.entity_type = 'video_segment'
                  AND f.entity_id = vs.segment_id
                  AND f.file_type = 'video'
                  AND f.file_role = 'video'
                  AND f.is_deleted = FALSE
                  AND f.file_url IS NOT NULL
                ORDER BY f.is_selected DESC, f.created_at DESC
                LIMIT 1
            ) entity_video ON TRUE
            LEFT JOIN files legacy_file
              ON legacy_file.file_url = split_part(vs.video_url, '?', 1)
            LEFT JOIN LATERAL (
                SELECT ct.take_id
                FROM content_takes ct
                WHERE ct.entity_type = 'storyboard_item'
                  AND ct.entity_id = si.item_id
                  AND ct.slot = 'video'
                  AND ct.status = 'active'
                  AND (
                      ct.source_id = vs.segment_id
                      OR (entity_video.file_url IS NOT NULL AND ct.file_id = entity_video.file_id)
                  )
                ORDER BY ct.created_at DESC, ct.id DESC
                LIMIT 1
            ) unified_take ON TRUE
            LEFT JOIN content_selections content_selection
              ON content_selection.entity_type = 'storyboard_item'
             AND content_selection.entity_id = si.item_id
             AND content_selection.slot = 'video'
            WHERE vs.episode_id = $1
              AND COALESCE(NULLIF(vs.video_url, ''), entity_video.file_url) IS NOT NULL
            ORDER BY vs.sort_order, COALESCE(entity_video.created_at, vs.created_at) DESC
            """,
            episode_id,
        )
        return [dict(row) for row in rows]

    @staticmethod
    async def list_audio_tracks(episode_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(
            """
            SELECT track_id, track_type, name, audio_url, duration_ms,
                   generation_params
            FROM audio_tracks
            WHERE episode_id = $1
              AND track_type IN ('bgm', 'sfx_global')
              AND audio_url IS NOT NULL
            ORDER BY created_at ASC
            """,
            episode_id,
        )
        if not rows:
            return []
        from utils.enhance_export import TIMELINE_NAME, apply_audio_edits, decode
        items = await db.fetchval(
            'SELECT items FROM timeline_tracks WHERE episode_id=$1 AND track_name=$2 ORDER BY created_at LIMIT 1',
            episode_id, TIMELINE_NAME,
        )
        return apply_audio_edits([dict(row) for row in rows], decode(items, []))

    @staticmethod
    async def create_final_cut_records(
        *,
        file_id: str,
        library_item_id: str,
        user_id: str,
        project_id: str,
        episode_id: str,
        file_name: str,
        file_path: str,
        file_url: str,
        file_size_bytes: int,
        duration_seconds: float,
        title: str,
        metadata: Dict[str, Any],
    ) -> None:
        db = get_db_manager()
        if not db.pool:
            await db.connect()

        async with db.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    """
                    INSERT INTO files (
                        file_id, user_id, file_type, file_name, file_path,
                        file_url, file_size_bytes, mime_type, duration_seconds,
                        entity_type, entity_id, metadata, created_at
                    )
                    VALUES (
                        $1,$2,'video',$3,$4,$5,$6,'video/mp4',$7,
                        'episode',$8,$9::jsonb,now()
                    )
                    """,
                    file_id,
                    user_id,
                    file_name,
                    file_path,
                    file_url,
                    file_size_bytes,
                    duration_seconds,
                    episode_id,
                    json.dumps(metadata or {}, ensure_ascii=False),
                )

                await conn.execute(
                    """
                    INSERT INTO media_library_items (
                        library_item_id, file_id, user_id, item_type, source,
                        title, project_id, episode_id, created_at
                    )
                    VALUES ($1,$2,$3,'video','composed_final',$4,$5,$6,now())
                    """,
                    library_item_id,
                    file_id,
                    user_id,
                    title,
                    project_id,
                    episode_id,
                )
