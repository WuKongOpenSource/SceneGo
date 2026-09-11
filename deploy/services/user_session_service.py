"""Current-user session and organization self-service business logic."""
from __future__ import annotations

from collections.abc import MutableMapping
from datetime import datetime
from typing import Any, Callable, Dict


class UserSessionServiceError(RuntimeError):
    pass


class OrganizationNotFound(UserSessionServiceError):
    pass


class OrganizationOwnerLeaveForbidden(UserSessionServiceError):
    pass


class OrganizationMemberRequired(UserSessionServiceError):
    pass


def _serialize_record(record: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key, value in record.items():
        if hasattr(value, "isoformat"):
            out[key] = value.isoformat()
        else:
            out[key] = value
    return out


def logout_user(username: str, *, online_users: MutableMapping[str, Any]) -> Dict[str, Any]:
    online_users.pop(username, None)
    return {"success": True, "message": "登出成功"}


def get_user_info(
    username: str,
    *,
    now_provider: Callable[[], datetime] = datetime.now,
) -> Dict[str, Any]:
    return {
        "username": username,
        "login_time": now_provider().isoformat(),
    }


async def list_user_organizations(
    username: str,
    *,
    organization_member_dao: Any,
    logger: Any,
) -> Dict[str, Any]:
    try:
        orgs = await organization_member_dao.list_orgs_for_user(username)
    except Exception as exc:
        logger.warning("list_my_organizations: DAO call failed username=%s err=%s", username, exc)
        return {"success": True, "organizations": []}

    return {"success": True, "organizations": [_serialize_record(dict(org)) for org in orgs]}


async def leave_organization(
    org_id: str,
    username: str,
    *,
    organization_dao: Any,
    organization_member_dao: Any,
) -> Dict[str, Any]:
    org = await organization_dao.get(org_id)
    if not org:
        raise OrganizationNotFound("Organization not found")
    if org.get("owner_user_id") == username:
        raise OrganizationOwnerLeaveForbidden("Owner cannot leave before transfer")
    if not await organization_member_dao.is_member(org_id, username):
        raise OrganizationMemberRequired("User is not an organization member")
    await organization_member_dao.remove_member(org_id, username)
    return {"success": True}
