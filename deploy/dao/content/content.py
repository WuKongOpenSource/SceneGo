


import uuid
import json
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime
from db_manager import get_db_manager

logger = logging.getLogger(__name__)

class ProjectDAO:


    @staticmethod
    async def create_project(
        user_id: str,
        project_name: str,
        description: str = "",
        visibility: str = "private",
        settings: Optional[Dict[str, Any]] = None,
        group_id: Optional[str] = None,
    ) -> Dict[str, Any]:






        db = get_db_manager()
        project_id = f"proj_{uuid.uuid4().hex[:12]}"

        if visibility not in ('private', 'org-default'):
            visibility = 'private'
        query = """
            INSERT INTO projects (project_id, user_id, project_name, description, visibility, settings, group_id)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
            RETURNING id, project_id, project_name, description, visibility, settings, group_id, created_at
        """
        return await db.fetchrow(
            query,
            project_id,
            user_id,
            project_name,
            description,
            visibility,
            json.dumps(settings or {}, ensure_ascii=False),
            group_id,
        )

    @staticmethod
    async def get_user_projects(user_id: str, include_archived: bool = False) -> List[Dict[str, Any]]:

        db = get_db_manager()


        columns = ("p.id, p.project_id, p.user_id, p.project_name, p.description, p.cover_url, p.tags, "
                   "p.created_at, p.updated_at, p.last_accessed_at, p.is_archived, "
                   "(SELECT COUNT(*) FROM episodes e WHERE e.project_id = p.project_id) AS episode_count")
        archived_filter = "" if include_archived else "AND p.is_archived = FALSE"
        query = f"""
            SELECT {columns} FROM projects p
            WHERE p.user_id = $1 AND p.is_deleted IS NOT TRUE {archived_filter}
            ORDER BY p.last_accessed_at DESC NULLS LAST, p.created_at DESC
        """
        return await db.fetch(query, user_id)

    @staticmethod
    async def get_projects_for_org(
        user_id: str,
        org_id: str,
        include_archived: bool = False,
    ) -> List[Dict[str, Any]]:







        db = get_db_manager()
        columns = ("p.id, p.project_id, p.user_id, p.project_name, p.description, p.cover_url, p.tags, "
                   "p.created_at, p.updated_at, p.last_accessed_at, p.is_archived, "
                   "p.group_id, p.visibility")
        archived_clause = "" if include_archived else "p.is_archived = FALSE AND"
        query = f"""
            SELECT DISTINCT {columns}
            FROM projects p
            WHERE {archived_clause}
                  (
                    p.user_id = $1
                    OR p.project_id IN (
                        SELECT resource_id FROM resource_shares
                        WHERE resource_type='project'
                          AND share_target_type='org' AND share_target_id=$2
                    )
                    OR p.group_id IN (
                        SELECT group_id FROM project_groups
                        WHERE organization_id=$2
                    )
                    OR p.group_id IN (
                        SELECT resource_id FROM resource_shares
                        WHERE resource_type='group'
                          AND share_target_type='org' AND share_target_id=$2
                    )
                  )
            ORDER BY p.last_accessed_at DESC NULLS LAST, p.created_at DESC
        """
        return await db.fetch(query, user_id, org_id)

    @staticmethod
    async def get_project(project_id: str) -> Optional[Dict[str, Any]]:

        db = get_db_manager()
        query = "SELECT * FROM projects WHERE project_id = $1"
        return await db.fetchrow(query, project_id)

    @staticmethod
    async def update_project_access(project_id: str):

        db = get_db_manager()
        query = """
            UPDATE projects
            SET last_accessed_at = CURRENT_TIMESTAMP
            WHERE project_id = $1
        """
        await db.execute(query, project_id)

    @staticmethod
    async def update_project_metadata(project_id: str, fields: Dict[str, Any]) -> None:
        """Update editable project metadata fields."""
        allowed_columns = {
            "group_id": "group_id",
            "project_name": "project_name",
            "description": "description",
            "cover_url": "cover_url",
            "tags": "tags",
        }
        update_fields = {key: value for key, value in fields.items() if key in allowed_columns}
        if not update_fields:
            return None

        db = get_db_manager()
        sets: List[str] = []
        values: List[Any] = []
        for key, value in update_fields.items():
            idx = len(values) + 1
            if key == "tags":
                sets.append(f"{allowed_columns[key]} = ${idx}::jsonb")
                values.append(json.dumps(value, ensure_ascii=False) if value is not None else None)
            else:
                sets.append(f"{allowed_columns[key]} = ${idx}")
                values.append(value)

        values.append(project_id)
        query = f"UPDATE projects SET {', '.join(sets)} WHERE project_id = ${len(values)}"
        await db.execute(query, *values)

    @staticmethod
    async def save_or_update_project(
        user_id: str,
        project_id: str,
        project_name: str,
        project_data: Dict[str, Any],
        description: str = ""
    ) -> Dict[str, Any]:

        db = get_db_manager()


        project_data_json = json.dumps(project_data, ensure_ascii=False)


        existing = await db.fetchrow(
            "SELECT id FROM projects WHERE project_id = $1",
            project_id
        )

        if existing:

            query = """
                UPDATE projects
                SET project_name = $1,
                    description = $2,
                    settings = $3::jsonb,
                    last_accessed_at = CURRENT_TIMESTAMP
                WHERE project_id = $4 AND user_id = $5
                RETURNING *
            """
            return await db.fetchrow(
                query, project_name, description, project_data_json, project_id, user_id
            )
        else:

            query = """
                INSERT INTO projects (project_id, user_id, project_name, description, settings)
                VALUES ($1, $2, $3, $4, $5::jsonb)
                RETURNING *
            """
            result = await db.fetchrow(
                query, project_id, user_id, project_name, description, project_data_json
            )
            await db.execute(
                """INSERT INTO project_members (project_id, user_id, role)
                   VALUES ($1, $2, 'owner')
                   ON CONFLICT (project_id, user_id) DO NOTHING""",
                project_id, user_id
            )
            return result

    @staticmethod
    async def delete_project(project_id: str, user_id: str):






        db = get_db_manager()
        await db.execute("""
            UPDATE projects
            SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP
            WHERE project_id = $1 AND user_id = $2
        """, project_id, user_id)

    @staticmethod
    async def restore_project(project_id: str, user_id: str):

        db = get_db_manager()
        await db.execute("""
            UPDATE projects
            SET is_deleted = FALSE, deleted_at = NULL
            WHERE project_id = $1 AND user_id = $2
        """, project_id, user_id)

    @staticmethod
    async def archive_project(project_id: str, user_id: str):

        db = get_db_manager()
        query = """
            UPDATE projects
            SET is_archived = TRUE
            WHERE project_id = $1 AND user_id = $2
        """
        await db.execute(query, project_id, user_id)

    @staticmethod
    async def unarchive_project(project_id: str, user_id: str):
        db = get_db_manager()
        await db.execute(
            "UPDATE projects SET is_archived = FALSE WHERE project_id = $1 AND user_id = $2",
            project_id, user_id
        )

class VersionDAO:


    @staticmethod
    async def create_version(
        project_id: str,
        user_id: str,
        version_name: str = "",
        description: str = "",
        parent_version_id: Optional[str] = None
    ) -> Dict[str, Any]:

        db = get_db_manager()
        version_id = f"ver_{uuid.uuid4().hex[:12]}"


        version_number = await db.fetchval("""
            SELECT COALESCE(MAX(version_number), 0) + 1
            FROM versions
            WHERE project_id = $1
        """, project_id)


        await db.execute("""
            UPDATE versions
            SET is_current = FALSE
            WHERE project_id = $1
        """, project_id)


        query = """
            INSERT INTO versions (
                version_id, project_id, user_id, version_number,
                version_name, description, parent_version_id, is_current
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
            RETURNING *
        """
        return await db.fetchrow(
            query, version_id, project_id, user_id, version_number,
            version_name, description, parent_version_id
        )

    @staticmethod
    async def get_project_versions(project_id: str) -> List[Dict[str, Any]]:

        db = get_db_manager()
        query = """
            SELECT v.*,
                   COUNT(f.file_id) as file_count,
                   COUNT(tc.content_id) as text_count
            FROM versions v
            LEFT JOIN files f ON v.version_id = f.version_id AND f.is_deleted = FALSE
            LEFT JOIN text_contents tc ON v.version_id = tc.version_id AND tc.is_deleted = FALSE
            WHERE v.project_id = $1
            GROUP BY v.id
            ORDER BY v.version_number DESC
        """
        return await db.fetch(query, project_id)

    @staticmethod
    async def get_version(version_id: str) -> Optional[Dict[str, Any]]:

        db = get_db_manager()
        query = "SELECT * FROM versions WHERE version_id = $1"
        return await db.fetchrow(query, version_id)

    @staticmethod
    async def get_current_version(project_id: str) -> Optional[Dict[str, Any]]:

        db = get_db_manager()
        query = """
            SELECT * FROM versions
            WHERE project_id = $1 AND is_current = TRUE
            LIMIT 1
        """
        return await db.fetchrow(query, project_id)

    @staticmethod
    async def set_current_version(version_id: str):

        db = get_db_manager()


        project_id = await db.fetchval(
            "SELECT project_id FROM versions WHERE version_id = $1",
            version_id
        )


        await db.execute(
            "UPDATE versions SET is_current = FALSE WHERE project_id = $1",
            project_id
        )


        await db.execute(
            "UPDATE versions SET is_current = TRUE WHERE version_id = $1",
            version_id
        )

    @staticmethod
    async def delete_version(version_id: str):

        db = get_db_manager()


        await db.execute("""
            UPDATE files
            SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP
            WHERE version_id = $1
        """, version_id)


        await db.execute("""
            UPDATE text_contents
            SET is_deleted = TRUE
            WHERE version_id = $1
        """, version_id)


        await db.execute("DELETE FROM versions WHERE version_id = $1", version_id)

class FileDAO:


    @staticmethod
    async def create_file(
        version_id: str,
        user_id: str,
        file_type: str,
        file_name: str,
        file_path: str,
        file_url: str,
        file_size_bytes: int,
        mime_type: str = "",
        metadata: Dict = None,
        file_id: str = None,
        entity_type: str = None,
        entity_id: str = None,
        file_role: str = None,
        is_selected: bool = False,
        project_id: str = None,
        episode_id: str = None,
        source: str = None,
    ) -> Dict[str, Any]:

        db = get_db_manager()

        if not file_id:
            file_id = f"file_{uuid.uuid4().hex[:12]}"

        metadata_json = json.dumps(metadata or {}, ensure_ascii=False)

        query = """
            INSERT INTO files (
                file_id, version_id, user_id, file_type, file_name,
                file_path, file_url, file_size_bytes, mime_type, metadata,
                entity_type, entity_id, file_role, is_selected,
                project_id, episode_id, source
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
                    $11, $12, $13, $14, $15, $16, $17)
            RETURNING *
        """
        try:
            return await db.fetchrow(
                query, file_id, version_id, user_id, file_type, file_name,
                file_path, file_url, file_size_bytes, mime_type, metadata_json,
                entity_type, entity_id, file_role, is_selected,
                project_id, episode_id, source,
            )
        except Exception as e:
            if not any(name in str(e) for name in ("project_id", "episode_id", "source")):
                raise
            logger.warning("files ownership columns unavailable, falling back to legacy insert: %s", e)

        legacy_query = """
            INSERT INTO files (
                file_id, version_id, user_id, file_type, file_name,
                file_path, file_url, file_size_bytes, mime_type, metadata,
                entity_type, entity_id, file_role, is_selected
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
                    $11, $12, $13, $14)
            RETURNING *
        """
        return await db.fetchrow(
            legacy_query, file_id, version_id, user_id, file_type, file_name,
            file_path, file_url, file_size_bytes, mime_type, metadata_json,
            entity_type, entity_id, file_role, is_selected,
        )

    @staticmethod
    async def get_version_files(version_id: str, file_type: Optional[str] = None) -> List[Dict[str, Any]]:

        db = get_db_manager()

        if file_type:
            query = """
                SELECT * FROM files
                WHERE version_id = $1 AND file_type = $2 AND is_deleted = FALSE
                ORDER BY created_at DESC
            """
            return await db.fetch(query, version_id, file_type)
        else:
            query = """
                SELECT * FROM files
                WHERE version_id = $1 AND is_deleted = FALSE
                ORDER BY created_at DESC
            """
            return await db.fetch(query, version_id)

    @staticmethod
    async def get_file(file_id: str) -> Optional[Dict[str, Any]]:

        db = get_db_manager()
        if not db:
            logger.warning("get_file skipped because database manager is unavailable: %s", file_id)
            return None
        query = "SELECT * FROM files WHERE file_id = $1 AND is_deleted = FALSE"
        return await db.fetchrow(query, file_id)

    @staticmethod
    async def merge_metadata(file_id: str, metadata: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Merge selected metadata fields without overwriting generation metadata."""
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            """
            UPDATE files
            SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
            WHERE file_id = $1 AND is_deleted = FALSE
            RETURNING *
            """,
            file_id,
            json.dumps(metadata or {}, ensure_ascii=False),
        )

    @staticmethod
    async def get_file_by_name(file_name: str) -> Optional[Dict[str, Any]]:

        db = get_db_manager()
        query = """
            SELECT * FROM files
            WHERE file_name = $1 AND is_deleted = FALSE
            ORDER BY created_at DESC
            LIMIT 1
        """
        return await db.fetchrow(query, file_name)

    @staticmethod
    async def get_file_by_comfyui_filename(file_name: str) -> Optional[Dict[str, Any]]:
        """Resolve a ComfyUI physical filename to its local ownership record."""
        db = get_db_manager()
        return await db.fetchrow(
            """
            SELECT * FROM files
            WHERE is_deleted = FALSE
              AND (
                file_name = $1
                OR metadata->>'comfyui_filename' = $1
                OR metadata->>'physical_filename' = $1
              )
            ORDER BY created_at DESC
            LIMIT 1
            """,
            file_name,
        )

    @staticmethod
    def _file_url_lookup_candidates(url: str) -> List[str]:
        """Return lookup keys for stored file URLs after stripping signed tokens."""
        if not url:
            return []
        from urllib.parse import urlsplit

        raw = str(url).strip()
        parsed = urlsplit(raw)
        path = parsed.path or raw.split("?", 1)[0]
        if path.startswith("storage/"):
            path = f"/{path}"

        candidates: List[str] = []

        def add(value: str) -> None:
            if value and value not in candidates:
                candidates.append(value)

        add(path)
        if parsed.scheme and parsed.netloc and path:
            add(f"{parsed.scheme}://{parsed.netloc}{path}")

        for singular, plural in (
            ("/storage/image/", "/storage/images/"),
            ("/storage/video/", "/storage/videos/"),
            ("/storage/audio/", "/storage/audios/"),
        ):
            if path.startswith(singular):
                add(path.replace(singular, plural, 1))
            if path.startswith(plural):
                add(path.replace(plural, singular, 1))
        return candidates

    @staticmethod
    async def get_file_by_url(url: str, include_deleted: bool = False) -> Optional[Dict[str, Any]]:






        candidates = FileDAO._file_url_lookup_candidates(url)
        if not candidates:
            return None

        db = get_db_manager()
        if not db:
            return None
        query = """
            SELECT * FROM files
            WHERE (
                    split_part(file_url, '?', 1) = ANY($1::text[])
                    OR split_part(COALESCE(thumbnail_url, ''), '?', 1) = ANY($1::text[])
                  )
              AND ($2::boolean OR is_deleted = FALSE)
            ORDER BY is_deleted ASC, created_at DESC
            LIMIT 1
        """
        return await db.fetchrow(query, candidates, include_deleted)

    @staticmethod
    async def get_recent_files(limit: int = 500) -> List[Dict[str, Any]]:

        db = get_db_manager()
        query = """
            SELECT file_id, file_path, file_url, file_type, created_at
            FROM files WHERE is_deleted = FALSE
            ORDER BY created_at DESC LIMIT $1
        """
        return await db.fetch(query, limit)

    @staticmethod
    async def delete_file(file_id: str):

        db = get_db_manager()
        query = """
            UPDATE files
            SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP
            WHERE file_id = $1
        """
        await db.execute(query, file_id)

    @staticmethod
    async def soft_delete_user_files_by_path_fragment(user_id: str, path_fragment: str) -> int:
        """Soft-delete a user's file records whose stored path contains a generated file path."""
        if not path_fragment:
            return 0
        db = get_db_manager()
        if not db:
            return 0
        result = await db.execute(
            """
            UPDATE files
            SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP
            WHERE user_id = $1
              AND file_path LIKE $2
              AND is_deleted = FALSE
            """,
            user_id,
            f"%{path_fragment}%",
        )
        try:
            return int(str(result).split()[-1])
        except (IndexError, TypeError, ValueError):
            return 0

    @staticmethod
    async def permanently_delete_file(file_id: str):

        db = get_db_manager()
        await db.execute("DELETE FROM files WHERE file_id = $1", file_id)

    @staticmethod
    async def get_user_files(
        user_id: str,
        file_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict[str, Any]]:

        db = get_db_manager()
        if not db:
            logger.warning("get_user_files skipped because database manager is unavailable: %s", user_id)
            return []

        if file_type:
            query = """
                SELECT * FROM files
                WHERE user_id = $1 AND file_type = $2 AND is_deleted = FALSE
                ORDER BY created_at DESC
                LIMIT $3 OFFSET $4
            """
            return await db.fetch(query, user_id, file_type, limit, offset)
        else:
            query = """
                SELECT * FROM files
                WHERE user_id = $1 AND is_deleted = FALSE
                ORDER BY created_at DESC
                LIMIT $2 OFFSET $3
            """
            return await db.fetch(query, user_id, limit, offset)

class WorkspaceSessionDAO:


    @staticmethod
    def _config_key(user_id: str, scope: str = "") -> str:
        if scope:
            return f"workspace_session_{user_id}_{scope}"
        return f"workspace_session_{user_id}"

    @staticmethod
    async def save_session(user_id: str, session_data: Dict[str, Any], scope: str = ""):

        db = get_db_manager()
        config_key = WorkspaceSessionDAO._config_key(user_id, scope)

        session_data_json = json.dumps(session_data, ensure_ascii=False)

        query = """
            INSERT INTO system_configs (config_key, config_value, description)
            VALUES ($1, $2::jsonb, $3)
            ON CONFLICT (config_key)
            DO UPDATE SET config_value = $2::jsonb, updated_at = CURRENT_TIMESTAMP
        """
        await db.execute(
            query,
            config_key,
            session_data_json,
            f"Workspace session for user {user_id} scope {scope}" if scope else f"Workspace session for user {user_id}"
        )

    @staticmethod
    async def load_session(user_id: str, scope: str = "") -> Optional[Dict[str, Any]]:

        db = get_db_manager()
        config_key = WorkspaceSessionDAO._config_key(user_id, scope)

        query = "SELECT config_value FROM system_configs WHERE config_key = $1"
        result = await db.fetchrow(query, config_key)

        if result:
            config_value = result.get('config_value')
            if isinstance(config_value, str):
                return json.loads(config_value)
            return config_value
        return None

    @staticmethod
    async def delete_session(user_id: str, scope: str = ""):

        db = get_db_manager()
        config_key = WorkspaceSessionDAO._config_key(user_id, scope)

        query = "DELETE FROM system_configs WHERE config_key = $1"
        await db.execute(query, config_key)

class PromptTemplateDAO:


    @staticmethod
    async def save_template(user_id: str, template_type: str, content: str):

        db = get_db_manager()
        config_key = f"prompt_template_{user_id}_{template_type}"


        content_json = json.dumps({"content": content}, ensure_ascii=False)


        query = """
            INSERT INTO system_configs (config_key, config_value, description)
            VALUES ($1, $2::jsonb, $3)
            ON CONFLICT (config_key)
            DO UPDATE SET config_value = $2::jsonb, updated_at = CURRENT_TIMESTAMP
        """
        await db.execute(
            query,
            config_key,
            content_json,
            f"Prompt template {template_type} for user {user_id}"
        )

    @staticmethod
    async def load_template(user_id: str, template_type: str) -> Optional[str]:

        db = get_db_manager()
        config_key = f"prompt_template_{user_id}_{template_type}"

        query = "SELECT config_value FROM system_configs WHERE config_key = $1"
        result = await db.fetchrow(query, config_key)

        if result:
            config_value = result.get('config_value')
            if isinstance(config_value, dict):
                return config_value.get('content')
            return None
        return None

    @staticmethod
    async def delete_template(user_id: str, template_type: str):

        db = get_db_manager()
        config_key = f"prompt_template_{user_id}_{template_type}"

        query = "DELETE FROM system_configs WHERE config_key = $1"
        await db.execute(query, config_key)

class ProjectMemberDAO:


    @staticmethod
    async def add_member(
        project_id: str, user_id: str,
        role: str = 'member', responsibility: str = 'all'
    ) -> Dict[str, Any]:
        db = get_db_manager()
        query = """
            INSERT INTO project_members (project_id, user_id, role, responsibility)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (project_id, user_id) DO UPDATE
              SET role = $3, responsibility = $4, updated_at = CURRENT_TIMESTAMP
            RETURNING *
        """
        return await db.fetchrow(query, project_id, user_id, role, responsibility)

    @staticmethod
    async def remove_member(project_id: str, user_id: str):
        db = get_db_manager()
        await db.execute(
            "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
            project_id, user_id
        )

    @staticmethod
    async def update_member_role(project_id: str, user_id: str, role: str):
        db = get_db_manager()
        await db.execute("""
            UPDATE project_members SET role = $3, updated_at = CURRENT_TIMESTAMP
            WHERE project_id = $1 AND user_id = $2
        """, project_id, user_id, role)

    @staticmethod
    async def update_member_responsibility(project_id: str, user_id: str, responsibility: str):
        db = get_db_manager()
        await db.execute("""
            UPDATE project_members SET responsibility = $3, updated_at = CURRENT_TIMESTAMP
            WHERE project_id = $1 AND user_id = $2
        """, project_id, user_id, responsibility)

    @staticmethod
    async def get_project_members(project_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        query = """
            SELECT pm.*, u.username, u.avatar_url, u.email
            FROM project_members pm
            JOIN users u ON pm.user_id = u.user_id
            WHERE pm.project_id = $1
            ORDER BY
              CASE pm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
              pm.joined_at
        """
        return await db.fetch(query, project_id)

    @staticmethod
    async def get_member(project_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        query = """
            SELECT pm.*, u.username, u.avatar_url
            FROM project_members pm
            JOIN users u ON pm.user_id = u.user_id
            WHERE pm.project_id = $1 AND pm.user_id = $2
        """
        return await db.fetchrow(query, project_id, user_id)

    @staticmethod
    async def check_permission(project_id: str, user_id: str, required_role: str = 'readonly') -> bool:

        role_weight = {'owner': 4, 'admin': 3, 'member': 2, 'readonly': 1}
        member = await ProjectMemberDAO.get_member(project_id, user_id)
        if not member:
            return False
        return role_weight.get(member['role'], 0) >= role_weight.get(required_role, 0)

    @staticmethod
    async def get_user_accessible_projects(user_id: str, include_archived: bool = False) -> List[Dict[str, Any]]:

        db = get_db_manager()
        archive_filter = "" if include_archived else "AND p.is_archived = FALSE"
        query = f"""
            SELECT DISTINCT
                   p.id, p.project_id, p.user_id, p.project_name, p.description, p.cover_url, p.tags,
                   p.created_at, p.updated_at, p.last_accessed_at, p.is_archived,
                   pm.role as member_role, pm.responsibility,
                   p.group_id, p.visibility,
                   (SELECT pg.group_name FROM project_groups pg WHERE pg.group_id = p.group_id) AS group_name,
                   u.username as owner_name,
                   (SELECT COUNT(*) FROM project_members pm2 WHERE pm2.project_id = p.project_id) as member_count,
                   (SELECT COUNT(*) FROM episodes e WHERE e.project_id = p.project_id) as episode_count
            FROM projects p
            JOIN project_members pm ON p.project_id = pm.project_id AND pm.user_id = $1
            JOIN users u ON p.user_id = u.user_id
            WHERE p.is_deleted IS NOT TRUE {archive_filter}
            ORDER BY p.last_accessed_at DESC NULLS LAST, p.updated_at DESC
        """
        return await db.fetch(query, user_id)

    @staticmethod
    async def get_org_accessible_projects(
        user_id: str,
        org_id: str,
        include_archived: bool = False,
    ) -> List[Dict[str, Any]]:







        db = get_db_manager()
        archive_filter = "" if include_archived else "AND p.is_archived = FALSE"
        query = f"""
            SELECT DISTINCT
                   p.id, p.project_id, p.user_id, p.project_name, p.description, p.cover_url, p.tags,
                   p.created_at, p.updated_at, p.last_accessed_at, p.is_archived,
                   p.group_id, p.visibility,
                   COALESCE(pm.role, 'member')      AS member_role,
                   (SELECT pg.group_name FROM project_groups pg WHERE pg.group_id = p.group_id) AS group_name,
                   COALESCE(pm.responsibility, '') AS responsibility,
                   u.username as owner_name,
                   (SELECT COUNT(*) FROM project_members pm2 WHERE pm2.project_id = p.project_id) AS member_count
            FROM projects p
            LEFT JOIN project_members pm ON pm.project_id = p.project_id AND pm.user_id = $1
            LEFT JOIN users u ON p.user_id = u.user_id
            WHERE p.is_deleted IS NOT TRUE {archive_filter}
              AND (
                p.user_id = $1
                OR pm.user_id = $1
                OR p.project_id IN (
                    SELECT resource_id FROM resource_shares
                    WHERE resource_type='project'
                      AND share_target_type='org' AND share_target_id=$2
                )
                OR p.group_id IN (
                    SELECT group_id FROM project_groups WHERE organization_id=$2
                )
                OR p.group_id IN (
                    SELECT resource_id FROM resource_shares
                    WHERE resource_type='group'
                      AND share_target_type='org' AND share_target_id=$2
                )
              )
            ORDER BY p.last_accessed_at DESC NULLS LAST, p.updated_at DESC
        """
        return await db.fetch(query, user_id, org_id)


class TextContentDAO:


    @staticmethod
    async def create_text_content(
        version_id: str,
        user_id: str,
        content_type: str,
        content: str,
        title: str = "",
        metadata: Dict = None
    ) -> Dict[str, Any]:

        db = get_db_manager()
        content_id = f"text_{uuid.uuid4().hex[:12]}"
        word_count = len(content)


        metadata_json = json.dumps(metadata or {}, ensure_ascii=False)

        query = """
            INSERT INTO text_contents (
                content_id, version_id, user_id, content_type,
                title, content, word_count, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            RETURNING *
        """
        return await db.fetchrow(
            query, content_id, version_id, user_id, content_type,
            title, content, word_count, metadata_json
        )

    @staticmethod
    async def get_version_texts(version_id: str) -> List[Dict[str, Any]]:

        db = get_db_manager()
        query = """
            SELECT * FROM text_contents
            WHERE version_id = $1 AND is_deleted = FALSE
            ORDER BY created_at DESC
        """
        return await db.fetch(query, version_id)

    @staticmethod
    async def get_text_content(content_id: str) -> Optional[Dict[str, Any]]:

        db = get_db_manager()
        query = "SELECT * FROM text_contents WHERE content_id = $1 AND is_deleted = FALSE"
        return await db.fetchrow(query, content_id)

    @staticmethod
    async def update_text_content(content_id: str, content: str, title: str = None):

        db = get_db_manager()
        word_count = len(content)

        if title:
            query = """
                UPDATE text_contents
                SET content = $1, title = $2, word_count = $3,
                    updated_at = CURRENT_TIMESTAMP
                WHERE content_id = $4
            """
            await db.execute(query, content, title, word_count, content_id)
        else:
            query = """
                UPDATE text_contents
                SET content = $1, word_count = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE content_id = $3
            """
            await db.execute(query, content, word_count, content_id)

    @staticmethod
    async def delete_text_content(content_id: str):

        db = get_db_manager()
        query = """
            UPDATE text_contents
            SET is_deleted = TRUE
            WHERE content_id = $1
        """
        await db.execute(query, content_id)
