"""Episode CRUD, duplication, and reorder route handlers."""

from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from services.project_access_service import ProjectAccessDenied, require_project_access
from services.episode_service import (
    EpisodeDuplicateFailed,
    EpisodeNotFound,
    create_episode as create_episode_service,
    delete_episode as delete_episode_service,
    duplicate_episode as duplicate_episode_service,
    get_episode as get_episode_service,
    get_workflow_script as get_workflow_script_service,
    list_episodes as list_episodes_service,
    reorder_episodes as reorder_episodes_service,
    select_workflow_script as select_workflow_script_service,
    update_episode as update_episode_service,
)


class EpisodeCreate(BaseModel):
    episode_name: str = ''
    description: str = ''


class EpisodeUpdate(BaseModel):
    episode_name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    settings: Optional[dict] = None
    sort_order: Optional[int] = None


class EpisodeReorder(BaseModel):
    episode_ids: List[str]


class WorkflowScriptSelection(BaseModel):
    script_id: str


def create_episodes_router(
    *,
    get_current_user_dependency: Any,
    episode_dao: Any,
    episode_script_dao: Any,
    project_access_checker: Any = require_project_access,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    EpisodeDAO = episode_dao
    EpisodeScriptDAO = episode_script_dao

    async def require_project(project_id: str, identity: str, role: str) -> None:
        try:
            await project_access_checker(project_id, identity, role)
        except ProjectAccessDenied as exc:
            raise HTTPException(status_code=404, detail="项目不存在或无权访问") from exc

    async def require_episode(episode_id: str, identity: str, role: str) -> str:
        project_id = await EpisodeDAO.get_project_id(episode_id)
        if not project_id:
            raise HTTPException(status_code=404, detail="集数不存在")
        await require_project(project_id, identity, role)
        return project_id

    @router.get("/api/projects/{project_id}/episodes")
    async def list_episodes(project_id: str, user_id: str = Depends(get_current_user)):
        await require_project(project_id, user_id, 'readonly')
        try:
            # route-contract anchor: list_episodes_service(project_id, episode_dao=EpisodeDAO)
            return await list_episodes_service(
                project_id,
                episode_dao=EpisodeDAO,
                episode_script_dao=EpisodeScriptDAO,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/api/projects/{project_id}/episodes")
    async def create_episode(project_id: str, data: EpisodeCreate, user_id: str = Depends(get_current_user)):
        await require_project(project_id, user_id, 'member')
        try:
            return await create_episode_service(
                project_id,
                episode_name=data.episode_name,
                description=data.description,
                episode_dao=EpisodeDAO,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.get("/api/episodes/{episode_id}")
    async def get_episode(episode_id: str, user_id: str = Depends(get_current_user)):
        await require_episode(episode_id, user_id, 'readonly')
        try:
            return await get_episode_service(episode_id, episode_dao=EpisodeDAO)
        except EpisodeNotFound as e:
            raise HTTPException(status_code=404, detail="集数不存在") from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.put("/api/episodes/{episode_id}")
    async def update_episode(episode_id: str, data: EpisodeUpdate, user_id: str = Depends(get_current_user)):
        await require_episode(episode_id, user_id, 'member')
        try:
            return await update_episode_service(
                episode_id,
                data.model_dump(),
                episode_dao=EpisodeDAO,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.get("/api/episodes/{episode_id}/workflow-script")
    async def get_workflow_script(episode_id: str, user_id: str = Depends(get_current_user)):
        await require_episode(episode_id, user_id, 'readonly')
        try:
            return await get_workflow_script_service(
                episode_id,
                episode_dao=EpisodeDAO,
                episode_script_dao=EpisodeScriptDAO,
            )
        except EpisodeNotFound as e:
            raise HTTPException(status_code=404, detail="集数或采用剧本不存在") from e

    @router.put("/api/episodes/{episode_id}/workflow-script")
    async def select_workflow_script(
        episode_id: str,
        data: WorkflowScriptSelection,
        user_id: str = Depends(get_current_user),
    ):
        await require_episode(episode_id, user_id, 'member')
        try:
            return await select_workflow_script_service(
                episode_id,
                data.script_id,
                episode_dao=EpisodeDAO,
                episode_script_dao=EpisodeScriptDAO,
            )
        except EpisodeNotFound as e:
            raise HTTPException(status_code=404, detail="集数或采用剧本不存在") from e

    @router.delete("/api/episodes/{episode_id}")
    async def delete_episode(episode_id: str, user_id: str = Depends(get_current_user)):
        await require_episode(episode_id, user_id, 'member')
        try:
            return await delete_episode_service(episode_id, episode_dao=EpisodeDAO)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/api/episodes/{episode_id}/duplicate")
    async def duplicate_episode(episode_id: str, user_id: str = Depends(get_current_user)):

        await require_episode(episode_id, user_id, 'member')
        try:
            return await duplicate_episode_service(
                episode_id,
                episode_dao=EpisodeDAO,
                episode_script_dao=EpisodeScriptDAO,
            )
        except EpisodeNotFound as e:
            raise HTTPException(status_code=404, detail="集数不存在") from e
        except EpisodeDuplicateFailed as e:
            raise HTTPException(status_code=500, detail="复制分集失败") from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/api/projects/{project_id}/episodes/reorder")
    async def reorder_episodes(project_id: str, data: EpisodeReorder, user_id: str = Depends(get_current_user)):
        await require_project(project_id, user_id, 'member')
        try:
            return await reorder_episodes_service(
                project_id,
                data.episode_ids,
                episode_dao=EpisodeDAO,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    return router
