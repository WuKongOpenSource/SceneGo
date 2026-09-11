"""Compatibility admin routes still used by the React admin shell.

These endpoints preserve legacy `/api/admin/*` URLs while moving their handlers
out of cluster_main.py. New admin functionality should live in admin_routes.py
or a focused admin router instead of growing this compatibility module.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from core import jwt_auth
from core.session_cookie import set_session_cookie
from services import admin_user_service
from services.session_auth_service import issue_session_token

from services.admin_compat_service import (
    InvalidUserFields,
    InvalidGroupBy,
    MissingUserCredentials,
    SelfDeleteForbidden,
    SystemUserDeleteForbidden,
    UserDeleteFailed,
    UsernameExists,
    UserCreationFailed,
    WeakPassword,
    create_admin_user_response,
    delete_admin_user_response,
    get_admin_logs_response,
    get_admin_stats_response,
    list_admin_users_response,
    normalize_admin_user_record,
)
from services.model_access_service import validate_model_access_permissions


def create_admin_compat_router(
    *,
    require_auth: Callable[..., Any],
    require_super_admin: Callable[..., Any] | None = None,
    online_users: Dict[str, Any],
    default_users: Dict[str, str],
    admin_stats_dao: Any,
    user_dao: Any,
    audit_record: Callable[..., Any] | None,
    logger: Any,
    include_user_management: bool = False,
) -> APIRouter:
    router = APIRouter()
    super_admin_dependency = require_super_admin or require_auth

    async def record_audit(request: Request, admin_username: str, action: str, user_id: str, **extra: Any) -> None:
        if audit_record is None:
            return
        try:
            await audit_record(
                request,
                admin_user_id=admin_username,
                action=action,
                target_type="user",
                target_id=user_id,
                **extra,
            )
        except Exception as exc:
            logger.warning("审计记录失败(%s): %s", action, exc)

    async def load_target_user(user_id: str) -> Dict[str, Any]:
        user = await user_dao.get_user_by_id(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        return dict(user)

    def reject_bootstrap_mutation(user: Dict[str, Any]) -> None:
        if str(user.get("username") or "") == "admin":
            raise HTTPException(status_code=400, detail="内置 admin 账号不能执行此操作")

    @router.get("/api/admin/stats")
    async def get_admin_stats(
        username: str = Depends(require_auth),
        group_by: Optional[str] = None,
    ):
        try:
            return await get_admin_stats_response(
                username,
                group_by=group_by,
                super_admin=username,
                active_users_count=len(online_users),
                admin_stats_dao=admin_stats_dao,
                logger=logger,
            )
        except InvalidGroupBy as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.error("获取系统统计失败: %s", exc)
            raise HTTPException(status_code=500, detail="获取系统统计失败") from exc

    @router.get("/api/admin/logs")
    async def get_admin_logs(username: str = Depends(require_auth), limit: int = 100):
        try:
            return await get_admin_logs_response(
                username,
                limit=limit,
                super_admin=username,
                admin_stats_dao=admin_stats_dao,
            )
        except Exception as exc:
            logger.error("获取生成日志失败: %s", exc)
            raise HTTPException(status_code=500, detail="获取生成日志失败") from exc

    @router.post("/api/admin/users/create")
    async def create_user(
        user_data: dict,
        request: Request,
        username: str = Depends(super_admin_dependency),
    ):
        try:
            return await create_admin_user_response(
                user_data,
                request=request,
                admin_username=username,
                super_admin=username,
                default_users=default_users,
                user_dao=user_dao,
                audit_record=audit_record,
                logger=logger,
            )
        except (InvalidUserFields, MissingUserCredentials, WeakPassword, UsernameExists) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except UserCreationFailed as exc:
            raise HTTPException(status_code=503, detail="用户创建失败") from exc
        except Exception as exc:
            logger.error("创建用户失败: %s", exc)
            raise HTTPException(status_code=500, detail="创建用户失败") from exc

    if include_user_management:
        @router.get("/api/admin/session")
        async def get_admin_session(
            username: str = Depends(require_auth),
        ):
            lookup = getattr(user_dao, "get_user_by_username", None)
            user = await lookup(username) if callable(lookup) else None
            if not user:
                user = await user_dao.get_user_by_id(username)
            if not user:
                raise HTTPException(status_code=401, detail="用户不存在")
            normalized = normalize_admin_user_record(user)
            return {
                "success": True,
                "user_id": normalized["user_id"],
                "username": normalized["username"],
                "role": normalized["role"],
            }

        @router.get("/api/admin/users")
        async def list_users(
            keyword: Optional[str] = None,
            role: Optional[str] = None,
            status_filter: Optional[str] = None,
            limit: int = 100,
            offset: int = 0,
            _username: str = Depends(require_auth),
        ):
            try:
                return await list_admin_users_response(
                    user_dao=user_dao,
                    keyword=keyword,
                    role=role,
                    status_filter=status_filter,
                    limit=limit,
                    offset=offset,
                )
            except Exception as exc:
                logger.error("获取用户列表失败: %s", exc)
                raise HTTPException(status_code=500, detail="获取用户列表失败") from exc

        @router.post("/api/admin/users", status_code=201)
        async def create_user_canonical(
            user_data: dict,
            request: Request,
            username: str = Depends(super_admin_dependency),
        ):
            try:
                return await create_admin_user_response(
                    user_data,
                    request=request,
                    admin_username=username,
                    super_admin=username,
                    default_users=default_users,
                    user_dao=user_dao,
                    audit_record=audit_record,
                    logger=logger,
                )
            except (InvalidUserFields, MissingUserCredentials, WeakPassword, UsernameExists) as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            except UserCreationFailed as exc:
                raise HTTPException(status_code=503, detail="用户创建失败") from exc
            except Exception as exc:
                logger.error("创建用户失败: %s", exc)
                raise HTTPException(status_code=500, detail="创建用户失败") from exc

        @router.get("/api/admin/users/{user_id}")
        async def get_user_detail(
            user_id: str,
            _username: str = Depends(require_auth),
        ):
            return {"success": True, "user": normalize_admin_user_record(await load_target_user(user_id))}

        @router.put("/api/admin/users/{user_id}")
        async def update_user_role(
            user_id: str,
            user_data: dict,
            request: Request,
            username: str = Depends(super_admin_dependency),
        ):
            unknown = set(user_data) - {"role"}
            if unknown or "role" not in user_data:
                raise HTTPException(status_code=400, detail="公开版仅允许通过此接口修改角色")
            role = str(user_data.get("role") or "")
            if role not in {"user", "admin", "super_admin"}:
                raise HTTPException(status_code=400, detail="无效的账号角色")
            target = await load_target_user(user_id)
            reject_bootstrap_mutation(target)
            if not await user_dao.set_role(user_id, role):
                raise HTTPException(status_code=500, detail="角色修改失败")
            await record_audit(
                request,
                username,
                "user_role_update",
                user_id,
                before={"role": target.get("role")},
                after={"role": role},
            )
            return {"success": True}

        @router.put("/api/admin/users/{user_id}/username")
        async def update_username(
            user_id: str,
            user_data: dict,
            request: Request,
            http_response: Response,
            username: str = Depends(super_admin_dependency),
        ):
            if set(user_data) != {"username"} or not isinstance(user_data["username"], str):
                raise HTTPException(status_code=400, detail="仅允许修改用户名")
            target = await load_target_user(user_id)
            reject_bootstrap_mutation(target)
            # Capture a legacy login-name subject before it changes. Ownership and
            # the replacement session always use the stable database user ID.
            caller = await user_dao.get_user_by_username(username)
            if not caller:
                caller = await user_dao.get_user_by_id(username)
            if not caller:
                raise HTTPException(status_code=401, detail="用户不存在")
            try:
                result = await admin_user_service.rename_user(user_id, user_data["username"], user_dao=user_dao)
            except admin_user_service.AdminUserNotFound as exc:
                raise HTTPException(status_code=404, detail="用户不存在") from exc
            except (admin_user_service.AdminUsernameInvalid, admin_user_service.AdminUsernameExists,
                    admin_user_service.ProtectedSystemUsername) as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            except admin_user_service.AdminUsernameUpdateFailed as exc:
                raise HTTPException(status_code=500, detail="用户名修改失败") from exc
            user = result["user"]
            response = {"success": True, "changed": result["changed"], "user": normalize_admin_user_record(user)}
            if result["changed"]:
                await record_audit(request, str(caller["user_id"]), "user_rename", user_id,
                                   before={"username": result["before"].get("username")},
                                   after={"username": user.get("username")})
                if str(caller["user_id"]) == str(user_id):
                    token = await issue_session_token(user_id, user_dao=user_dao, token_creator=jwt_auth.create_token)
                    set_session_cookie(http_response, token)
                    response["session"] = {"username": user.get("username"), "role": user.get("role")}
            return response

        @router.post("/api/admin/users/{user_id}/disable")
        async def disable_user(
            user_id: str,
            user_data: dict,
            request: Request,
            username: str = Depends(super_admin_dependency),
        ):
            target = await load_target_user(user_id)
            reject_bootstrap_mutation(target)
            if str(target.get("username") or "") == username:
                raise HTTPException(status_code=400, detail="不能禁用自己的账号")
            reason = str(user_data.get("reason") or "管理员禁用")[:500]
            if not await user_dao.set_status(user_id, "disabled", disabled_reason=reason):
                raise HTTPException(status_code=500, detail="禁用用户失败")
            await record_audit(request, username, "user_disable", user_id, after={"reason": reason})
            return {"success": True}

        @router.post("/api/admin/users/{user_id}/enable")
        async def enable_user(
            user_id: str,
            request: Request,
            username: str = Depends(super_admin_dependency),
        ):
            target = await load_target_user(user_id)
            reject_bootstrap_mutation(target)
            if not await user_dao.set_status(user_id, "active"):
                raise HTTPException(status_code=500, detail="启用用户失败")
            await record_audit(request, username, "user_enable", user_id)
            return {"success": True}

        @router.post("/api/admin/users/{user_id}/reset-password")
        async def reset_user_password(
            user_id: str,
            user_data: dict,
            request: Request,
            username: str = Depends(super_admin_dependency),
        ):
            target = await load_target_user(user_id)
            reject_bootstrap_mutation(target)
            password = user_data.get("new_password")
            if not isinstance(password, str) or not 8 <= len(password) <= 128:
                raise HTTPException(status_code=400, detail="新密码长度必须为 8-128 位")
            if not await user_dao.reset_password(user_id, password):
                raise HTTPException(status_code=500, detail="密码重置失败")
            await record_audit(request, username, "user_reset_password", user_id)
            return {"success": True}

        @router.put("/api/admin/users/{user_id}/permissions")
        async def update_user_permissions(
            user_id: str,
            user_data: dict,
            request: Request,
            username: str = Depends(super_admin_dependency),
        ):
            target = await load_target_user(user_id)
            reject_bootstrap_mutation(target)
            try:
                permissions = validate_model_access_permissions(user_data.get("permissions") or {})
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            if not await user_dao.update_user_permissions(user_id, permissions):
                raise HTTPException(status_code=500, detail="权限修改失败")
            await record_audit(request, username, "user_update_permissions", user_id, after={"permissions": permissions})
            return {"success": True}

    @router.delete("/api/admin/users/{user_id}")
    async def delete_user(
        user_id: str,
        username: str = Depends(super_admin_dependency),
    ):
        try:
            return await delete_admin_user_response(
                user_id,
                admin_username=username,
                super_admin=username,
                user_dao=user_dao,
                logger=logger,
            )
        except (SelfDeleteForbidden, SystemUserDeleteForbidden) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except UserDeleteFailed as exc:
            raise HTTPException(status_code=500, detail="删除用户失败") from exc
        except Exception as exc:
            logger.error("删除用户失败: %s", exc)
            raise HTTPException(status_code=500, detail="删除用户失败") from exc

    return router
