


import uuid
import json
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from db_manager import get_db_manager
from services.password_service import hash_password, verify_password_hash

logger = logging.getLogger(__name__)

class UserDAO:


    @staticmethod
    async def create_user(
        username: str,
        password: str,
        email: Optional[str] = None,
        user_id: Optional[str] = None,
        password_hash: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:









        db = get_db_manager()
        if not db:
            logger.warning("create_user skipped because database manager is unavailable: %s", username)
            return None


        if not user_id:
            user_id = f"user_{uuid.uuid4().hex[:12]}"


        if not password_hash:
            password_hash = hash_password(password)

        query = """
            INSERT INTO users (user_id, username, password_hash, email, legacy_login_enabled)
            VALUES ($1, $2, $3, $4, TRUE)
            RETURNING id, user_id, username, email, created_at
        """
        return await db.fetchrow(query, user_id, username, password_hash, email)

    @staticmethod
    async def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:

        db = get_db_manager()
        if not db:
            logger.warning("get_user_by_id skipped because database manager is unavailable: %s", user_id)
            return None
        query = """
            SELECT id, user_id, username, email, avatar_url,
                   storage_quota_gb, used_storage_bytes, created_at,
                   last_login_at, is_active, session_version
            FROM users
            WHERE user_id = $1 AND is_active = TRUE
        """
        return await db.fetchrow(query, user_id)

    @staticmethod
    async def get_user_profile_by_id(user_id: str) -> Optional[Dict[str, Any]]:
        """Return current-user profile fields, including optional account columns."""
        db = get_db_manager()
        if not db:
            logger.warning("get_user_profile_by_id skipped because database manager is unavailable: %s", user_id)
            return None
        try:
            row = await db.fetchrow(
                """
                SELECT id, user_id, username, email, avatar_url,
                       phone_number, phone_verified, phone_verified_at,
                       email_verified, email_verified_at,
                       email_notification_preferences,
                       storage_quota_gb, used_storage_bytes, created_at,
                       updated_at, last_login_at, is_active
                FROM users
                WHERE user_id = $1 AND is_active = TRUE
                """,
                user_id,
            )
            return dict(row) if row else None
        except Exception as exc:
            logger.warning("get_user_profile_by_id fell back to base fields for %s: %s", user_id, exc)
            row = await db.fetchrow(
                """
                SELECT id, user_id, username, email, avatar_url,
                       storage_quota_gb, used_storage_bytes, created_at,
                       updated_at, last_login_at, is_active
                FROM users
                WHERE user_id = $1 AND is_active = TRUE
                """,
                user_id,
            )
            if not row:
                return None
            data = dict(row)
            data.setdefault("phone_number", None)
            data.setdefault("phone_verified", False)
            data.setdefault("phone_verified_at", None)
            data.setdefault("email_verified", False)
            data.setdefault("email_verified_at", None)
            data.setdefault("email_notification_preferences", {})
            return data

    @staticmethod
    async def get_user_with_password_by_id(user_id: str) -> Optional[Dict[str, Any]]:
        """Return password hash for current-user password checks."""
        db = get_db_manager()
        if not db:
            logger.warning("get_user_with_password_by_id skipped because database manager is unavailable: %s", user_id)
            return None
        row = await db.fetchrow(
            """
            SELECT user_id, username, password_hash
            FROM users
            WHERE user_id = $1 AND is_active = TRUE
            """,
            user_id,
        )
        return dict(row) if row else None

    @staticmethod
    async def update_self_profile(user_id: str, **kwargs) -> bool:
        """Update editable self-service account fields for the current user."""
        db = get_db_manager()
        if not db:
            logger.warning("update_self_profile skipped because database manager is unavailable: %s", user_id)
            return False

        allowed = {
            "username",
            "phone_number",
            "phone_verified",
            "phone_verified_at",
            "email",
            "avatar_url",
        }
        fields = []
        values = []
        for key, value in kwargs.items():
            if key not in allowed:
                continue
            fields.append(f"{key} = ${len(values) + 1}")
            values.append(value)

        if not fields:
            return False

        values.append(user_id)
        query = f"""
            UPDATE users
            SET {', '.join(fields)}, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ${len(values)}
        """
        result = await db.execute(query, *values)
        return result == "UPDATE 1"

    @staticmethod
    async def admin_get_user_detail(user_id: str) -> Optional[Dict[str, Any]]:
        """Return the admin detail shape for a user, falling back to base fields."""
        base_user = await UserDAO.get_user_by_id(user_id)
        if not base_user:
            return None

        db = get_db_manager()
        if not db:
            return base_user
        try:
            row = await db.fetchrow(
                """
                SELECT user_id, username, email, avatar_url, role, status,
                       disabled_reason, disabled_at, disabled_by, plan_tier,
                       phone_number, phone_verified, phone_verified_at,
                       email_verified, email_verified_at, legacy_login_enabled,
                       storage_quota_gb, used_storage_bytes, created_at,
                       last_login_at, is_active, permissions, session_version
                FROM users
                WHERE user_id = $1
                """,
                user_id,
            )
            return dict(row) if row else base_user
        except Exception as exc:
            logger.warning("admin_get_user_detail fell back to base user for %s: %s", user_id, exc)
            return base_user

    @staticmethod
    async def delete_user_by_id(user_id: str) -> Optional[str]:
        """Hard-delete a user row by user_id for the legacy admin endpoint."""
        db = get_db_manager()
        if not db:
            logger.warning("delete_user_by_id skipped because database manager is unavailable: %s", user_id)
            return None
        return await db.execute(
            "DELETE FROM users WHERE user_id = $1",
            user_id,
        )

    @staticmethod
    async def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:

        db = get_db_manager()
        if not db:
            logger.warning("get_user_by_username skipped because database manager is unavailable: %s", username)
            return None

        try:
            query = """
                SELECT id, user_id, username, password_hash, email, avatar_url,
                       storage_quota_gb, used_storage_bytes, created_at,
                       last_login_at, is_active,
                       role, status, disabled_reason,
                       phone_number, phone_verified, phone_verified_at,
                       legacy_login_enabled, email_verified, email_verified_at,
                       email_notification_preferences, session_version
                FROM users
                WHERE username = $1 AND is_active = TRUE
            """
            return await db.fetchrow(query, username)
        except Exception:
            query = """
                SELECT id, user_id, username, password_hash, email, avatar_url,
                       storage_quota_gb, used_storage_bytes, created_at,
                       last_login_at, is_active
                FROM users
                WHERE username = $1 AND is_active = TRUE
            """
            return await db.fetchrow(query, username)

    @staticmethod
    async def get_user_by_username_any(username: str) -> Optional[Dict[str, Any]]:
        """Return an account by login name regardless of active status.

        Administrative uniqueness checks must include disabled accounts; the
        database unique constraint does not stop applying when an account is
        disabled.
        """
        db = get_db_manager()
        if not db:
            logger.warning("get_user_by_username_any skipped because database manager is unavailable: %s", username)
            return None
        row = await db.fetchrow(
            """
            SELECT user_id, username
            FROM users
            WHERE username = $1
            """,
            username,
        )
        return dict(row) if row else None

    @staticmethod
    async def get_user_by_phone(phone_number: str) -> Optional[Dict[str, Any]]:
        """Return an active user by the verified, normalized phone login identity."""
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """
            SELECT id, user_id, username, password_hash, email, role, status,
                   disabled_reason, phone_number, phone_verified, phone_verified_at,
                   legacy_login_enabled, email_verified, email_verified_at,
                   email_notification_preferences, session_version
            FROM users
            WHERE phone_number = $1 AND phone_verified = TRUE AND is_active = TRUE
            """,
            phone_number,
        )
        return dict(row) if row else None

    @staticmethod
    async def get_user_by_verified_email(email: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """
            SELECT user_id, username, email
            FROM users
            WHERE lower(email) = lower($1) AND email_verified = TRUE AND is_active = TRUE
            """,
            email,
        )
        return dict(row) if row else None

    @staticmethod
    async def get_user_auth_by_id(user_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """
            SELECT user_id, username, password_hash, email, role, status,
                   disabled_reason, phone_number, phone_verified,
                   legacy_login_enabled, email_verified,
                   email_notification_preferences, session_version
            FROM users
            WHERE user_id = $1 AND is_active = TRUE
            """,
            user_id,
        )
        return dict(row) if row else None

    @staticmethod
    async def get_session_identity(subject: str) -> Optional[Dict[str, Any]]:
        """Resolve a token subject without hiding disabled or revoked accounts."""
        db = get_db_manager()
        if not db or not subject:
            return None
        row = await db.fetchrow(
            """
            SELECT user_id, username, role, status, is_active, session_version
            FROM users
            WHERE user_id = $1 OR username = $1
            ORDER BY CASE WHEN user_id = $1 THEN 0 ELSE 1 END
            LIMIT 1
            """,
            subject,
        )
        return dict(row) if row else None

    @staticmethod
    async def create_phone_user(
        *,
        phone_number: str,
        username: str,
        password: str,
        email: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Create a phone-first account with a stable opaque user id."""
        db = get_db_manager()
        if not db:
            return None
        stable_user_id = user_id or f"user_{uuid.uuid4().hex[:16]}"
        row = await db.fetchrow(
            """
            INSERT INTO users (
                user_id, username, password_hash, email,
                phone_number, phone_verified, phone_verified_at,
                legacy_login_enabled, email_verified, permissions
            )
            VALUES (
                $1, $2, $3, $4, $5, TRUE, CURRENT_TIMESTAMP, FALSE, FALSE,
                '{"accessMode":"inherit","allowedModels":[],"priority":"normal","canExport":true}'::jsonb
            )
            RETURNING user_id, username, email, phone_number, phone_verified,
                      email_verified, created_at
            """,
            stable_user_id,
            username,
            hash_password(password),
            email,
            phone_number,
        )
        return dict(row) if row else None

    @staticmethod
    async def bind_verified_phone(user_id: str, phone_number: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """
            UPDATE users
            SET phone_number = $2,
                phone_verified = TRUE,
                phone_verified_at = CURRENT_TIMESTAMP,
                legacy_login_enabled = FALSE,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1 AND is_active = TRUE
            RETURNING user_id, username, phone_number, phone_verified,
                      legacy_login_enabled, email, email_verified
            """,
            user_id,
            phone_number,
        )
        return dict(row) if row else None

    @staticmethod
    async def set_email_binding(
        user_id: str,
        email: Optional[str],
        *,
        verified: bool = False,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """
            UPDATE users
            SET email = $2,
                email_verified = $3,
                email_verified_at = CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1 AND is_active = TRUE
            RETURNING user_id, email, email_verified, email_verified_at,
                      email_notification_preferences
            """,
            user_id,
            email,
            verified,
        )
        return dict(row) if row else None

    @staticmethod
    async def update_email_notification_preferences(user_id: str, preferences: Dict[str, bool]) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            """
            UPDATE users
            SET email_notification_preferences = $2::jsonb,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1 AND is_active = TRUE
            """,
            user_id,
            json.dumps(preferences),
        )
        return result == "UPDATE 1"

    @staticmethod
    async def is_admin_user(username: str) -> bool:
        """Return whether the authoritative active account has an admin role.

        Never infer privilege from a fixed username such as ``admin``. Public
        source makes those names obvious, and name-based authorization would
        turn a compatibility convention into an access-control bypass.
        """
        if not username:
            return False
        user = await UserDAO.get_session_identity(username)
        if not user or user.get("is_active") is not True:
            return False
        if str(user.get("status") or "active").lower() != "active":
            return False
        return user.get("role") in ("admin", "super_admin")

    @staticmethod
    async def verify_password(username: str, password: str) -> Optional[Dict[str, Any]]:

        user = await UserDAO.get_user_by_username(username)
        if not user:
            return None

        valid, needs_upgrade = verify_password_hash(password, user['password_hash'])
        if valid:
            if needs_upgrade:
                await UserDAO.update_password_hash(user['user_id'], hash_password(password))

            await UserDAO.update_last_login(user['user_id'])
            return user
        return None

    @staticmethod
    async def update_last_login(user_id: str):

        db = get_db_manager()
        if not db:
            logger.warning("update_last_login skipped because database manager is unavailable: %s", user_id)
            return False
        query = """
            UPDATE users
            SET last_login_at = $1
            WHERE user_id = $2
        """
        # The legacy column is TIMESTAMP without timezone. Persist a naive UTC value
        # and let API serializers attach the UTC marker before sending it to clients.
        utc_now = datetime.now(timezone.utc).replace(tzinfo=None)
        await db.execute(query, utc_now, user_id)

    @staticmethod
    async def get_storage_stats(user_id: str) -> Dict[str, Any]:

        db = get_db_manager()
        query = """
            SELECT * FROM user_storage_stats
            WHERE user_id = $1
        """
        return await db.fetchrow(query, user_id)

    @staticmethod
    async def update_user_profile(user_id: str, **kwargs) -> bool:

        db = get_db_manager()


        fields = []
        values = []
        param_idx = 1

        for key, value in kwargs.items():
            if key in ['email', 'avatar_url', 'storage_quota_gb']:
                fields.append(f"{key} = ${param_idx}")
                values.append(value)
                param_idx += 1

        if not fields:
            return False

        values.append(user_id)
        query = f"""
            UPDATE users
            SET {', '.join(fields)}, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ${param_idx}
        """

        await db.execute(query, *values)
        return True

    @staticmethod
    async def update_user_permissions(user_id: str, permissions: Dict[str, Any]) -> bool:






        db = get_db_manager()
        if not db:
            logger.warning("update_user_permissions skipped because database manager is unavailable: %s", user_id)
            return False



        query = """
            UPDATE users
            SET permissions = $1::jsonb,
                session_version = session_version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $2
        """
        result = await db.execute(query, json.dumps(permissions), user_id)


        verify_query = "SELECT permissions FROM users WHERE user_id = $1"
        row = await db.fetchrow(verify_query, user_id)
        if row:
            logger.info(f"🔍 验证用户 {user_id} 权限更新: {type(row['permissions']).__name__} = {row['permissions']}")

        return result == "UPDATE 1"

    @staticmethod
    async def get_user_permissions(user_id: str) -> Optional[Dict[str, Any]]:





        db = get_db_manager()
        if not db:
            return None

        query = """
            SELECT permissions FROM users WHERE user_id = $1
        """
        row = await db.fetchrow(query, user_id)
        if row and row['permissions']:
            return json.loads(row['permissions']) if isinstance(row['permissions'], str) else row['permissions']
        return None



    @staticmethod
    async def admin_list_users(
        keyword: Optional[str] = None,
        role: Optional[str] = None,
        status_filter: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:

        db = get_db_manager()
        where = ["1=1"]
        params: List[Any] = []
        idx = 1
        if keyword:
            where.append(f"(username ILIKE ${idx} OR email ILIKE ${idx} OR phone_number ILIKE ${idx})")
            params.append(f"%{keyword}%"); idx += 1
        if role:
            where.append(f"role = ${idx}"); params.append(role); idx += 1
        if status_filter:
            where.append(f"status = ${idx}"); params.append(status_filter); idx += 1
        params.extend([limit, offset])
        try:
            rows = await db.fetch(
                f"""
                SELECT user_id, username, email, avatar_url, role, status,
                       disabled_reason, disabled_at, disabled_by, plan_tier,
                       phone_number, phone_verified, phone_verified_at,
                       email_verified, email_verified_at, legacy_login_enabled,
                       storage_quota_gb, used_storage_bytes, created_at, last_login_at, is_active,
                       permissions
                FROM users
                WHERE {' AND '.join(where)}
                ORDER BY created_at DESC
                LIMIT ${idx} OFFSET ${idx + 1}
                """,
                *params,
            )
        except Exception:



            try:
                rows = await db.fetch(
                    f"""
                    SELECT user_id, username, email, avatar_url,
                           storage_quota_gb, used_storage_bytes, created_at, last_login_at, is_active,
                           permissions
                    FROM users
                    WHERE {' AND '.join(where)}
                    ORDER BY created_at DESC
                    LIMIT ${idx} OFFSET ${idx + 1}
                    """,
                    *params,
                )
            except Exception:
                rows = await db.fetch(
                    f"""
                    SELECT user_id, username, email, avatar_url,
                           storage_quota_gb, used_storage_bytes, created_at, last_login_at, is_active
                    FROM users
                    WHERE {' AND '.join(where)}
                    ORDER BY created_at DESC
                    LIMIT ${idx} OFFSET ${idx + 1}
                    """,
                    *params,
                )
        return [dict(r) for r in rows]

    @staticmethod
    async def admin_count_users(
        keyword: Optional[str] = None,
        role: Optional[str] = None,
        status_filter: Optional[str] = None,
    ) -> int:
        db = get_db_manager()
        where = ["1=1"]
        params: List[Any] = []
        idx = 1
        if keyword:
            where.append(f"(username ILIKE ${idx} OR email ILIKE ${idx} OR phone_number ILIKE ${idx})")
            params.append(f"%{keyword}%"); idx += 1
        if role:
            where.append(f"role = ${idx}"); params.append(role); idx += 1
        if status_filter:
            where.append(f"status = ${idx}"); params.append(status_filter); idx += 1
        try:
            n = await db.fetchval(
                f"SELECT COUNT(*) FROM users WHERE {' AND '.join(where)}",
                *params,
            )
        except Exception:
            n = await db.fetchval("SELECT COUNT(*) FROM users")
        return int(n or 0)

    @staticmethod
    async def set_role(user_id: str, role: str) -> bool:
        db = get_db_manager()
        result = await db.execute(
            """
            UPDATE users
            SET role = $2,
                session_version = session_version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1
            """,
            user_id, role,
        )
        return result == "UPDATE 1"

    @staticmethod
    async def set_status(
        user_id: str,
        status: str,
        *,
        disabled_reason: Optional[str] = None,
        disabled_by: Optional[str] = None,
    ) -> bool:
        db = get_db_manager()
        if status == 'active':
            result = await db.execute(
                """
                UPDATE users
                SET status = 'active',
                    disabled_reason = NULL,
                    disabled_at = NULL,
                    disabled_by = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $1
                """,
                user_id,
            )
        else:
            result = await db.execute(
                """
                UPDATE users
                SET status = $2,
                    session_version = session_version + 1,
                    disabled_reason = $3,
                    disabled_at = CURRENT_TIMESTAMP,
                    disabled_by = $4,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $1
                """,
                user_id, status, disabled_reason, disabled_by,
            )
        return result == "UPDATE 1"

    @staticmethod
    async def reset_password(user_id: str, new_password: str) -> bool:

        db = get_db_manager()
        new_hash = hash_password(new_password)
        result = await db.execute(
            """
            UPDATE users
            SET password_hash = $2,
                session_version = session_version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1
            """,
            user_id, new_hash,
        )
        return result == "UPDATE 1"

    @staticmethod
    async def update_password_hash(user_id: str, password_hash: str) -> bool:
        """Persist a precomputed password hash during transparent legacy upgrades."""
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "UPDATE users SET password_hash=$2, updated_at=CURRENT_TIMESTAMP WHERE user_id=$1",
            user_id,
            password_hash,
        )
        return result == "UPDATE 1"

    @staticmethod
    async def is_status_active(user_id: str) -> bool:

        db = get_db_manager()
        try:
            v = await db.fetchval(
                "SELECT status FROM users WHERE user_id = $1",
                user_id,
            )
            return (v or 'active') == 'active'
        except Exception:
            return True
