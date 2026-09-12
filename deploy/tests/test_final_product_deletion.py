from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

import media_library_routes as routes
from services import media_library_service as service
from dao.creative import media_library as dao
import dao_final_product_share as share_dao


@pytest.mark.asyncio
@pytest.mark.parametrize('user,status', [('owner', 200), ('visitor', 403)])
async def test_final_delete_preserves_owner_permission_and_targets_only_selected_item(monkeypatch, user, status):
    item = {'library_item_id': 'final-one', 'source': 'composed_final', 'user_id': 'owner', 'project_id': 'project'}
    monkeypatch.setattr(service.MediaLibraryDAO, 'get', AsyncMock(return_value=item))
    deleted = AsyncMock()
    monkeypatch.setattr(service.MediaLibraryDAO, 'soft_delete', deleted)
    monkeypatch.setattr(service.ProjectMemberDAO, 'check_permission', AsyncMock(return_value=False))
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[routes.get_current_user] = lambda: user
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        response = await client.delete('/api/media-library/items/final-one?reason=discard')
    assert response.status_code == status
    if status == 200:
        deleted.assert_awaited_once_with('final-one', deleted_by='owner', deleted_reason='discard')
    else:
        deleted.assert_not_awaited()


@pytest.mark.asyncio
async def test_soft_delete_does_not_delete_underlying_files_or_timeline(monkeypatch):
    database = AsyncMock()
    monkeypatch.setattr(dao, 'get_db_manager', lambda: database)
    await dao.MediaLibraryDAO.soft_delete('final-one', deleted_by='owner')
    database.execute.assert_awaited_once()
    sql, *params = database.execute.await_args.args
    assert 'UPDATE media_library_items' in sql
    assert 'is_deleted = TRUE' in sql
    assert 'WHERE library_item_id = $1' in sql
    assert params[0] == 'final-one'
    assert 'DELETE FROM' not in sql
    assert 'UPDATE files' not in sql
    assert 'timeline' not in sql


@pytest.mark.asyncio
async def test_deleted_final_is_excluded_from_existing_public_share(monkeypatch):
    database = AsyncMock()
    database.fetchrow.return_value = None
    monkeypatch.setattr(share_dao, 'get_db_manager', lambda: database)
    assert await share_dao.FinalProductShareDAO.get_public('existing-token') is None
    sql = database.fetchrow.await_args.args[0]
    assert 'ml.is_deleted = FALSE' in sql
    assert 'f.is_deleted = FALSE' in sql
