"""Authenticated creator-side project-group routes."""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from services import project_group_service as service


class GroupNameBody(BaseModel):
    group_name: str


def create_project_groups_router(*, get_current_user_dependency: Any) -> APIRouter:
    router = APIRouter()

    @router.get('/api/project-groups')
    async def list_groups(user_id: str = Depends(get_current_user_dependency)):
        groups = await service.ProjectGroupDAO.list_for_user(user_id)
        return {'success': True, 'groups': groups}

    @router.post('/api/project-groups', status_code=201)
    async def create_group(body: GroupNameBody, user_id: str = Depends(get_current_user_dependency)):
        try:
            group = await service.create_group(user_id, body.group_name)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {'success': True, 'group': group}

    @router.put('/api/project-groups/{group_id}')
    async def rename_group(group_id: str, body: GroupNameBody, user_id: str = Depends(get_current_user_dependency)):
        try:
            group = await service.rename_group(user_id, group_id, body.group_name)
        except ValueError as exc:
            raise HTTPException(status_code=getattr(exc, 'status_code', 400), detail=str(exc)) from exc
        return {'success': True, 'group': group}

    @router.delete('/api/project-groups/{group_id}')
    async def delete_group(group_id: str, user_id: str = Depends(get_current_user_dependency)):
        try:
            await service.delete_group(user_id, group_id)
        except service.GroupAccessError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        return {'success': True}

    return router
