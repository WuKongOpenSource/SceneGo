"""HTTP API for unified candidates, selections, bindings and stale content."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from services.content_workflow_service import (
    ContentBindingNotFound,
    ContentTakeNotFound,
    ContentWorkflowError,
    InvalidContentWorkflowRequest,
    delete_content_binding,
    list_content_bindings,
    list_content_takes,
    list_stale_content,
    resolve_content_bindings,
    resolve_stale_content,
    select_content_take,
    upsert_content_binding,
)
from services.project_access_service import ProjectAccessDenied, require_project_access


class TakeSelectionBody(BaseModel):
    entity_type: str
    entity_id: str
    slot: str


class StaleResolutionBody(BaseModel):
    status: str
    note: Optional[str] = None


class BindingWriteBody(BaseModel):
    episode_id: Optional[str] = None
    storyboard_item_id: Optional[str] = None
    tag_key: str
    scope: str
    asset_id: Optional[str] = None
    file_id: Optional[str] = None
    is_disabled: bool = False
    locked: bool = False


class BindingResolveBody(BaseModel):
    storyboard_item_id: str
    tag_keys: list[str] = Field(default_factory=list)


def create_content_workflow_router(
    *,
    get_current_user_dependency: Any,
    content_workflow_dao: Any,
    episode_dao: Any,
    project_access_checker: Any = require_project_access,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    WorkflowDAO = content_workflow_dao
    EpisodeDAO = episode_dao

    async def require_project(project_id: str, identity: str, role: str) -> None:
        try:
            await project_access_checker(project_id, identity, role)
        except ProjectAccessDenied as exc:
            raise HTTPException(status_code=404, detail="项目不存在") from exc

    async def require_episode(episode_id: str, identity: str, role: str) -> str:
        project_id = await EpisodeDAO.get_project_id(episode_id)
        if not project_id:
            raise HTTPException(status_code=404, detail="集不存在")
        await require_project(str(project_id), identity, role)
        return str(project_id)

    async def require_content_entity(
        entity_type: str,
        entity_id: str,
        identity: str,
        role: str,
    ) -> dict:
        context = await WorkflowDAO.resolve_entity_context(entity_type, entity_id)
        if not context or not context.get("project_id"):
            raise HTTPException(status_code=404, detail="内容不存在")
        await require_project(str(context["project_id"]), identity, role)
        return context

    @router.get("/api/content-takes")
    async def get_content_takes(
        entity_type: str,
        entity_id: str,
        slot: str,
        user_id: str = Depends(get_current_user),
    ):
        await require_content_entity(entity_type, entity_id, user_id, "readonly")
        return await list_content_takes(
            entity_type=entity_type,
            entity_id=entity_id,
            slot=slot,
            workflow_dao=WorkflowDAO,
        )

    @router.put("/api/content-takes/{take_id}/select")
    async def select_take(
        take_id: str,
        data: TakeSelectionBody,
        user_id: str = Depends(get_current_user),
    ):
        await require_content_entity(data.entity_type, data.entity_id, user_id, "member")
        try:
            return await select_content_take(
                entity_type=data.entity_type,
                entity_id=data.entity_id,
                slot=data.slot,
                take_id=take_id,
                selected_by=user_id,
                workflow_dao=WorkflowDAO,
            )
        except ContentTakeNotFound as exc:
            raise HTTPException(status_code=404, detail="候选内容不存在") from exc

    @router.get("/api/episodes/{episode_id}/stale-content")
    async def get_stale_content(
        episode_id: str,
        status: str = "pending",
        user_id: str = Depends(get_current_user),
    ):
        await require_episode(episode_id, user_id, "readonly")
        try:
            return await list_stale_content(episode_id, status=status, workflow_dao=WorkflowDAO)
        except InvalidContentWorkflowRequest as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.put("/api/stale-content/{stale_event_id}/resolve")
    async def resolve_stale(
        stale_event_id: str,
        data: StaleResolutionBody,
        user_id: str = Depends(get_current_user),
    ):
        event = await WorkflowDAO.get_stale_event(stale_event_id)
        if not event:
            raise HTTPException(status_code=404, detail="过期记录不存在")
        if event.get("episode_id"):
            await require_episode(str(event["episode_id"]), user_id, "member")
        elif event.get("project_id"):
            await require_project(str(event["project_id"]), user_id, "member")
        try:
            result = await resolve_stale_content(
                stale_event_id,
                status=data.status,
                resolved_by=user_id,
                resolution_note=data.note,
                workflow_dao=WorkflowDAO,
            )
        except InvalidContentWorkflowRequest as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except ContentWorkflowError as exc:
            raise HTTPException(status_code=404, detail="过期记录不存在") from exc
        return result

    @router.get("/api/projects/{project_id}/content-bindings")
    async def get_bindings(
        project_id: str,
        episode_id: Optional[str] = None,
        storyboard_item_id: Optional[str] = None,
        user_id: str = Depends(get_current_user),
    ):
        await require_project(project_id, user_id, "readonly")
        return await list_content_bindings(
            project_id,
            episode_id=episode_id,
            storyboard_item_id=storyboard_item_id,
            workflow_dao=WorkflowDAO,
        )

    @router.put("/api/projects/{project_id}/content-bindings")
    async def put_binding(
        project_id: str,
        data: BindingWriteBody,
        user_id: str = Depends(get_current_user),
    ):
        await require_project(project_id, user_id, "member")
        try:
            return await upsert_content_binding(
                project_id=project_id,
                episode_id=data.episode_id,
                storyboard_item_id=data.storyboard_item_id,
                tag_key=data.tag_key,
                scope=data.scope,
                asset_id=data.asset_id,
                file_id=data.file_id,
                is_disabled=data.is_disabled,
                locked=data.locked,
                user_id=user_id,
                workflow_dao=WorkflowDAO,
            )
        except InvalidContentWorkflowRequest as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.delete("/api/projects/{project_id}/content-bindings/{binding_id}")
    async def delete_binding(
        project_id: str,
        binding_id: str,
        user_id: str = Depends(get_current_user),
    ):
        await require_project(project_id, user_id, "member")
        try:
            return await delete_content_binding(
                binding_id,
                project_id=project_id,
                user_id=user_id,
                workflow_dao=WorkflowDAO,
            )
        except ContentBindingNotFound as exc:
            raise HTTPException(status_code=404, detail="绑定不存在") from exc

    @router.post("/api/projects/{project_id}/content-bindings/resolve")
    async def resolve_bindings(
        project_id: str,
        data: BindingResolveBody,
        user_id: str = Depends(get_current_user),
    ):
        await require_project(project_id, user_id, "readonly")
        try:
            return await resolve_content_bindings(
                project_id=project_id,
                storyboard_item_id=data.storyboard_item_id,
                tag_keys=data.tag_keys,
                workflow_dao=WorkflowDAO,
            )
        except InvalidContentWorkflowRequest as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return router
