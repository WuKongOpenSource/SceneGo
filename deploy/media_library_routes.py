








from __future__ import annotations

import logging
import os
import tempfile
import zipfile
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import media_library_service
from services.request_auth_service import get_current_user
from core.database_config import StorageConfig
from dao_content import FileDAO
from dao_media_library import MediaLibraryDAO
from dao_media_library_folder import MediaLibraryFolderDAO
from file_service import save_generated_file_to_db
from services.project_access_service import ProjectAccessDenied, require_project_access
from services.local_file_access_service import resolve_allowed_media_file
from services.upload_stream_service import UploadPayloadTooLarge, read_upload_limited

logger = logging.getLogger(__name__)

_BATCH_ARCHIVE_MEMORY_BYTES = 8 * 1024 * 1024
_BATCH_ARCHIVE_DEFAULT_MAX_BYTES = 512 * 1024 * 1024
_BATCH_ARCHIVE_MIN_BYTES = 1 * 1024 * 1024
_BATCH_ARCHIVE_MAX_BYTES = 10 * 1024 * 1024 * 1024

router = APIRouter(prefix="/api/media-library", tags=["media-library"])




class MediaItemUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    permission_scope: Optional[str] = None  # private | project | team | public_link
    is_favorite: Optional[bool] = None
    project_id: Optional[str] = None
    episode_id: Optional[str] = None
    folder_id: Optional[str] = None


class FolderCreateRequest(BaseModel):
    project_id: str
    name: str
    parent_folder_id: Optional[str] = None
    folder_order: Optional[int] = 0


class FolderUpdateRequest(BaseModel):
    name: Optional[str] = None
    parent_folder_id: Optional[str] = None
    folder_order: Optional[int] = None


class MediaItemUseRequest(BaseModel):
    usage_context: str  # image_gen_reference | video_reverse_input | char_asset_bind | ...
    task_id: Optional[str] = None
    project_id: Optional[str] = None
    target_entity_type: Optional[str] = None
    target_entity_id: Optional[str] = None


class BatchDownloadRequest(BaseModel):
    library_item_ids: List[str]




def _file_ext_to_type(filename: str, content_type: Optional[str] = None) -> str:
    name = (filename or '').lower()
    if any(name.endswith(ext) for ext in ('.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp')):
        return 'image'
    if any(name.endswith(ext) for ext in ('.mp4', '.mov', '.webm', '.mkv', '.avi')):
        return 'video'
    if any(name.endswith(ext) for ext in ('.mp3', '.wav', '.ogg', '.m4a', '.flac')):
        return 'audio'
    ct = (content_type or '').lower()
    if ct.startswith('image/'):
        return 'image'
    if ct.startswith('video/'):
        return 'video'
    if ct.startswith('audio/'):
        return 'audio'
    return 'other'


def _safe_zip_component(value: object, *, fallback: str, max_length: int = 120) -> str:
    """Return one non-traversing ZIP path component from user/database text."""
    normalized = str(value or '').replace('\\', '/').rsplit('/', 1)[-1]
    clean = ''.join(
        character if (character.isalnum() or character in '._- ') else '_'
        for character in normalized
        if ord(character) >= 32
    ).strip(' .')
    return (clean or fallback)[:max_length].rstrip(' .') or fallback


def _safe_zip_entry_name(item: dict, file_record: dict, path: Path) -> str:
    item_id = _safe_zip_component(
        item.get('library_item_id'),
        fallback='media',
        max_length=80,
    )
    display_name = _safe_zip_component(
        item.get('title') or file_record.get('file_name') or path.name,
        fallback=path.name or 'media.bin',
    )
    if not Path(display_name).suffix and path.suffix:
        display_name = f"{display_name}{path.suffix.lower()}"
    return f"{item_id}_{display_name}"


def _batch_download_max_bytes() -> int:
    try:
        value = int(
            os.getenv(
                'MEDIA_LIBRARY_BATCH_DOWNLOAD_MAX_BYTES',
                str(_BATCH_ARCHIVE_DEFAULT_MAX_BYTES),
            )
        )
    except (TypeError, ValueError):
        value = _BATCH_ARCHIVE_DEFAULT_MAX_BYTES
    return max(_BATCH_ARCHIVE_MIN_BYTES, min(value, _BATCH_ARCHIVE_MAX_BYTES))


def _stream_spooled_archive(archive, *, chunk_size: int = 1024 * 1024):
    try:
        while chunk := archive.read(chunk_size):
            yield chunk
    finally:
        archive.close()


async def _check_project_access(project_id: Optional[str], user_id: str, *, required_role: str = 'readonly') -> bool:

    if not project_id:
        return True
    try:
        await require_project_access(project_id, user_id, required_role)
        return True
    except ProjectAccessDenied:
        return False




@router.get("/items")
async def list_media_items(
    request: Request,
    user_id: str = Depends(get_current_user),
    project_id: Optional[str] = None,
    episode_id: Optional[str] = None,
    item_type: Optional[str] = None,
    source: Optional[str] = None,
    permission_scope: Optional[str] = None,
    include_shared: bool = False,
    is_favorite: Optional[bool] = None,
    keyword: Optional[str] = None,
    tag: Optional[str] = None,
    folder_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    org_id: Optional[str] = None,
):






    try:
        limit = max(1, min(limit, 500))
        offset = max(0, offset)
        if org_id:
            try:
                from dao_organization import OrganizationMemberDAO
                if not await OrganizationMemberDAO.is_member(org_id, user_id):
                    raise HTTPException(status_code=403, detail="不是该组织成员")
            except HTTPException:
                raise
            except Exception as e:
                logger.warning(f"org membership check failed user_id={user_id} org_id={org_id} err={e}")
        result = await media_library_service.list_items(
            user_id=user_id,
            project_id=project_id,
            episode_id=episode_id,
            include_shared=include_shared,
            item_type=item_type,
            source=source,
            permission_scope=permission_scope,
            is_favorite=is_favorite,
            keyword=keyword,
            tag=tag,
            folder_id=folder_id,
            limit=limit,
            offset=offset,
            org_id=org_id,
        )
        return {"success": True, **result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"列出素材失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload")
async def upload_media_item(
    file: UploadFile = File(...),
    project_id: Optional[str] = Form(None),
    episode_id: Optional[str] = Form(None),
    permission_scope: str = Form('private'),
    title: Optional[str] = Form(None),
    description: Optional[str] = Form(''),
    tags: Optional[str] = Form(None),  # JSON-encoded array
    visibility: str = Form('private'),  # 2026-05-26 Slice 5: 'private' | 'org-default'
    org_id: Optional[str] = Form(None),
    folder_id: Optional[str] = Form(None),
    user_id: str = Depends(get_current_user),
):






    if project_id and not await _check_project_access(project_id, user_id, required_role='member'):
        raise HTTPException(status_code=403, detail="无权在该项目上传素材")

    if permission_scope not in ('private', 'project', 'team', 'public_link'):
        raise HTTPException(status_code=400, detail="permission_scope 非法")
    if permission_scope == 'project' and not project_id:
        raise HTTPException(status_code=400, detail="项目共享需要指定 project_id")

    if visibility not in ('private', 'org-default'):
        visibility = 'private'
    if visibility == 'org-default' and not org_id:
        raise HTTPException(status_code=400, detail="visibility='org-default' 必须传 org_id")
    if org_id:

        from dao_organization import OrganizationMemberDAO
        if not await OrganizationMemberDAO.is_member(org_id, user_id):
            raise HTTPException(status_code=403, detail="不是该组织的成员")


    folder_id = folder_id or None
    if folder_id:
        folder = await MediaLibraryFolderDAO.get(folder_id)
        if not folder:
            raise HTTPException(status_code=400, detail="目标文件夹不存在")
        if project_id and folder['project_id'] != project_id:
            raise HTTPException(status_code=400, detail="文件夹不属于该项目")
        if not project_id:
            project_id = folder['project_id']

    try:
        tags_list: List[str] = []
        if tags:
            try:
                import json as _json
                tags_list = _json.loads(tags)
                if not isinstance(tags_list, list):
                    tags_list = []
            except Exception:
                tags_list = []

        original_ext = Path(file.filename or '').suffix or ''
        file_type = _file_ext_to_type(file.filename or '', file.content_type)

        try:
            content = await read_upload_limited(file, max_bytes=StorageConfig.MAX_UPLOAD_SIZE)
        except UploadPayloadTooLarge as exc:
            raise HTTPException(status_code=413, detail="文件太大") from exc
        if not content:
            raise HTTPException(status_code=400, detail="文件为空")

        save_result = await save_generated_file_to_db(
            content=content,
            file_type=file_type,
            user_id=user_id,
            source='upload',
            original_ext=original_ext or '.bin',
            episode_id=episode_id,
            extra_metadata={
                'original_filename': file.filename,
                'mime_type': file.content_type,
                'uploaded_via': 'media_library',
            },
        )
        file_id = save_result.get('file_id')
        file_url = save_result.get('file_url')
        if not file_id:
            raise HTTPException(status_code=500, detail="文件保存失败")

        file_record = await FileDAO.get_file(file_id) or {
            'file_id': file_id,
            'user_id': user_id,
            'file_type': file_type,
            'file_name': file.filename,
            'file_url': file_url,
        }

        item = await media_library_service.create_from_file(
            file_record=file_record,
            source='upload',
            project_id=project_id,
            episode_id=episode_id,
            title=title or file.filename,
            description=description or '',
            tags=tags_list,
            permission_scope=permission_scope,
            metadata={'mime_type': file.content_type, 'original_filename': file.filename},
            raise_on_error=True,
            visibility=visibility,
            folder_id=folder_id,
        )


        if visibility == 'org-default' and org_id and item.get('library_item_id'):
            try:
                from dao_resource_share import ResourceShareDAO
                await ResourceShareDAO.create(
                    resource_type='media',
                    resource_id=item['library_item_id'],
                    share_target_type='org',
                    share_target_id=org_id,
                    granted_by_user_id=user_id,
                )
            except Exception as _e:
                logger.warning(f"自动 share media→org 失败: {_e}")

        return {
            "success": True,
            "library_item_id": item['library_item_id'],
            "file_id": file_id,
            "file_url": file_url,
            "item": item,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"上传素材失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/items/{library_item_id}")
async def get_media_item(
    library_item_id: str,
    user_id: str = Depends(get_current_user),
):
    item = await media_library_service.get_item(library_item_id, user_id)
    if not item:
        raise HTTPException(status_code=404, detail="素材不存在或无权访问")
    return {"success": True, "item": item}


@router.patch("/items/{library_item_id}")
async def patch_media_item(
    library_item_id: str,
    payload: MediaItemUpdateRequest,
    user_id: str = Depends(get_current_user),
):
    fields = {k: v for k, v in payload.dict().items() if v is not None}

    if 'folder_id' in fields and not fields['folder_id']:
        fields['folder_id'] = None
    if not fields:
        raise HTTPException(status_code=400, detail="未提供可更新字段")
    if 'permission_scope' in fields and fields['permission_scope'] not in (
        'private', 'project', 'team', 'public_link',
    ):
        raise HTTPException(status_code=400, detail="permission_scope 非法")

    if fields.get('folder_id'):
        target = await MediaLibraryFolderDAO.get(fields['folder_id'])
        if not target:
            raise HTTPException(status_code=400, detail="目标文件夹不存在")
    try:
        item = await media_library_service.update_item(library_item_id, user_id, fields)
        if not item:
            raise HTTPException(status_code=404, detail="素材不存在")
        return {"success": True, "item": item}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.delete("/items/{library_item_id}")
async def delete_media_item(
    library_item_id: str,
    user_id: str = Depends(get_current_user),
    reason: Optional[str] = None,
):
    try:
        ok = await media_library_service.soft_delete_item(library_item_id, user_id, reason)
        if not ok:
            raise HTTPException(status_code=404, detail="素材不存在")
        return {"success": True}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.post("/items/{library_item_id}/use")
async def use_media_item(
    library_item_id: str,
    payload: MediaItemUseRequest,
    user_id: str = Depends(get_current_user),
):
    if not payload.usage_context:
        raise HTTPException(status_code=400, detail="usage_context 不能为空")
    try:
        usage = await media_library_service.record_usage(
            library_item_id=library_item_id,
            user_id=user_id,
            usage_context=payload.usage_context,
            project_id=payload.project_id,
            task_id=payload.task_id,
            target_entity_type=payload.target_entity_type,
            target_entity_id=payload.target_entity_id,
        )
        if not usage:
            raise HTTPException(status_code=404, detail="素材不存在")
        return {"success": True, "usage": usage}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.post("/batch-download")
async def batch_download(
    payload: BatchDownloadRequest,
    user_id: str = Depends(get_current_user),
):

    if not payload.library_item_ids:
        raise HTTPException(status_code=400, detail="未指定素材")
    if len(payload.library_item_ids) > 200:
        raise HTTPException(status_code=400, detail="单次最多打包 200 个素材")

    accessible: List[dict] = []
    for lid in payload.library_item_ids:
        item = await media_library_service.get_item(lid, user_id)
        if item:
            accessible.append(item)

    if not accessible:
        raise HTTPException(status_code=404, detail="没有可访问的素材")

    archive = tempfile.SpooledTemporaryFile(max_size=_BATCH_ARCHIVE_MEMORY_BYTES, mode='w+b')
    total_bytes = 0
    included_count = 0
    try:
        with zipfile.ZipFile(archive, mode='w', compression=zipfile.ZIP_DEFLATED) as zf:
            for it in accessible:
                file_record = await FileDAO.get_file(it['file_id'])
                if not file_record:
                    continue
                file_path = file_record.get('file_path')
                resolved = (
                    resolve_allowed_media_file(
                        file_path,
                        deploy_root=Path(__file__).resolve().parent,
                    )
                    if file_path
                    else None
                )
                if resolved is None:
                    continue
                try:
                    file_size = resolved.stat().st_size
                    if total_bytes + file_size > _batch_download_max_bytes():
                        raise HTTPException(status_code=413, detail="批量下载素材总大小超过限制")
                    zf.write(
                        resolved,
                        arcname=_safe_zip_entry_name(it, file_record, resolved),
                    )
                    total_bytes += file_size
                    included_count += 1
                except HTTPException:
                    raise
                except Exception as e:
                    logger.warning(f"打包素材 {it['library_item_id']} 失败: {e}")
        if included_count == 0:
            raise HTTPException(status_code=404, detail="没有可下载的素材文件")
        archive.seek(0)
    except Exception:
        archive.close()
        raise

    return StreamingResponse(
        _stream_spooled_archive(archive),
        media_type='application/zip',
        headers={
            'Content-Disposition': 'attachment; filename="media_library_export.zip"',
        },
    )




@router.get("/folders")
async def list_folders(
    project_id: str,
    user_id: str = Depends(get_current_user),
):

    if not await _check_project_access(project_id, user_id, required_role='readonly'):
        raise HTTPException(status_code=403, detail="无权访问该项目")
    folders = await MediaLibraryFolderDAO.list_by_project(project_id)
    return {"success": True, "folders": folders}


@router.post("/folders")
async def create_folder(
    payload: FolderCreateRequest,
    user_id: str = Depends(get_current_user),
):
    if not (payload.name or '').strip():
        raise HTTPException(status_code=400, detail="文件夹名不能为空")
    if not await _check_project_access(payload.project_id, user_id, required_role='member'):
        raise HTTPException(status_code=403, detail="无权在该项目创建文件夹")

    if payload.parent_folder_id:
        parent = await MediaLibraryFolderDAO.get(payload.parent_folder_id)
        if not parent or parent['project_id'] != payload.project_id:
            raise HTTPException(status_code=400, detail="父文件夹无效")
    folder = await MediaLibraryFolderDAO.create(
        project_id=payload.project_id,
        name=payload.name.strip(),
        parent_folder_id=payload.parent_folder_id,
        folder_order=payload.folder_order or 0,
    )
    return {"success": True, "folder": folder}


@router.patch("/folders/{folder_id}")
async def update_folder(
    folder_id: str,
    payload: FolderUpdateRequest,
    user_id: str = Depends(get_current_user),
):
    folder = await MediaLibraryFolderDAO.get(folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")
    if not await _check_project_access(folder['project_id'], user_id, required_role='member'):
        raise HTTPException(status_code=403, detail="无权修改该文件夹")

    fields = payload.dict(exclude_unset=True)
    if 'name' in fields:
        if not (fields['name'] or '').strip():
            raise HTTPException(status_code=400, detail="文件夹名不能为空")
        fields['name'] = fields['name'].strip()

    if 'parent_folder_id' in fields:
        new_parent = fields['parent_folder_id'] or None
        fields['parent_folder_id'] = new_parent
        if new_parent:
            parent = await MediaLibraryFolderDAO.get(new_parent)
            if not parent or parent['project_id'] != folder['project_id']:
                raise HTTPException(status_code=400, detail="父文件夹无效")
            if await MediaLibraryFolderDAO.would_create_cycle(folder_id, new_parent):
                raise HTTPException(status_code=400, detail="不能移动到自身或其子文件夹下")

    updated = await MediaLibraryFolderDAO.update(folder_id, fields)
    return {"success": True, "folder": updated}


@router.delete("/folders/{folder_id}")
async def delete_folder(
    folder_id: str,
    user_id: str = Depends(get_current_user),
):
    folder = await MediaLibraryFolderDAO.get(folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")
    if not await _check_project_access(folder['project_id'], user_id, required_role='member'):
        raise HTTPException(status_code=403, detail="无权删除该文件夹")

    ok = await MediaLibraryFolderDAO.delete(folder_id)
    return {"success": ok}
