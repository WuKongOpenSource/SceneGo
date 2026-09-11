"""Task recovery, task notification, and persisted notification routes."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException

from services.task_notification_service import (
    TaskFileForbidden,
    dismiss_notification as dismiss_notification_service,
    get_active_tasks as get_active_tasks_service,
    get_notifications as get_notifications_service,
    get_recent_tasks as get_recent_tasks_service,
    get_task_files as get_task_files_service,
    get_task_notifications as get_task_notifications_service,
    get_unread_notification_count as get_unread_notification_count_service,
    mark_all_notifications_read as mark_all_notifications_read_service,
    mark_notification_read as mark_notification_read_service,
)


def create_task_notifications_router(
    *,
    get_current_user_dependency: Any,
    task_dao: Any,
    notification_dao: Any,
    get_task_queue: Any = None,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    TaskDAO = task_dao
    NotificationDAO = notification_dao

    @router.get("/api/tasks/recent")
    async def get_recent_tasks(
        hours: int = 24,
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await get_recent_tasks_service(user_id=user_id, hours=hours, task_dao=TaskDAO)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.get("/api/tasks/{task_id}/files")
    async def get_task_files(
        task_id: str,
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await get_task_files_service(task_id=task_id, user_id=user_id, task_dao=TaskDAO)
        except TaskFileForbidden as e:
            raise HTTPException(status_code=403, detail="无权访问") from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.get("/api/tasks/active")
    async def get_active_tasks(user_id: str = Depends(get_current_user)):
        try:
            task_queue = get_task_queue() if callable(get_task_queue) else None
            return await get_active_tasks_service(user_id=user_id, task_dao=TaskDAO, task_queue=task_queue)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.get("/api/tasks/notifications")
    async def get_task_notifications(
        since: Optional[int] = None,
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await get_task_notifications_service(user_id=user_id, since=since, task_dao=TaskDAO)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.get("/api/notifications/unread-count")
    async def get_unread_notification_count(user_id: str = Depends(get_current_user)):
        try:
            return await get_unread_notification_count_service(
                user_id=user_id,
                notification_dao=NotificationDAO,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.get("/api/notifications")
    async def get_notifications(
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        user_id: str = Depends(get_current_user),
    ):
        try:
            return await get_notifications_service(
                user_id=user_id,
                status=status,
                limit=limit,
                offset=offset,
                notification_dao=NotificationDAO,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/api/notifications/{notification_id}/read")
    async def mark_notification_read(notification_id: str, user_id: str = Depends(get_current_user)):
        try:
            return await mark_notification_read_service(
                notification_id=notification_id,
                user_id=user_id,
                notification_dao=NotificationDAO,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/api/notifications/read-all")
    async def mark_all_notifications_read(user_id: str = Depends(get_current_user)):
        try:
            return await mark_all_notifications_read_service(
                user_id=user_id,
                notification_dao=NotificationDAO,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.delete("/api/notifications/{notification_id}")
    async def dismiss_notification(notification_id: str, user_id: str = Depends(get_current_user)):
        try:
            return await dismiss_notification_service(
                notification_id=notification_id,
                user_id=user_id,
                notification_dao=NotificationDAO,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    return router
