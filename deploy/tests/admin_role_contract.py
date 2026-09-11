"""Common persisted-role decisions; each composition owns its dependency adapter."""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from starlette.requests import Request

def _request(*, cookie: bool = False) -> Request:
    headers = (
        [(b"cookie", b"ostory_session=test-token")]
        if cookie
        else [(b"authorization", b"Bearer test-token")]
    )
    return Request({
        "type": "http",
        "method": "GET",
        "path": "/api/admin/session",
        "headers": headers,
    })


class AdminRoleContract:
    @pytest.mark.asyncio
    async def test_admin_role_can_enter_admin_but_not_super_admin_policy(self, monkeypatch):
        async def load_identity(subject: str):
            return {"user_id": "ops-1", "username": "operator", "role": "admin", "status": "active", "is_active": True, "session_version": 1}

        async def validate(_token, **_kwargs):
            return await load_identity("ops-1")

        admin = self.bind_admin(monkeypatch, load_identity, validate)

        assert await admin.require_admin(_request()) == "operator"
        with pytest.raises(HTTPException) as exc:
            await admin.require_super_admin(_request())
        assert exc.value.status_code == 403


    @pytest.mark.asyncio
    async def test_super_admin_role_can_change_platform_policy(self, monkeypatch):
        async def load_identity(subject: str):
            return {"user_id": "owner-1", "username": "owner", "role": "super_admin", "status": "active", "is_active": True, "session_version": 1}

        async def validate(_token, **_kwargs):
            return await load_identity("owner-1")

        admin = self.bind_admin(monkeypatch, load_identity, validate)

        assert await admin.require_super_admin(_request()) == "owner"


    @pytest.mark.asyncio
    async def test_admin_role_accepts_http_only_session_cookie(self, monkeypatch):
        async def load_identity(subject: str):
            assert subject == "owner-1"
            return {"user_id": "owner-1", "username": "owner", "role": "super_admin", "status": "active", "is_active": True, "session_version": 1}

        async def validate(token, **_kwargs):
            assert token == "test-token"
            return await load_identity("owner-1")

        admin = self.bind_admin(monkeypatch, load_identity, validate)

        assert await admin.require_admin(_request(cookie=True)) == "owner"


    @pytest.mark.asyncio
    async def test_fixed_admin_name_and_bootstrap_env_do_not_bypass_persisted_role(self, monkeypatch):
        async def load_identity(subject: str):
            return {"user_id": "admin", "username": "admin", "role": "user", "status": "active", "is_active": True, "session_version": 1}

        async def validate(_token, **_kwargs):
            return await load_identity("admin")

        admin = self.bind_admin(monkeypatch, load_identity, validate)
        monkeypatch.setenv("OSTORY_ADMIN_USERNAMES", "admin")
        monkeypatch.setenv("OSTORY_SUPER_ADMIN_USERNAMES", "admin")

        with pytest.raises(HTTPException) as admin_exc:
            await admin.require_admin(_request())
        assert admin_exc.value.status_code == 403

        with pytest.raises(HTTPException) as super_exc:
            await admin.require_super_admin(_request())
        assert super_exc.value.status_code == 403


    def test_legacy_empty_model_list_inherits_platform_catalog(self):
        normalized = self.normalize_admin_user({
            "user_id": "legacy-1",
            "username": "legacy",
            "role": "user",
            "permissions": {"allowedModels": []},
        })

        assert normalized["permissions"]["accessMode"] == "inherit"
        assert normalized["permissions"]["allowedModels"] == []
