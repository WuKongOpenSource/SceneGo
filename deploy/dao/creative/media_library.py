










from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager

logger = logging.getLogger(__name__)


def _coerce_jsonb(value: Any) -> Any:

    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


def _normalize_row(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    out = dict(row)
    for k in ('tags', 'metadata'):
        if k in out:
            out[k] = _coerce_jsonb(out[k])
    return out


class MediaLibraryDAO:


    @staticmethod
    async def create(
        file_id: str,
        user_id: str,
        item_type: str,
        source: str,
        project_id: Optional[str] = None,
        episode_id: Optional[str] = None,
        team_id: Optional[str] = None,
        title: Optional[str] = None,
        description: str = "",
        tags: Optional[List[str]] = None,
        permission_scope: str = "private",
        source_task_id: Optional[str] = None,
        source_entity_type: Optional[str] = None,
        source_entity_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        library_item_id: Optional[str] = None,
        visibility: str = "private",
        folder_id: Optional[str] = None,
    ) -> Dict[str, Any]:






        db = get_db_manager()
        lid = library_item_id or f"mli_{uuid.uuid4().hex[:16]}"
        if visibility not in ('private', 'org-default'):
            visibility = 'private'
        row = await db.fetchrow(
            """
            INSERT INTO media_library_items (
                library_item_id, file_id, user_id, project_id, episode_id, team_id,
                item_type, source, title, description, tags, permission_scope,
                source_task_id, source_entity_type, source_entity_id, metadata, visibility,
                folder_id
            ) VALUES (
                $1,$2,$3,$4,$5,$6,
                $7,$8,$9,$10,$11::jsonb,$12,
                $13,$14,$15,$16::jsonb,$17,
                $18
            )
            RETURNING *
            """,
            lid, file_id, user_id, project_id, episode_id, team_id,
            item_type, source, title, description, json.dumps(tags or []), permission_scope,
            source_task_id, source_entity_type, source_entity_id, json.dumps(metadata or {}),
            visibility, folder_id,
        )
        return _normalize_row(row)

    @staticmethod
    async def get(library_item_id: str) -> Optional[Dict[str, Any]]:

        db = get_db_manager()
        row = await db.fetchrow(
            """
            SELECT ml.*,
                   f.file_name, f.file_url, f.file_type, f.mime_type,
                   f.file_size_bytes, f.width, f.height, f.duration_seconds,
                   f.thumbnail_url, f.metadata AS file_metadata, f.is_deleted AS file_is_deleted
            FROM media_library_items ml
            JOIN files f ON f.file_id = ml.file_id
            WHERE ml.library_item_id = $1 AND ml.is_deleted = FALSE
            """,
            library_item_id,
        )
        return _normalize_row(row)

    @staticmethod
    async def get_by_file_id(file_id: str) -> Optional[Dict[str, Any]]:

        db = get_db_manager()
        row = await db.fetchrow(
            "SELECT * FROM media_library_items WHERE file_id = $1 AND is_deleted = FALSE",
            file_id,
        )
        return _normalize_row(row)

    @staticmethod
    async def list_for_user(
        user_id: str,
        *,
        project_id: Optional[str] = None,
        item_type: Optional[str] = None,
        source: Optional[str] = None,
        permission_scope: Optional[str] = None,
        is_favorite: Optional[bool] = None,
        keyword: Optional[str] = None,
        tag: Optional[str] = None,
        episode_id: Optional[str] = None,
        include_shared: bool = False,
        folder_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        org_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:








        db = get_db_manager()

        if org_id is None:
            visibility_clause = """(
                ml.user_id = $1
                OR (
                    ml.permission_scope = 'project'
                    AND ml.project_id IN (
                        SELECT project_id FROM project_members WHERE user_id = $1
                    )
                )
            )"""
            params: List[Any] = [user_id]
            idx = 2
        else:
            visibility_clause = """(
                ml.user_id = $1
                OR ml.library_item_id IN (
                    SELECT resource_id FROM resource_shares
                    WHERE resource_type='media'
                      AND share_target_type='org' AND share_target_id=$2
                )
                OR ml.project_id IN (
                    SELECT resource_id FROM resource_shares
                    WHERE resource_type='project'
                      AND share_target_type='org' AND share_target_id=$2
                )
            )"""
            params = [user_id, org_id]
            idx = 3

        where = [
            "ml.is_deleted = FALSE",
            "f.is_deleted = FALSE",
            visibility_clause,
        ]

        if project_id:
            where.append(f"ml.project_id = ${idx}")
            params.append(project_id)
            idx += 1
        if episode_id:
            if include_shared:
                where.append(f"(ml.episode_id = ${idx} OR ml.episode_id IS NULL)")
            else:
                where.append(f"ml.episode_id = ${idx}")
            params.append(episode_id)
            idx += 1
        if folder_id is not None:
            if folder_id == "__unfiled__":
                where.append("ml.folder_id IS NULL")
            else:
                where.append(f"ml.folder_id = ${idx}")
                params.append(folder_id)
                idx += 1
        if item_type:
            where.append(f"ml.item_type = ${idx}")
            params.append(item_type)
            idx += 1
        if source:
            where.append(f"ml.source = ${idx}")
            params.append(source)
            idx += 1
        if permission_scope:
            where.append(f"ml.permission_scope = ${idx}")
            params.append(permission_scope)
            idx += 1
        if is_favorite is not None:
            where.append(f"ml.is_favorite = ${idx}")
            params.append(is_favorite)
            idx += 1
        if keyword:
            where.append(f"(ml.title ILIKE ${idx} OR ml.description ILIKE ${idx})")
            params.append(f"%{keyword}%")
            idx += 1
        if tag:
            where.append(f"ml.tags @> ${idx}::jsonb")
            params.append(json.dumps([tag]))
            idx += 1

        params.extend([limit, offset])
        query = f"""
            SELECT ml.*,
                   f.file_name, f.file_url, f.file_type, f.mime_type,
                   f.file_size_bytes, f.width, f.height, f.duration_seconds,
                   f.thumbnail_url
            FROM media_library_items ml
            JOIN files f ON f.file_id = ml.file_id
            WHERE {' AND '.join(where)}
            ORDER BY ml.created_at DESC
            LIMIT ${idx} OFFSET ${idx + 1}
        """
        rows = await db.fetch(query, *params)
        return [_normalize_row(r) for r in rows]

    @staticmethod
    async def list_admin(
        *,
        user_id: Optional[str] = None,
        project_id: Optional[str] = None,
        item_type: Optional[str] = None,
        source: Optional[str] = None,
        is_deleted: Optional[bool] = False,
        keyword: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:



        db = get_db_manager()
        where: List[str] = ["TRUE"]
        params: List[Any] = []
        idx = 1
        if is_deleted is False:
            where.append("ml.is_deleted = FALSE")
        elif is_deleted is True:
            where.append("ml.is_deleted = TRUE")
        if user_id:
            where.append(f"ml.user_id = ${idx}"); params.append(user_id); idx += 1
        if project_id:
            where.append(f"ml.project_id = ${idx}"); params.append(project_id); idx += 1
        if item_type:
            where.append(f"ml.item_type = ${idx}"); params.append(item_type); idx += 1
        if source:
            where.append(f"ml.source = ${idx}"); params.append(source); idx += 1
        if keyword:
            where.append(f"(ml.title ILIKE ${idx} OR ml.description ILIKE ${idx})")
            params.append(f"%{keyword}%"); idx += 1
        params.extend([limit, offset])
        query = f"""
            SELECT ml.*,
                   f.file_name, f.file_url, f.file_type, f.mime_type,
                   f.file_size_bytes, f.width, f.height, f.duration_seconds,
                   f.thumbnail_url
            FROM media_library_items ml
            LEFT JOIN files f ON f.file_id = ml.file_id
            WHERE {' AND '.join(where)}
            ORDER BY ml.created_at DESC
            LIMIT ${idx} OFFSET ${idx + 1}
        """
        rows = await db.fetch(query, *params)
        return [_normalize_row(r) for r in rows]

    @staticmethod
    async def count_for_user(
        user_id: str,
        *,
        project_id: Optional[str] = None,
        item_type: Optional[str] = None,
        source: Optional[str] = None,
        permission_scope: Optional[str] = None,
        is_favorite: Optional[bool] = None,
        keyword: Optional[str] = None,
        tag: Optional[str] = None,
        episode_id: Optional[str] = None,
        include_shared: bool = False,
        folder_id: Optional[str] = None,
        org_id: Optional[str] = None,
    ) -> int:




        db = get_db_manager()

        if org_id is None:
            visibility = """(
                ml.user_id = $1
                OR (
                    ml.permission_scope = 'project'
                    AND ml.project_id IN (
                        SELECT project_id FROM project_members WHERE user_id = $1
                    )
                )
            )"""
            params: List[Any] = [user_id]
            idx = 2
        else:
            visibility = """(
                ml.user_id = $1
                OR ml.library_item_id IN (
                    SELECT resource_id FROM resource_shares
                    WHERE resource_type='media'
                      AND share_target_type='org' AND share_target_id=$2
                )
                OR ml.project_id IN (
                    SELECT resource_id FROM resource_shares
                    WHERE resource_type='project'
                      AND share_target_type='org' AND share_target_id=$2
                )
            )"""
            params = [user_id, org_id]
            idx = 3

        extra_where: List[str] = []
        if project_id:
            extra_where.append(f"ml.project_id = ${idx}")
            params.append(project_id)
            idx += 1
        if episode_id:
            if include_shared:
                extra_where.append(f"(ml.episode_id = ${idx} OR ml.episode_id IS NULL)")
            else:
                extra_where.append(f"ml.episode_id = ${idx}")
            params.append(episode_id)
            idx += 1
        if folder_id is not None:
            if folder_id == "__unfiled__":
                extra_where.append("ml.folder_id IS NULL")
            else:
                extra_where.append(f"ml.folder_id = ${idx}")
                params.append(folder_id)
                idx += 1
        if item_type:
            extra_where.append(f"ml.item_type = ${idx}")
            params.append(item_type)
            idx += 1
        if source:
            extra_where.append(f"ml.source = ${idx}")
            params.append(source)
            idx += 1
        if permission_scope:
            extra_where.append(f"ml.permission_scope = ${idx}")
            params.append(permission_scope)
            idx += 1
        if is_favorite is not None:
            extra_where.append(f"ml.is_favorite = ${idx}")
            params.append(is_favorite)
            idx += 1
        if keyword:
            extra_where.append(f"(ml.title ILIKE ${idx} OR ml.description ILIKE ${idx})")
            params.append(f"%{keyword}%")
            idx += 1
        if tag:
            extra_where.append(f"ml.tags @> ${idx}::jsonb")
            params.append(json.dumps([tag]))
            idx += 1

        extra = "".join(f" AND {clause}" for clause in extra_where)

        return await db.fetchval(
            f"""
            SELECT COUNT(*) FROM media_library_items ml
            JOIN files f ON f.file_id = ml.file_id
            WHERE ml.is_deleted = FALSE AND f.is_deleted = FALSE
              AND {visibility}{extra}
            """,
            *params,
        ) or 0

    @staticmethod
    async def update(
        library_item_id: str,
        fields: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:

        if not fields:
            return await MediaLibraryDAO.get(library_item_id)

        allowed = {
            'title', 'description', 'permission_scope', 'is_favorite',
            'tags', 'metadata', 'source_entity_type', 'source_entity_id',
            'project_id', 'episode_id', 'team_id', 'folder_id',
        }
        patch = {key: value for key, value in fields.items() if key in allowed}
        if not patch:
            return await MediaLibraryDAO.get(library_item_id)
        if "tags" in patch and patch["tags"] is None:
            patch["tags"] = []
        if "metadata" in patch and patch["metadata"] is None:
            patch["metadata"] = {}

        db = get_db_manager()
        await db.execute(
            """
            UPDATE media_library_items
            SET title = CASE WHEN $1::jsonb ? 'title' THEN ($1::jsonb)->>'title' ELSE title END,
                description = CASE WHEN $1::jsonb ? 'description' THEN ($1::jsonb)->>'description' ELSE description END,
                permission_scope = CASE WHEN $1::jsonb ? 'permission_scope' THEN ($1::jsonb)->>'permission_scope' ELSE permission_scope END,
                is_favorite = CASE WHEN $1::jsonb ? 'is_favorite' THEN (($1::jsonb)->>'is_favorite')::boolean ELSE is_favorite END,
                tags = CASE WHEN $1::jsonb ? 'tags' THEN ($1::jsonb)->'tags' ELSE tags END,
                metadata = CASE WHEN $1::jsonb ? 'metadata' THEN ($1::jsonb)->'metadata' ELSE metadata END,
                source_entity_type = CASE WHEN $1::jsonb ? 'source_entity_type' THEN ($1::jsonb)->>'source_entity_type' ELSE source_entity_type END,
                source_entity_id = CASE WHEN $1::jsonb ? 'source_entity_id' THEN ($1::jsonb)->>'source_entity_id' ELSE source_entity_id END,
                project_id = CASE WHEN $1::jsonb ? 'project_id' THEN ($1::jsonb)->>'project_id' ELSE project_id END,
                episode_id = CASE WHEN $1::jsonb ? 'episode_id' THEN ($1::jsonb)->>'episode_id' ELSE episode_id END,
                team_id = CASE WHEN $1::jsonb ? 'team_id' THEN ($1::jsonb)->>'team_id' ELSE team_id END,
                folder_id = CASE WHEN $1::jsonb ? 'folder_id' THEN ($1::jsonb)->>'folder_id' ELSE folder_id END
            WHERE library_item_id = $2
            """,
            json.dumps(patch, ensure_ascii=False, default=str),
            library_item_id,
        )
        return await MediaLibraryDAO.get(library_item_id)

    @staticmethod
    async def soft_delete(
        library_item_id: str,
        *,
        deleted_by: Optional[str] = None,
        deleted_reason: Optional[str] = None,
    ) -> None:




        db = get_db_manager()

        try:
            await db.execute(
                """
                UPDATE media_library_items
                SET is_deleted = TRUE,
                    deleted_at = CURRENT_TIMESTAMP,
                    deleted_by = $2,
                    deleted_reason = $3
                WHERE library_item_id = $1
                """,
                library_item_id, deleted_by, deleted_reason or "",
            )
        except Exception:
            await db.execute(
                """
                UPDATE media_library_items
                SET is_deleted = TRUE,
                    deleted_at = CURRENT_TIMESTAMP,
                    metadata = COALESCE(metadata, '{}'::jsonb)
                              || jsonb_build_object(
                                  'deleted_by', $2::text,
                                  'deleted_reason', $3::text
                              )
                WHERE library_item_id = $1
                """,
                library_item_id, deleted_by, deleted_reason or "",
            )

    @staticmethod
    async def increment_use_count(library_item_id: str, delta: int = 1) -> None:
        db = get_db_manager()
        await db.execute(
            "UPDATE media_library_items SET use_count = use_count + $2 WHERE library_item_id = $1",
            library_item_id, delta,
        )


class MediaLibraryUsageDAO:


    @staticmethod
    async def record(
        library_item_id: str,
        file_id: str,
        user_id: str,
        usage_context: str,
        *,
        project_id: Optional[str] = None,
        task_id: Optional[str] = None,
        target_entity_type: Optional[str] = None,
        target_entity_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        usage_id = f"mlu_{uuid.uuid4().hex[:16]}"
        row = await db.fetchrow(
            """
            INSERT INTO media_library_usages (
                usage_id, library_item_id, file_id, user_id, project_id,
                task_id, usage_context, target_entity_type, target_entity_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            RETURNING *
            """,
            usage_id, library_item_id, file_id, user_id, project_id,
            task_id, usage_context, target_entity_type, target_entity_id,
        )
        return dict(row) if row else None

    @staticmethod
    async def list_for_item(library_item_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        db = get_db_manager()
        rows = await db.fetch(
            """
            SELECT * FROM media_library_usages
            WHERE library_item_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            """,
            library_item_id, limit,
        )
        return [dict(r) for r in rows]
