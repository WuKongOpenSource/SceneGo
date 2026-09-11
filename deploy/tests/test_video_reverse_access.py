import pytest
from fastapi import HTTPException

import video_reverse_routes


@pytest.mark.asyncio
async def test_video_reverse_file_owner_is_allowed(monkeypatch):
    async def should_not_check_project(*_args, **_kwargs):
        raise AssertionError('owner access must not require a project lookup')

    monkeypatch.setattr(video_reverse_routes, 'resolve_user_id', lambda _identity: _async_value('user_owner'))
    monkeypatch.setattr(video_reverse_routes, 'require_project_access', should_not_check_project)

    await video_reverse_routes._require_video_file_access(
        {'file_id': 'file_1', 'user_id': 'user_owner', 'project_id': 'project_1'},
        'user_owner',
    )


@pytest.mark.asyncio
async def test_video_reverse_project_member_is_allowed(monkeypatch):
    calls = []

    async def require_access(project_id, user_id, required_role):
        calls.append((project_id, user_id, required_role))
        return 'canonical-member'

    monkeypatch.setattr(video_reverse_routes, 'resolve_user_id', lambda _identity: _async_value('canonical-member'))
    monkeypatch.setattr(video_reverse_routes, 'require_project_access', require_access)

    await video_reverse_routes._require_video_file_access(
        {'file_id': 'file_1', 'user_id': 'user_owner', 'project_id': 'project_1'},
        'user_member',
    )

    assert calls == [('project_1', 'user_member', 'readonly')]


@pytest.mark.asyncio
async def test_video_reverse_stranger_receives_not_found(monkeypatch):
    async def deny(*_args, **_kwargs):
        raise video_reverse_routes.ProjectAccessDenied('denied')

    monkeypatch.setattr(video_reverse_routes, 'resolve_user_id', lambda _identity: _async_value('canonical-stranger'))
    monkeypatch.setattr(video_reverse_routes, 'require_project_access', deny)

    with pytest.raises(HTTPException) as exc_info:
        await video_reverse_routes._require_video_file_access(
            {'file_id': 'file_1', 'user_id': 'user_owner', 'project_id': 'project_1'},
            'user_stranger',
        )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == '视频文件不存在'


@pytest.mark.asyncio
async def test_video_reverse_legacy_unscoped_file_is_owner_only(monkeypatch):
    async def should_not_check_project(*_args, **_kwargs):
        raise AssertionError('unscoped legacy files must not inherit unrelated access')

    monkeypatch.setattr(video_reverse_routes, 'resolve_user_id', lambda _identity: _async_value('canonical-stranger'))
    monkeypatch.setattr(video_reverse_routes, 'require_project_access', should_not_check_project)

    with pytest.raises(HTTPException) as exc_info:
        await video_reverse_routes._require_video_file_access(
            {'file_id': 'file_legacy', 'user_id': 'user_owner', 'project_id': None},
            'user_stranger',
        )

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_video_reverse_segments_include_keyframe_file_details(monkeypatch):
    async def get_file(file_id):
        return {
            "file_id": file_id,
            "file_url": f"/api/files/{file_id}/download",
            "thumbnail_url": None,
            "file_name": f"{file_id}.jpg",
        }

    monkeypatch.setattr(video_reverse_routes.FileDAO, "get_file", get_file)

    segments = await video_reverse_routes._attach_frame_file_details_to_segments([
        {
            "segment_id": "seg_1",
            "frame_file_ids": ["frame_1", "frame_2"],
        },
    ])

    assert segments[0]["keyframe_file_id"] == "frame_1"
    assert segments[0]["keyframe_file_url"] == "/api/files/frame_1/download"
    assert segments[0]["frame_files"][0]["file_id"] == "frame_1"


async def _async_value(value):
    return value
