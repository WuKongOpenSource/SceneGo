from datetime import datetime

import pytest

from services import user_session_service as svc


class _Logger:
    def __init__(self):
        self.warnings = []

    def warning(self, *args, **_kwargs):
        self.warnings.append(args)


class _OrganizationDAO:
    row = None

    @classmethod
    def reset(cls):
        cls.row = None

    @classmethod
    async def get(cls, _org_id):
        return cls.row


class _OrganizationMemberDAO:
    orgs = []
    is_member_value = True
    removed = []
    raise_on_list = False

    @classmethod
    def reset(cls):
        cls.orgs = []
        cls.is_member_value = True
        cls.removed = []
        cls.raise_on_list = False

    @classmethod
    async def list_orgs_for_user(cls, _username):
        if cls.raise_on_list:
            raise RuntimeError("db down")
        return cls.orgs

    @classmethod
    async def is_member(cls, _org_id, _username):
        return cls.is_member_value

    @classmethod
    async def remove_member(cls, org_id, username):
        cls.removed.append((org_id, username))


@pytest.fixture(autouse=True)
def _reset_daos():
    _OrganizationDAO.reset()
    _OrganizationMemberDAO.reset()


def test_logout_user_removes_online_user():
    online = {"yuan": datetime(2026, 1, 1)}

    result = svc.logout_user("yuan", online_users=online)

    assert result == {"success": True, "message": "登出成功"}
    assert online == {}


def test_get_user_info_uses_current_time_provider():
    result = svc.get_user_info("yuan", now_provider=lambda: datetime(2026, 6, 23, 8, 30))

    assert result == {"username": "yuan", "login_time": "2026-06-23T08:30:00"}


@pytest.mark.asyncio
async def test_list_user_organizations_serializes_dates():
    _OrganizationMemberDAO.orgs = [{"org_id": "org1", "created_at": datetime(2026, 6, 23, 8, 30)}]

    result = await svc.list_user_organizations(
        "yuan",
        organization_member_dao=_OrganizationMemberDAO,
        logger=_Logger(),
    )

    assert result == {
        "success": True,
        "organizations": [{"org_id": "org1", "created_at": "2026-06-23T08:30:00"}],
    }


@pytest.mark.asyncio
async def test_list_user_organizations_downgrades_dao_errors():
    _OrganizationMemberDAO.raise_on_list = True
    logger = _Logger()

    result = await svc.list_user_organizations(
        "yuan",
        organization_member_dao=_OrganizationMemberDAO,
        logger=logger,
    )

    assert result == {"success": True, "organizations": []}
    assert logger.warnings


@pytest.mark.asyncio
async def test_leave_organization_rejects_missing_owner_and_non_member():
    with pytest.raises(svc.OrganizationNotFound):
        await svc.leave_organization(
            "org1",
            "yuan",
            organization_dao=_OrganizationDAO,
            organization_member_dao=_OrganizationMemberDAO,
        )

    _OrganizationDAO.row = {"org_id": "org1", "owner_user_id": "yuan"}
    with pytest.raises(svc.OrganizationOwnerLeaveForbidden):
        await svc.leave_organization(
            "org1",
            "yuan",
            organization_dao=_OrganizationDAO,
            organization_member_dao=_OrganizationMemberDAO,
        )

    _OrganizationDAO.row = {"org_id": "org1", "owner_user_id": "other"}
    _OrganizationMemberDAO.is_member_value = False
    with pytest.raises(svc.OrganizationMemberRequired):
        await svc.leave_organization(
            "org1",
            "yuan",
            organization_dao=_OrganizationDAO,
            organization_member_dao=_OrganizationMemberDAO,
        )


@pytest.mark.asyncio
async def test_leave_organization_removes_member():
    _OrganizationDAO.row = {"org_id": "org1", "owner_user_id": "other"}

    result = await svc.leave_organization(
        "org1",
        "yuan",
        organization_dao=_OrganizationDAO,
        organization_member_dao=_OrganizationMemberDAO,
    )

    assert result == {"success": True}
    assert _OrganizationMemberDAO.removed == [("org1", "yuan")]
