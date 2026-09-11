


import json
import logging
import uuid
from typing import List, Dict, Any, Optional
from datetime import datetime

from db_manager import get_db_manager


logger = logging.getLogger(__name__)


class NotificationDAO:

    @staticmethod
    async def create(
        user_id: str,
        title: str,
        message: str = '',
        notification_type: str = 'task',
        category: str = None,
        task_id: str = None,
        target_view: str = None,
        target_project_id: str = None,
        target_page: str = None,
        target_item_id: str = None,
        metadata: dict = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        nid = f"notif_{uuid.uuid4().hex[:12]}"
        query = """
            INSERT INTO notifications
                (notification_id, user_id, task_id, type, category,
                 title, message, target_view, target_project_id,
                 target_page, target_item_id, metadata)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            RETURNING *
        """
        row = await db.fetchrow(
            query, nid, user_id, task_id, notification_type, category,
            title, message or '', target_view, target_project_id,
            target_page, target_item_id,
            json.dumps(metadata) if metadata else '{}'
        )
        if row:

            try:
                from dao_user import UserDAO
                from services.email_delivery_service import enqueue_notification_email

                await enqueue_notification_email(
                    user_id=user_id,
                    title=title,
                    message=message or '',
                    notification_type=notification_type,
                    category=category,
                    notification_id=nid,
                    user_dao=UserDAO,
                )
            except Exception as exc:
                logger.warning("Notification email enqueue failed notification_id=%s: %s", nid, exc)
        return row

    @staticmethod
    async def get_unread_count(user_id: str) -> int:
        db = get_db_manager()
        if not db:
            return 0
        return await db.fetchval(
            "SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND status='unread'",
            user_id
        ) or 0

    @staticmethod
    async def get_unread(user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            """SELECT * FROM notifications
               WHERE user_id=$1 AND status='unread'
               ORDER BY created_at DESC LIMIT $2""",
            user_id, limit
        )

    @staticmethod
    async def get_history(user_id: str, limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            """SELECT * FROM notifications
               WHERE user_id=$1 AND status <> 'dismissed'
               ORDER BY created_at DESC LIMIT $2 OFFSET $3""",
            user_id, limit, offset
        )

    @staticmethod
    async def mark_read(notification_id: str, user_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        await db.execute(
            """UPDATE notifications SET status='read', read_at=NOW()
               WHERE notification_id=$1 AND user_id=$2""",
            notification_id, user_id
        )
        return True

    @staticmethod
    async def mark_all_read(user_id: str) -> int:
        db = get_db_manager()
        if not db:
            return 0
        result = await db.execute(
            """UPDATE notifications SET status='read', read_at=NOW()
               WHERE user_id=$1 AND status='unread'""",
            user_id
        )
        try:
            return int(result.split()[-1])
        except Exception:
            return 0

    @staticmethod
    async def dismiss(notification_id: str, user_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            """UPDATE notifications SET status='dismissed'
               WHERE user_id=$2
                 AND (notification_id=$1 OR task_id=$1)
                 AND status <> 'dismissed'""",
            notification_id, user_id
        )
        try:
            return int(result.split()[-1]) > 0
        except Exception:
            return False
