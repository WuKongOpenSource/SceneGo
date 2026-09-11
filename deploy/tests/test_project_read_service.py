import pytest

from services import project_read_service as svc


class _ProjectDAO:
    row = None
    access_updates = []

    @classmethod
    async def get_project(cls, project_id):
        if cls.row is None:
            return None
        return {**cls.row, "project_id": project_id}

    @classmethod
    async def update_project_access(cls, project_id):
        cls.access_updates.append(project_id)


class _ProjectMemberDAO:
    allowed_users = set()

    @classmethod
    async def check_permission(cls, project_id, user_id, required_role="readonly"):
        cls.last_check = (project_id, user_id, required_role)
        return user_id in cls.allowed_users


class _UserDAO:
    admin_users = set()

    @classmethod
    async def is_admin_user(cls, username):
        return username in cls.admin_users


class _Logger:
    infos = []
    warnings = []
    debugs = []

    @classmethod
    def info(cls, *args, **kwargs):
        cls.infos.append((args, kwargs))

    @classmethod
    def warning(cls, *args, **kwargs):
        cls.warnings.append((args, kwargs))

    @classmethod
    def debug(cls, *args, **kwargs):
        cls.debugs.append((args, kwargs))


@pytest.fixture(autouse=True)
def _reset_fakes():
    _ProjectDAO.row = {
        "user_id": "yuan",
        "settings": {
            "id": "proj_1",
            "name": "Demo",
            "stage": 2,
            "generated_images": {
                "shot_1": {
                    "selectedImageId": "img_1",
                    "images": [
                        {
                            "id": "img_1",
                            "url": "/api/files/full/download",
                            "thumbnail": "/storage/thumb.webp",
                            "timestamp": 123,
                        }
                    ],
                },
                "shot_legacy": [
                    {
                        "id": "img_2",
                        "thumbnail": "/storage/legacy-thumb.webp",
                        "timestamp": 456,
                    }
                ],
            },
            "video_tasks": [{"storyboard_id": "shot_1", "image_url": "/api/files/full/download"}],
        },
    }
    _ProjectDAO.access_updates = []
    _ProjectMemberDAO.allowed_users = set()
    _ProjectMemberDAO.last_check = None
    _UserDAO.admin_users = set()
    _Logger.infos = []
    _Logger.warnings = []
    _Logger.debugs = []


@pytest.mark.asyncio
async def test_get_project_response_thumbnail_mode_simplifies_images_and_updates_access():
    result = await svc.get_project_response(
        "proj_1",
        username="yuan",
        thumbnail_only=True,
        project_dao=_ProjectDAO,
        project_member_dao=_ProjectMemberDAO,
        user_dao=_UserDAO,
        logger=_Logger,
    )

    project = result["project"]
    shot = project["generated_images"]["shot_1"]
    assert result["success"] is True
    assert shot["selectedImageId"] == "img_1"
    assert shot["count"] == 1
    assert shot["images"][0] == {
        "id": "img_1",
        "thumbnail": "/storage/thumb.webp",
        "timestamp": 123,
        "hasFullImage": True,
    }
    assert "url" not in shot["images"][0]
    assert project["generated_images"]["shot_legacy"][0]["hasFullImage"] is True
    assert _ProjectDAO.access_updates == ["proj_1"]


@pytest.mark.asyncio
async def test_get_project_response_full_mode_preserves_generated_image_urls():
    result = await svc.get_project_response(
        "proj_1",
        username="yuan",
        thumbnail_only=False,
        project_dao=_ProjectDAO,
        project_member_dao=_ProjectMemberDAO,
        user_dao=_UserDAO,
        logger=_Logger,
    )

    assert result["project"]["generated_images"]["shot_1"]["images"][0]["url"] == "/api/files/full/download"


@pytest.mark.asyncio
async def test_get_project_response_allows_project_member_and_blocks_other_user():
    _ProjectDAO.row["user_id"] = "owner"
    _ProjectMemberDAO.allowed_users = {"editor"}

    result = await svc.get_project_response(
        "proj_1",
        username="editor",
        thumbnail_only=True,
        project_dao=_ProjectDAO,
        project_member_dao=_ProjectMemberDAO,
        user_dao=_UserDAO,
        logger=_Logger,
    )
    assert result["success"] is True

    with pytest.raises(svc.ProjectReadForbidden):
        await svc.get_project_response(
            "proj_1",
            username="visitor",
            thumbnail_only=True,
            project_dao=_ProjectDAO,
            project_member_dao=_ProjectMemberDAO,
            user_dao=_UserDAO,
            logger=_Logger,
        )


@pytest.mark.asyncio
async def test_get_shot_images_response_fills_missing_urls_and_selected_id():
    result = await svc.get_shot_images_response(
        "proj_1",
        "shot_legacy",
        username="yuan",
        project_dao=_ProjectDAO,
        project_member_dao=_ProjectMemberDAO,
        user_dao=_UserDAO,
        logger=_Logger,
    )

    assert result == {
        "success": True,
        "images": [
            {
                "id": "img_2",
                "thumbnail": "/storage/legacy-thumb.webp",
                "timestamp": 456,
                "url": "/storage/legacy-thumb.webp",
            }
        ],
    }


@pytest.mark.asyncio
async def test_get_shot_images_response_handles_missing_project_and_empty_images():
    _ProjectDAO.row = None
    with pytest.raises(svc.ProjectReadNotFound):
        await svc.get_shot_images_response(
            "proj_missing",
            "shot_1",
            username="yuan",
            project_dao=_ProjectDAO,
            project_member_dao=_ProjectMemberDAO,
            user_dao=_UserDAO,
            logger=_Logger,
        )

    _ProjectDAO.row = {"user_id": "yuan", "settings": {"generated_images": {}}}
    result = await svc.get_shot_images_response(
        "proj_1",
        "shot_1",
        username="yuan",
        project_dao=_ProjectDAO,
        project_member_dao=_ProjectMemberDAO,
        user_dao=_UserDAO,
        logger=_Logger,
    )
    assert result == {"success": True, "images": []}
