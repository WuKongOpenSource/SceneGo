"""Independent CLI account status; never return OAuth credentials or private paths."""
import asyncio
import time

from services.jimeng_cli_runtime import CliConfig, JimengCli
from services.jimeng_contract import MODEL_KEY, capability, JimengError
from services.jimeng_access_service import require_jimeng_admin
from services.model_access_service import require_user_model_access
from dao_user import UserDAO

_cache = (0.0, None, {})
_lock = asyncio.Lock()


async def account_status(*, refresh=False):
    global _cache
    try:
        config = await asyncio.to_thread(CliConfig.load)
        identity = (config.account_id, config.session_id, config.state_id, config.sha256)
        async with _lock:
            if not refresh and _cache[1] == identity and time.monotonic() - _cache[0] < 30:
                return dict(_cache[2])
            status = {**await JimengCli(config).account_status(), "available": True,
                      "message": "独立即梦账号已授权；提交前仍会校验原素材和平台创作点数。"}
            from dao.business.jimeng_job import JimengJobDAO
            pending_review = await JimengJobDAO.review_count(config.account_id)
            status["review_required_count"] = pending_review
            if pending_review:
                status.update(available=False, message=f"即梦账号有 {pending_review} 笔提交结果待核查，已暂停新任务。")
            _cache = (time.monotonic(), identity, status)
            return status
    except JimengError as exc:
        return {"available": False, "authorized": False, "message": str(exc)}
    except Exception:
        return {"available": False, "authorized": False, "message": "即梦账号状态暂时无法确认，请管理员检查独立授权。"}


async def attach_capability(manifest, *, user_id=None):
    # Never cache per-user authorization with the shared provider status.
    models = [m for m in manifest.get("models", []) if m.get("key") != MODEL_KEY]
    try:
        await require_jimeng_admin(user_id)
        await require_user_model_access(user_id, user_dao=UserDAO, model=MODEL_KEY, task_type='jimeng_multimodal')
    except Exception:
        return {**manifest, "models": models}
    state = await account_status()
    # Detailed operational diagnostics remain in the super-admin status screen.
    entry = capability(available=state["available"], reason="未启用")
    index = next((i + 1 for i, m in enumerate(models) if m.get("key") == "Seedance2"), len(models))
    models.insert(index, entry)
    return {**manifest, "models": models}
