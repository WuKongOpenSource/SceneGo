from __future__ import annotations

import pytest

from core import jwt_auth
from services.session_auth_service import issue_session_token, validate_session_token


class UserDAO:
    record = {
        "user_id": "user-1",
        "username": "creator",
        "status": "active",
        "is_active": True,
        "session_version": 3,
    }

    @classmethod
    async def get_session_identity(cls, subject):
        if subject in {"user-1", "creator"}:
            return dict(cls.record)
        return None


@pytest.fixture(autouse=True)
def signing_key():
    jwt_auth.init("unit-test-session-auth-key")
    UserDAO.record = {
        "user_id": "user-1",
        "username": "creator",
        "status": "active",
        "is_active": True,
        "session_version": 3,
    }


@pytest.mark.asyncio
async def test_current_session_version_authenticates_stable_user_id():
    token = jwt_auth.create_token("user-1", session_version=3)

    identity = await validate_session_token(token, user_dao=UserDAO)

    assert identity["user_id"] == "user-1"


@pytest.mark.asyncio
async def test_version_increment_immediately_revokes_existing_token():
    token = jwt_auth.create_token("user-1", session_version=3)
    UserDAO.record["session_version"] = 4

    assert await validate_session_token(token, user_dao=UserDAO) is None


@pytest.mark.asyncio
async def test_disabled_account_is_rejected_even_with_current_version():
    token = jwt_auth.create_token("user-1", session_version=3)
    UserDAO.record["status"] = "disabled"

    assert await validate_session_token(token, user_dao=UserDAO) is None


@pytest.mark.asyncio
async def test_issue_session_uses_authoritative_database_version():
    token = await issue_session_token("user-1", user_dao=UserDAO)

    assert jwt_auth.verify_token_claims(token)["sv"] == 3
