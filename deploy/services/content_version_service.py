"""Version and text-content business logic."""
from __future__ import annotations

from typing import Any, Dict, Optional


class ContentVersionServiceError(RuntimeError):
    pass


class ContentVersionForbidden(ContentVersionServiceError):
    pass


class ContentVersionNotFound(ContentVersionServiceError):
    pass


class ContentVersionCurrentDeleteForbidden(ContentVersionServiceError):
    pass


class TextContentNotFound(ContentVersionServiceError):
    pass


async def create_version(
    *,
    project_id: str,
    user_id: str,
    version_name: Optional[str],
    description: Optional[str],
    project_dao: Any,
    version_dao: Any,
    activity_log_dao: Any,
) -> Dict[str, Any]:
    project = await project_dao.get_project(project_id)
    if not project or project["user_id"] != user_id:
        raise ContentVersionForbidden("Project is not accessible")

    current_version = await version_dao.get_current_version(project_id)
    parent_version_id = current_version["version_id"] if current_version else None
    version = await version_dao.create_version(
        project_id=project_id,
        user_id=user_id,
        version_name=version_name,
        description=description,
        parent_version_id=parent_version_id,
    )
    await activity_log_dao.log_activity(
        user_id=user_id,
        action="create_version",
        resource_type="version",
        resource_id=version["version_id"],
    )
    return {"success": True, "version": version}


async def get_version_detail(
    *,
    version_id: str,
    user_id: str,
    version_dao: Any,
    file_dao: Any,
    text_content_dao: Any,
) -> Dict[str, Any]:
    version = await version_dao.get_version(version_id)
    if not version:
        raise ContentVersionNotFound("Version not found")
    if version["user_id"] != user_id:
        raise ContentVersionForbidden("Version is not accessible")

    files = await file_dao.get_version_files(version_id)
    texts = await text_content_dao.get_version_texts(version_id)
    return {
        "success": True,
        "version": version,
        "files": files,
        "texts": texts,
    }


async def restore_version(
    *,
    version_id: str,
    user_id: str,
    version_dao: Any,
    activity_log_dao: Any,
) -> Dict[str, Any]:
    version = await version_dao.get_version(version_id)
    if not version or version["user_id"] != user_id:
        raise ContentVersionForbidden("Version is not accessible")

    await version_dao.set_current_version(version_id)
    await activity_log_dao.log_activity(
        user_id=user_id,
        action="restore_version",
        resource_type="version",
        resource_id=version_id,
    )
    return {"success": True, "message": "版本已恢复"}


async def delete_version(
    *,
    version_id: str,
    user_id: str,
    version_dao: Any,
    activity_log_dao: Any,
) -> Dict[str, Any]:
    version = await version_dao.get_version(version_id)
    if not version or version["user_id"] != user_id:
        raise ContentVersionForbidden("Version is not accessible")
    if version["is_current"]:
        raise ContentVersionCurrentDeleteForbidden("Current version cannot be deleted")

    await version_dao.delete_version(version_id)
    await activity_log_dao.log_activity(
        user_id=user_id,
        action="delete_version",
        resource_type="version",
        resource_id=version_id,
    )
    return {"success": True, "message": "版本已删除"}


async def create_text(
    *,
    version_id: str,
    content_type: str,
    title: Optional[str],
    content: str,
    user_id: str,
    version_dao: Any,
    text_content_dao: Any,
    activity_log_dao: Any,
) -> Dict[str, Any]:
    version = await version_dao.get_version(version_id)
    if not version or version["user_id"] != user_id:
        raise ContentVersionForbidden("Version is not accessible")

    text = await text_content_dao.create_text_content(
        version_id=version_id,
        user_id=user_id,
        content_type=content_type,
        content=content,
        title=title,
    )
    await activity_log_dao.log_activity(
        user_id=user_id,
        action="create_text",
        resource_type="text",
        resource_id=text["content_id"],
    )
    return {"success": True, "text": text}


async def get_text(
    *,
    content_id: str,
    user_id: str,
    text_content_dao: Any,
) -> Dict[str, Any]:
    text = await text_content_dao.get_text_content(content_id)
    if not text:
        raise TextContentNotFound("Text content not found")
    if text["user_id"] != user_id:
        raise ContentVersionForbidden("Text content is not accessible")
    return {"success": True, "text": text}
