import hashlib
from unittest.mock import AsyncMock

import pytest

from services import phone_auth_service as svc
from services.password_service import PASSWORD_HASH_PREFIX
from services.verification_code_service import VerificationCodeInvalid


class FakeVerification:
    def __init__(self):
        self.calls = []

    async def verify(self, **kwargs):
        self.calls.append(kwargs)


class FakeUserDAO:
    def __init__(self):
        self.users = {}
        self.created = []
        self.bound = []
        self.password_updates = []

    async def get_user_by_phone(self, phone):
        return self.users.get(phone)

    async def get_user_by_username_any(self, _username):
        return None

    async def create_phone_user(self, **kwargs):
        self.created.append(kwargs)
        user = {
            "user_id": "user_new",
            "username": kwargs["username"],
            "phone_number": kwargs["phone_number"],
            "email": kwargs["email"],
            "email_verified": False,
        }
        self.users[kwargs["phone_number"]] = user
        return user

    async def update_last_login(self, _user_id):
        return True

    async def update_password_hash(self, user_id, password_hash):
        self.password_updates.append((user_id, password_hash))
        return True

    async def bind_verified_phone(self, user_id, phone):
        self.bound.append((user_id, phone))
        return {
            "user_id": user_id,
            "username": "legacy",
            "phone_number": phone,
            "phone_verified": True,
            "legacy_login_enabled": False,
        }


@pytest.mark.asyncio
async def test_phone_registration_normalizes_number_and_requires_code():
    dao = FakeUserDAO()
    verification = FakeVerification()

    user = await svc.register_phone_account(
        phone="+86 138-0013-8000",
        password="test-placeholder-password",
        email="USER@example.com",
        code="123456",
        verification_manager=verification,
        user_dao=dao,
    )

    assert user["phone_number"] == "13800138000"
    assert dao.created[0]["email"] == "user@example.com"
    assert verification.calls[0]["purpose"] == "register"


@pytest.mark.asyncio
async def test_legacy_phone_binding_disables_legacy_identity_via_dao():
    dao = FakeUserDAO()
    verification = FakeVerification()

    user = await svc.bind_legacy_phone(
        user_id="legacy_user",
        phone="13800138000",
        code="123456",
        verification_manager=verification,
        user_dao=dao,
    )

    assert user["legacy_login_enabled"] is False
    assert dao.bound == [("legacy_user", "13800138000")]


@pytest.mark.asyncio
async def test_phone_password_login_upgrades_legacy_hash():
    dao = FakeUserDAO()
    dao.users["13800138000"] = {
        "user_id": "user_1",
        "phone_number": "13800138000",
        "password_hash": hashlib.sha256("test-placeholder-password".encode()).hexdigest(),
        "status": "active",
    }

    await svc.login_phone_password(
        phone="13800138000",
        password="test-placeholder-password",
        user_dao=dao,
    )

    assert dao.password_updates
    assert dao.password_updates[0][1].startswith(PASSWORD_HASH_PREFIX)


def test_email_preferences_keep_defaults_and_apply_partial_updates():
    preferences = svc.merge_email_preferences(
        {"task_success": False},
        {"credit_alert": False},
    )

    assert preferences == {
        "task_success": False,
        "task_failure": True,
        "credit_alert": False,
        "sharing": True,
    }


async def code_login(dao, verifier=None):
    return await svc.login_phone_code(phone='+86 138-0013-8000', code='123456',
        verification_manager=verifier or FakeVerification(), user_dao=dao)


@pytest.mark.asyncio
async def test_code_login_registers_only_after_verification_and_reuses_existing_account():
    dao = FakeUserDAO()
    async def verify(**kwargs):
        assert dao.created == [] and kwargs['purpose'] == 'login'
    verifier = type('Verifier', (), {'verify': staticmethod(verify)})()
    user = await code_login(dao, verifier)
    assert user['phone_number'] == '13800138000'
    assert len(dao.created) == 1 and dao.created[0]['email'] is None
    assert len(dao.created[0]['password']) >= 48
    assert dao.created[0]['password'] not in ('123456', '13800138000')
    assert not {'role', 'permissions'} & dao.created[0].keys()
    assert 'password' not in user and 'password_hash' not in user
    assert await code_login(dao) == user and len(dao.created) == 1
    assert dao.password_updates == []


@pytest.mark.asyncio
@pytest.mark.parametrize('exists', [False, True])
async def test_wrong_expired_or_consumed_code_never_creates_or_logs_in(exists):
    dao = FakeUserDAO()
    if exists: dao.users['13800138000'] = {'user_id':'old','status':'active'}
    dao.update_last_login = AsyncMock()
    verification = FakeVerification()
    verification.verify = AsyncMock(side_effect=VerificationCodeInvalid('invalid or expired'))
    with pytest.raises(VerificationCodeInvalid): await code_login(dao,verification)
    assert dao.created == []
    dao.update_last_login.assert_not_awaited()


@pytest.mark.asyncio
async def test_code_login_does_not_recreate_disabled_account():
    dao = FakeUserDAO()
    dao.users['13800138000'] = {'user_id':'disabled','status':'disabled'}
    with pytest.raises(svc.AccountDisabled): await code_login(dao)
    assert dao.created == []


class UniqueConflict(Exception):
    sqlstate = '23505'


@pytest.mark.asyncio
@pytest.mark.parametrize('status', ['active', 'disabled'])
async def test_concurrent_registration_reuses_unique_phone_winner_without_overwriting(status):
    dao = FakeUserDAO()
    winner = {'user_id':'winner','status':status,'phone_number':'13800138000','password_hash':'unchanged'}
    async def concurrent_signup(**kwargs):
        dao.users[kwargs['phone_number']] = winner
        raise UniqueConflict()
    dao.create_phone_user = concurrent_signup
    if status == 'disabled':
        with pytest.raises(svc.AccountDisabled): await code_login(dao)
    else:
        assert await code_login(dao) == winner
    assert dao.password_updates == [] and winner['password_hash'] == 'unchanged'


@pytest.mark.asyncio
async def test_username_conflict_retry_is_bounded_and_database_failure_is_not_registration():
    dao = FakeUserDAO()
    dao.create_phone_user = AsyncMock(side_effect=UniqueConflict())
    with pytest.raises(svc.PhoneAuthError): await code_login(dao)
    assert dao.create_phone_user.await_count == 3
    dao.create_phone_user = AsyncMock(side_effect=RuntimeError('database unavailable'))
    with pytest.raises(RuntimeError,match='database unavailable'): await code_login(dao)
    assert dao.create_phone_user.await_count == 1
