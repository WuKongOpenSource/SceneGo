import pytest

from services import email_delivery_service as service


class FakeOutbox:
    rows = []

    @classmethod
    async def enqueue(cls, **kwargs):
        cls.rows.append(kwargs)
        return {"message_id": "mail_1", **kwargs}


class FakeUserDAO:
    user = None

    @classmethod
    async def get_user_auth_by_id(cls, _user_id):
        return cls.user


@pytest.fixture(autouse=True)
def patch_outbox(monkeypatch):
    FakeOutbox.rows = []
    FakeUserDAO.user = None
    monkeypatch.setattr(service, "EmailOutboxDAO", FakeOutbox)


@pytest.mark.asyncio
async def test_verification_email_is_queued_without_leaking_html():
    message_id = await service.enqueue_verification_email(
        "creator@example.com",
        "12<456",
        "email_verify",
    )

    assert message_id == "mail_1"
    assert FakeOutbox.rows[0]["recipient"] == "creator@example.com"
    assert "12&lt;456" in FakeOutbox.rows[0]["body_html"]
    assert FakeOutbox.rows[0]["metadata"] == {"purpose": "email_verify"}


@pytest.mark.asyncio
async def test_notification_email_requires_verified_address_and_preference():
    FakeUserDAO.user = {
        "email": "creator@example.com",
        "email_verified": True,
        "email_notification_preferences": {"task_success": False},
    }
    await service.enqueue_notification_email(
        user_id="user_1",
        title="任务生成成功",
        message="成品已生成",
        notification_type="task",
        category="task",
        notification_id="notice_1",
        user_dao=FakeUserDAO,
    )
    assert FakeOutbox.rows == []

    FakeUserDAO.user["email_notification_preferences"]["task_success"] = True
    await service.enqueue_notification_email(
        user_id="user_1",
        title="任务生成成功",
        message="成品已生成",
        notification_type="task",
        category="task",
        notification_id="notice_1",
        user_dao=FakeUserDAO,
    )
    assert FakeOutbox.rows[0]["dedupe_key"] == "notification:notice_1"


@pytest.mark.asyncio
async def test_notification_email_skips_unverified_address():
    FakeUserDAO.user = {
        "email": "creator@example.com",
        "email_verified": False,
        "email_notification_preferences": {},
    }
    await service.enqueue_notification_email(
        user_id="user_1",
        title="任务失败",
        message="请重试",
        notification_type="task",
        category="task",
        notification_id="notice_2",
        user_dao=FakeUserDAO,
    )
    assert FakeOutbox.rows == []
