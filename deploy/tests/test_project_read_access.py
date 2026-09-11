import logging

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from routers.projects import create_projects_router


class _ProjectDAO:
    access_updates = []

    @staticmethod
    async def get_project(project_id):
        return {
            "project_id": project_id,
            "user_id": "Yuan",
            "project_name": "Owner project",
            "description": "",
            "settings": {
                "id": project_id,
                "name": "Owner project",
                "stage": 2,
                "generated_images": {
                    "shot_1": {
                        "selectedImageId": "img_1",
                        "images": [{"id": "img_1", "thumbnail": "/storage/shot.webp"}],
                    },
                },
            },
        }

    @staticmethod
    async def update_project_access(project_id):
        _ProjectDAO.access_updates.append(project_id)


class _ProjectMemberDAO:
    allowed_users = set()

    @staticmethod
    async def check_permission(project_id, user_id, required_role="readonly"):
        return user_id in _ProjectMemberDAO.allowed_users


class _UserDAO:
    admin_users = set()

    @staticmethod
    async def is_admin_user(username):
        return username in _UserDAO.admin_users


class _FileDAO:
    pass


class _VersionDAO:
    pass


def _build_app(username: str) -> FastAPI:
    app = FastAPI()
    app.include_router(
        create_projects_router(
            require_auth_dependency=lambda: username,
            project_dao=_ProjectDAO,
            project_member_dao=_ProjectMemberDAO,
            user_dao=_UserDAO,
            file_dao=_FileDAO,
            version_dao=_VersionDAO,
            logger=logging.getLogger("test_project_read_access"),
        )
    )
    return app


@pytest.fixture(autouse=True)
def _reset_fakes():
    _ProjectDAO.access_updates = []
    _ProjectMemberDAO.allowed_users = set()
    _UserDAO.admin_users = set()


@pytest.mark.asyncio
async def test_admin_can_read_private_owner_project():
    _UserDAO.admin_users = {"admin"}
    app = _build_app("admin")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/projects/proj_1/workspace")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["project"]["id"] == "proj_1"
    assert _ProjectDAO.access_updates == ["proj_1"]


@pytest.mark.asyncio
async def test_project_member_can_read_private_owner_project():
    _ProjectMemberDAO.allowed_users = {"editor"}
    app = _build_app("editor")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/projects/proj_1/workspace")

    assert response.status_code == 200
    assert response.json()["project"]["name"] == "Owner project"


@pytest.mark.asyncio
async def test_non_member_non_admin_cannot_read_private_owner_project():
    app = _build_app("visitor")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/projects/proj_1/workspace")

    assert response.status_code == 403
    assert response.json()["detail"] == "无权访问此项目"


@pytest.mark.asyncio
async def test_admin_can_read_legacy_shot_images():
    _UserDAO.admin_users = {"admin"}
    app = _build_app("admin")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/projects/proj_1/images/shot_1")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["selectedImageId"] == "img_1"
    assert payload["images"][0]["url"] == "/storage/shot.webp"
