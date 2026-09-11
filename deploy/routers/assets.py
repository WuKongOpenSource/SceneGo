"""Project asset CRUD and asset sharing routes."""

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from services.project_access_service import ProjectAccessDenied, require_project_access
from services.asset_service import (
    AssetCreateFailed,
    AssetNotFound,
    create_asset as create_asset_service,
    delete_asset as delete_asset_service,
    list_sync_existing_design_candidates,
    list_assets,
    share_asset as share_asset_service,
    sync_existing_designs as sync_existing_designs_service,
    update_asset as update_asset_service,
)


def create_assets_router(
    *,
    get_current_user_dependency: Any,
    asset_dao: Any,
    entity_file_dao: Any,
    logger: logging.Logger,
    episode_dao: Any = None,
    project_access_checker: Any = require_project_access,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    AssetDAO = asset_dao
    EntityFileDAO = entity_file_dao
    EpisodeDAO = episode_dao

    async def require_project(project_id: str, identity: str, role: str) -> None:
        try:
            await project_access_checker(project_id, identity, role)
        except ProjectAccessDenied as exc:
            raise HTTPException(status_code=404, detail="资产不存在或无权访问") from exc

    async def require_episode_project(episode_id: str, project_id: str, identity: str, role: str) -> None:
        if EpisodeDAO is None:
            raise HTTPException(status_code=503, detail="集数服务不可用")
        actual_project_id = await EpisodeDAO.get_project_id(episode_id)
        if actual_project_id != project_id:
            raise HTTPException(status_code=404, detail="集不存在")
        await require_project(project_id, identity, role)

    async def require_asset(asset_id: str, identity: str, role: str) -> dict:
        asset = await AssetDAO.get_by_id(asset_id)
        if not asset:
            raise HTTPException(status_code=404, detail="资产不存在")
        await require_project(asset['project_id'], identity, role)
        return asset

    class AssetCreate(BaseModel):
        project_id: str
        asset_type: str
        name: str
        episode_id: Optional[str] = None
        script_id: Optional[str] = None
        description: Optional[str] = ""
        reference_images: Optional[list] = None

    class AssetUpdate(BaseModel):
        name: Optional[str] = None
        description: Optional[str] = None
        thumbnail_url: Optional[str] = None
        episode_id: Optional[str] = None
        reference_images: Optional[list] = None
        style_params: Optional[dict] = None
        tags: Optional[list] = None

    class AssetShareRequest(BaseModel):
        target_episode_id: str
        target_script_id: str

    class AssetSyncExistingDesignsRequest(BaseModel):
        episode_id: str
        script_id: Optional[str] = None
        asset_types: Optional[list[str]] = None
        overwrite: bool = False
        source_asset_ids: Optional[list[str]] = None

    @router.get("/api/projects/{project_id}/assets")
    async def get_assets(
        project_id: str,
        episode_id: Optional[str] = None,
        asset_type: Optional[str] = None,
        script_id: Optional[str] = None,
        user_id: str = Depends(get_current_user),
    ):
        await require_project(project_id, user_id, 'readonly')
        if episode_id:
            await require_episode_project(episode_id, project_id, user_id, 'readonly')
        return await list_assets(
            project_id,
            episode_id=episode_id,
            asset_type=asset_type,
            script_id=script_id,
            asset_dao=AssetDAO,
            entity_file_dao=EntityFileDAO,
        )

    @router.post("/api/assets")
    async def create_asset(data: AssetCreate, user_id: str = Depends(get_current_user)):
        await require_project(data.project_id, user_id, 'member')
        if data.episode_id:
            await require_episode_project(data.episode_id, data.project_id, user_id, 'member')
        try:
            return await create_asset_service(
                project_id=data.project_id,
                asset_type=data.asset_type,
                name=data.name,
                user_id=user_id,
                episode_id=data.episode_id,
                script_id=data.script_id,
                description=data.description,
                reference_images=data.reference_images,
                asset_dao=AssetDAO,
            )
        except AssetCreateFailed as exc:
            raise HTTPException(status_code=500, detail="创建资产失败") from exc

    @router.put("/api/assets/{asset_id}")
    async def update_asset(asset_id: str, data: AssetUpdate, user_id: str = Depends(get_current_user)):
        asset = await require_asset(asset_id, user_id, 'member')
        if data.episode_id:
            await require_episode_project(data.episode_id, asset['project_id'], user_id, 'member')
        try:
            return await update_asset_service(
                asset_id,
                data.model_dump(exclude_none=True),
                asset_dao=AssetDAO,
            )
        except AssetNotFound as exc:
            raise HTTPException(status_code=404, detail="资产不存在") from exc

    @router.delete("/api/assets/{asset_id}")
    async def delete_asset(asset_id: str, user_id: str = Depends(get_current_user)):
        await require_asset(asset_id, user_id, 'member')
        try:
            return await delete_asset_service(asset_id, asset_dao=AssetDAO)
        except AssetNotFound as exc:
            raise HTTPException(status_code=404, detail="资产不存在") from exc

    @router.post("/api/assets/{asset_id}/share")
    async def share_asset(asset_id: str, data: AssetShareRequest, user_id: str = Depends(get_current_user)):
        """Copy an asset to a target episode/script, including linked entity files."""
        asset = await require_asset(asset_id, user_id, 'member')
        await require_episode_project(data.target_episode_id, asset['project_id'], user_id, 'member')
        try:
            return await share_asset_service(
                asset_id,
                target_episode_id=data.target_episode_id,
                target_script_id=data.target_script_id,
                user_id=user_id,
                asset_dao=AssetDAO,
                entity_file_dao=EntityFileDAO,
                logger=logger,
            )
        except AssetNotFound as exc:
            raise HTTPException(status_code=404, detail="源资产不存在") from exc

    @router.post("/api/projects/{project_id}/assets/sync-existing-designs")
    async def sync_existing_designs(
        project_id: str,
        data: AssetSyncExistingDesignsRequest,
        user_id: str = Depends(get_current_user),
    ):
        """Sync same-name character/scene/prop designs from other episodes into the current episode."""
        await require_episode_project(data.episode_id, project_id, user_id, 'member')
        return await sync_existing_designs_service(
            project_id=project_id,
            episode_id=data.episode_id,
            script_id=data.script_id,
            asset_types=data.asset_types,
            overwrite=data.overwrite,
            source_asset_ids=data.source_asset_ids,
            user_id=user_id,
            asset_dao=AssetDAO,
            entity_file_dao=EntityFileDAO,
            logger=logger,
        )

    @router.get("/api/projects/{project_id}/assets/sync-existing-designs/candidates")
    async def get_sync_existing_design_candidates(
        project_id: str,
        episode_id: str,
        script_id: Optional[str] = None,
        asset_types: Optional[str] = None,
        user_id: str = Depends(get_current_user),
    ):
        await require_episode_project(episode_id, project_id, user_id, 'readonly')
        requested_types = [item.strip() for item in asset_types.split(",") if item.strip()] if asset_types else None
        return await list_sync_existing_design_candidates(
            project_id=project_id,
            episode_id=episode_id,
            script_id=script_id,
            asset_types=requested_types,
            asset_dao=AssetDAO,
            entity_file_dao=EntityFileDAO,
            episode_dao=EpisodeDAO,
        )

    return router
