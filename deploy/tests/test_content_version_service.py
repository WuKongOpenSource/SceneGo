from __future__ import annotations

import pytest

from services import content_version_service


class FakeProjectDAO:
    projects = {
        "proj_1": {"project_id": "proj_1", "user_id": "user_1"},
    }

    @classmethod
    async def get_project(cls, project_id):
        return cls.projects.get(project_id)


class FakeVersionDAO:
    versions = {
        "ver_1": {"version_id": "ver_1", "project_id": "proj_1", "user_id": "user_1", "is_current": True},
        "ver_2": {"version_id": "ver_2", "project_id": "proj_1", "user_id": "user_1", "is_current": False},
        "ver_other": {"version_id": "ver_other", "project_id": "proj_2", "user_id": "user_2", "is_current": False},
    }
    created = None
    current_set = None
    deleted = []

    @classmethod
    async def get_current_version(cls, project_id):
        for version in cls.versions.values():
            if version["project_id"] == project_id and version["is_current"]:
                return version
        return None

    @classmethod
    async def create_version(cls, **kwargs):
        cls.created = kwargs
        return {"version_id": "ver_new", **kwargs}

    @classmethod
    async def get_version(cls, version_id):
        return cls.versions.get(version_id)

    @classmethod
    async def set_current_version(cls, version_id):
        cls.current_set = version_id

    @classmethod
    async def delete_version(cls, version_id):
        cls.deleted.append(version_id)


class FakeFileDAO:
    @staticmethod
    async def get_version_files(version_id):
        return [{"file_id": "file_1", "version_id": version_id}]


class FakeTextContentDAO:
    created = None
    texts = {
        "txt_1": {"content_id": "txt_1", "version_id": "ver_1", "user_id": "user_1"},
        "txt_other": {"content_id": "txt_other", "version_id": "ver_other", "user_id": "user_2"},
    }

    @staticmethod
    async def get_version_texts(version_id):
        return [{"content_id": "txt_1", "version_id": version_id}]

    @classmethod
    async def create_text_content(cls, **kwargs):
        cls.created = kwargs
        return {"content_id": "txt_new", **kwargs}

    @classmethod
    async def get_text_content(cls, content_id):
        return cls.texts.get(content_id)


class FakeActivityLogDAO:
    logged = []

    @classmethod
    async def log_activity(cls, **kwargs):
        cls.logged.append(kwargs)


def setup_function():
    FakeVersionDAO.created = None
    FakeVersionDAO.current_set = None
    FakeVersionDAO.deleted = []
    FakeTextContentDAO.created = None
    FakeActivityLogDAO.logged = []


async def test_create_version_uses_current_parent_and_logs_activity():
    result = await content_version_service.create_version(
        project_id="proj_1",
        user_id="user_1",
        version_name="v2",
        description="desc",
        project_dao=FakeProjectDAO,
        version_dao=FakeVersionDAO,
        activity_log_dao=FakeActivityLogDAO,
    )

    assert result["version"]["version_id"] == "ver_new"
    assert FakeVersionDAO.created["parent_version_id"] == "ver_1"
    assert FakeActivityLogDAO.logged == [
        {
            "user_id": "user_1",
            "action": "create_version",
            "resource_type": "version",
            "resource_id": "ver_new",
        }
    ]


async def test_create_version_rejects_project_owner_mismatch():
    with pytest.raises(content_version_service.ContentVersionForbidden):
        await content_version_service.create_version(
            project_id="proj_1",
            user_id="other",
            version_name="v2",
            description="desc",
            project_dao=FakeProjectDAO,
            version_dao=FakeVersionDAO,
            activity_log_dao=FakeActivityLogDAO,
        )


async def test_get_version_detail_returns_files_and_texts():
    result = await content_version_service.get_version_detail(
        version_id="ver_1",
        user_id="user_1",
        version_dao=FakeVersionDAO,
        file_dao=FakeFileDAO,
        text_content_dao=FakeTextContentDAO,
    )

    assert result["version"]["version_id"] == "ver_1"
    assert result["files"] == [{"file_id": "file_1", "version_id": "ver_1"}]
    assert result["texts"] == [{"content_id": "txt_1", "version_id": "ver_1"}]


async def test_restore_version_sets_current_and_logs_activity():
    result = await content_version_service.restore_version(
        version_id="ver_2",
        user_id="user_1",
        version_dao=FakeVersionDAO,
        activity_log_dao=FakeActivityLogDAO,
    )

    assert result == {"success": True, "message": "版本已恢复"}
    assert FakeVersionDAO.current_set == "ver_2"
    assert FakeActivityLogDAO.logged[0]["action"] == "restore_version"


async def test_delete_current_version_is_rejected():
    with pytest.raises(content_version_service.ContentVersionCurrentDeleteForbidden):
        await content_version_service.delete_version(
            version_id="ver_1",
            user_id="user_1",
            version_dao=FakeVersionDAO,
            activity_log_dao=FakeActivityLogDAO,
        )


async def test_delete_version_deletes_non_current_and_logs_activity():
    result = await content_version_service.delete_version(
        version_id="ver_2",
        user_id="user_1",
        version_dao=FakeVersionDAO,
        activity_log_dao=FakeActivityLogDAO,
    )

    assert result == {"success": True, "message": "版本已删除"}
    assert FakeVersionDAO.deleted == ["ver_2"]
    assert FakeActivityLogDAO.logged[0]["action"] == "delete_version"


async def test_create_text_requires_owned_version_and_logs_activity():
    result = await content_version_service.create_text(
        version_id="ver_1",
        content_type="script",
        title="标题",
        content="内容",
        user_id="user_1",
        version_dao=FakeVersionDAO,
        text_content_dao=FakeTextContentDAO,
        activity_log_dao=FakeActivityLogDAO,
    )

    assert result["text"]["content_id"] == "txt_new"
    assert FakeTextContentDAO.created["content"] == "内容"
    assert FakeActivityLogDAO.logged[0]["resource_id"] == "txt_new"


async def test_get_text_rejects_missing_and_wrong_owner():
    with pytest.raises(content_version_service.TextContentNotFound):
        await content_version_service.get_text(
            content_id="missing",
            user_id="user_1",
            text_content_dao=FakeTextContentDAO,
        )

    with pytest.raises(content_version_service.ContentVersionForbidden):
        await content_version_service.get_text(
            content_id="txt_other",
            user_id="user_1",
            text_content_dao=FakeTextContentDAO,
        )
