"""Uncached, server-owned role gate for new Jimeng generations."""
from dao.user.user import UserDAO

ADMIN_ONLY_MESSAGE = "该真人视频模型仅限管理员使用。"


class JimengAccessDenied(PermissionError):
    pass


async def require_jimeng_admin(user_id):
    # Role names and grants supplied by the client are never authority. The
    # existing identity lookup also rejects disabled and suspended accounts.
    if not user_id or await UserDAO.is_admin_user(user_id) is not True:
        raise JimengAccessDenied(ADMIN_ONLY_MESSAGE)
