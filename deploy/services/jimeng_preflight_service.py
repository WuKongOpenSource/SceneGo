"""Server-authoritative validation before reserving platform points."""
import asyncio
import tempfile
from pathlib import Path

from fastapi import HTTPException
from services.jimeng_contract import TASK_TYPE, JimengError, normalize_jimeng_options
from services.jimeng_cli_runtime import CliConfig, JimengCli
from services.jimeng_media_service import inspect_inputs, trace_inputs
from services.generation_access_service import GenerationAccessDenied
from services.jimeng_access_service import JimengAccessDenied, require_jimeng_admin


async def preflight_jimeng(task_type, task_data, user_id):
    if task_type != TASK_TYPE:
        return
    try:
        await require_jimeng_admin(user_id)
    except JimengAccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="暂时无法核实管理员权限，本次未提交，请稍后重试。") from exc
    from dao.content.content import FileDAO
    from dao.business.jimeng_job import JimengJobDAO
    try:
        data = normalize_jimeng_options({**task_data, "task_type": task_type})
        # A client cannot forge billing reservations, account binding or source traces.
        for key in list(data):
            if key.startswith("_") or key in {"jimeng_binding", "input_trace", "duration_seconds"}:
                data.pop(key)
        config = await asyncio.to_thread(CliConfig.load)
        await JimengCli(config).account_status()
        if await JimengJobDAO.review_count(config.account_id):
            raise JimengError("即梦账号存在提交结果待核查任务，已暂停新提交；请管理员先核查原任务。")
        with tempfile.TemporaryDirectory(prefix="jimeng-preflight-") as temporary:
            inputs = await inspect_inputs(data, user_id, file_dao=FileDAO, directory=Path(temporary))
        data["media_inputs"] = [
            {"kind": entry["kind"], "file_id": entry["file_id"],
             **({"duration_seconds": entry["duration_seconds"]} if "duration_seconds" in entry else {})}
            for entry in inputs]
        data["_jimeng_input_trace"] = trace_inputs(inputs)
        data["_jimeng_binding"] = {"account_id": config.account_id, "session_id": config.session_id,
                                   "state_id": config.state_id}
        task_data.clear()
        task_data.update(data)
    except JimengError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except GenerationAccessDenied as exc:
        raise HTTPException(status_code=403, detail="无权使用当前项目或参考原素材。") from exc
