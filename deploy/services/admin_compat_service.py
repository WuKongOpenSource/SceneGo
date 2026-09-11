"""Business logic for legacy admin compatibility endpoints.

The router resolves an authenticated admin or super-admin dependency before it
calls this module. Keeping identity policy at that single HTTP boundary avoids
the former fixed-username check and prevents service helpers from becoming a
second, divergent authorization implementation.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional

from services.user_profile_service import USERNAME_RE
from services.model_access_service import normalize_model_access_permissions


class AdminCompatServiceError(RuntimeError):
    pass


class InvalidGroupBy(AdminCompatServiceError):
    pass


class MissingUserCredentials(AdminCompatServiceError):
    pass


class WeakPassword(AdminCompatServiceError):
    pass


class InvalidUserFields(AdminCompatServiceError):
    pass


class UsernameExists(AdminCompatServiceError):
    pass


class UserCreationFailed(AdminCompatServiceError):
    pass


class SelfDeleteForbidden(AdminCompatServiceError):
    pass


class SystemUserDeleteForbidden(AdminCompatServiceError):
    pass


class UserDeleteFailed(AdminCompatServiceError):
    pass


def normalize_admin_user_record(record: Any) -> Dict[str, Any]:
    row = dict(record or {})
    status = str(row.get("status") or "active").lower()
    is_active = row.get("is_active")
    if is_active is None:
        is_active = status != "disabled"
    user_id = str(row.get("user_id") or row.get("id") or "")
    last_login = row.get("last_login_at") or row.get("lastLogin") or None
    last_login_ms = 0
    if isinstance(last_login, (datetime, str)) and last_login:
        try:
            parsed = last_login if isinstance(last_login, datetime) else datetime.fromisoformat(last_login.replace("Z", "+00:00"))
            # Legacy naive database timestamps are UTC, never the server's local time.
            parsed = parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
            last_login_ms = int(parsed.timestamp() * 1000)
            last_login = parsed.isoformat().replace("+00:00", "Z")
        except (ValueError, OverflowError):
            last_login_ms = 0
    return {
        "id": user_id,
        "user_id": user_id,
        "username": str(row.get("username") or ""),
        "email": str(row.get("email") or ""),
        "phone_number": str(row.get("phone_number") or ""),
        "role": str(row.get("role") or "user"),
        "status": status,
        "isActive": bool(is_active),
        "permissions": normalize_model_access_permissions(row.get("permissions") or {}),
        "created_at": row.get("created_at"),
        "last_login_at": last_login,
        "lastLogin": last_login_ms,
        "stats": {"todayCount": 0, "totalCount": 0, "byModel": {}},
    }


async def list_admin_users_response(
    *,
    user_dao: Any,
    keyword: Optional[str] = None,
    role: Optional[str] = None,
    status_filter: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> Dict[str, Any]:
    bounded_limit = max(1, min(int(limit), 500))
    bounded_offset = max(0, int(offset))
    rows = await user_dao.admin_list_users(
        keyword=keyword,
        role=role,
        status_filter=status_filter,
        limit=bounded_limit,
        offset=bounded_offset,
    )
    total = await user_dao.admin_count_users(
        keyword=keyword,
        role=role,
        status_filter=status_filter,
    )
    return {
        "success": True,
        "users": [normalize_admin_user_record(row) for row in rows],
        "total": int(total or 0),
        "limit": bounded_limit,
        "offset": bounded_offset,
    }


async def get_admin_stats_response(
    username: str,
    *,
    group_by: Optional[str],
    super_admin: str,
    active_users_count: int,
    admin_stats_dao: Any,
    logger: Any,
) -> Dict[str, Any]:
    if group_by not in (None, "none", "user", "org"):
        raise InvalidGroupBy("group_by 必须是 'none'|'user'|'org'")

    stats = await admin_stats_dao.get_summary_stats(
        requesting_username=username,
        super_admin_username=super_admin,
        active_users_count=active_users_count,
    )

    breakdown = []
    if group_by in ("user", "org"):
        try:
            breakdown = await admin_stats_dao.get_stats_breakdown(
                group_by=group_by,
                requesting_username=username,
                super_admin_username=super_admin,
            )
        except Exception as exc:
            logger.warning("stats breakdown failed group_by=%s: %s", group_by, exc)
            breakdown = []

    return {
        "success": True,
        "stats": stats,
        "group_by": group_by or "none",
        "breakdown": breakdown,
    }


async def get_admin_logs_response(
    username: str,
    *,
    limit: int,
    super_admin: str,
    admin_stats_dao: Any,
) -> Dict[str, Any]:
    logs = await admin_stats_dao.get_generation_logs(
        requesting_username=username,
        super_admin_username=super_admin,
        limit=limit,
    )
    return {"success": True, "logs": logs}


async def create_admin_user_response(
    user_data: Dict[str, Any],
    *,
    request: Any,
    admin_username: str,
    super_admin: str,
    default_users: Dict[str, str],
    user_dao: Any,
    audit_record: Optional[Callable[..., Any]],
    logger: Any,
) -> Dict[str, Any]:
    new_username = str(user_data.get("username") or "").strip()
    password = user_data.get("password")
    email = str(user_data.get("email") or f"{new_username}@studio.com").strip()
    role = str(user_data.get("role") or "user").strip()

    if not new_username or not password:
        raise MissingUserCredentials("用户名和密码为必填项")
    if not USERNAME_RE.fullmatch(new_username):
        raise InvalidUserFields("用户名需为 2-40 位中文、字母、数字、下划线或连字符")
    if not isinstance(password, str) or not 8 <= len(password) <= 128:
        raise WeakPassword("密码长度必须为 8-128 位")
    if len(email) > 320 or any(ord(character) < 32 for character in email):
        raise InvalidUserFields("邮箱格式或长度无效")
    if role not in {"user", "admin", "super_admin"}:
        raise InvalidUserFields("无效的账号角色")
    if new_username in default_users:
        raise UsernameExists("用户名已存在")

    try:
        lookup_any = getattr(user_dao, "get_user_by_username_any", None)
        existing_user = await lookup_any(new_username) if callable(lookup_any) else None
        if existing_user:
            raise UsernameExists("用户名已存在")
        user = await user_dao.create_user(
            username=new_username,
            password=password,
            email=email,
        )
        if not user or not user.get("user_id"):
            raise UserCreationFailed("database did not return the created account")
        if role != "user":
            role_updated = await user_dao.set_role(str(user["user_id"]), role)
            if not role_updated:
                raise RuntimeError("database did not persist the requested role")
        logger.info("用户 %s 已创建(ID: %s...)", new_username, user["user_id"][:12])
    except UsernameExists:
        raise
    except Exception as exc:
        logger.error("创建数据库用户失败: %s", exc)
        raise

    if audit_record is not None:
        try:
            await audit_record(
                request,
                admin_user_id=admin_username,
                action="user_create",
                target_type="user",
                target_id=str(user["user_id"]),
                after={"username": new_username, "email": email, "role": role},
            )
        except Exception as exc:
            logger.warning("审计记录失败(user_create): %s", exc)

    return {
        "success": True,
        "message": "用户创建成功",
        "user": {
            "id": user["user_id"],
            "user_id": user["user_id"],
            "username": new_username,
            "email": email,
            "role": role,
            "status": "active",
            "isActive": True,
            "permissions": normalize_model_access_permissions({}),
        },
    }


async def delete_admin_user_response(
    user_id: str,
    *,
    admin_username: str,
    super_admin: str,
    user_dao: Any,
    logger: Any,
) -> Dict[str, Any]:
    if user_id == admin_username:
        raise SelfDeleteForbidden("不能删除自己的账号")
    if user_id in {"admin", super_admin}:
        raise SystemUserDeleteForbidden("不能删除系统管理员账号")

    try:
        target_user = await user_dao.get_user_by_id(user_id)
        if not target_user:
            raise UserDeleteFailed("用户不存在或数据库不可用")
        target_username = str(target_user.get("username") or "")
        if target_username == admin_username:
            raise SelfDeleteForbidden("不能删除自己的账号")
        if target_username in {"admin", super_admin}:
            raise SystemUserDeleteForbidden("不能删除系统管理员账号")

        result = await user_dao.delete_user_by_id(user_id)
    except (SelfDeleteForbidden, SystemUserDeleteForbidden, UserDeleteFailed):
        raise
    except Exception as exc:
        logger.error("数据库删除用户失败: %s", exc)
        raise UserDeleteFailed("数据库删除失败") from exc

    if result is None:
        logger.error("数据库未连接，无法删除用户 %s", user_id)
        raise UserDeleteFailed("数据库不可用，用户未删除")
    deleted_one_row = result == 1 or (
        isinstance(result, str) and result.rsplit(" ", 1)[-1] == "1"
    )
    if not deleted_one_row:
        logger.error("数据库未删除目标用户 %s，结果: %s", user_id, result)
        raise UserDeleteFailed("用户未删除")

    logger.info("管理员 %s 删除了用户 %s，影响行数 %s", admin_username, user_id, result)
    return {"success": True, "message": f"用户 {user_id} 已从数据库删除"}
