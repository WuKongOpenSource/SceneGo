from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from services.jimeng_result_service import attach_generated_result


@pytest.mark.asyncio
@pytest.mark.parametrize('attached,newest,expected_writes', [(True, 'task_current', 0), (False, 'task_newer', 1), (False, 'task_current', 3)])
async def test_result_binds_once_without_overwriting_later_selection(attached, newest, expected_writes):
    @asynccontextmanager
    async def transaction():
        yield
    conn = SimpleNamespace(transaction=transaction, execute=AsyncMock(), fetchval=AsyncMock(return_value=newest),
        fetchrow=AsyncMock(side_effect=[{'segment_id': 'seg', 'episode_id': 'ep'},
                                      {'file_id': 'file_result', 'is_selected': False, 'attached': 'true' if attached else None}]))
    @asynccontextmanager
    async def acquire():
        yield conn
    await attach_generated_result(SimpleNamespace(acquire=acquire), 'seg', 'ep', 'task_current', 'file_result', '/storage/result.mp4', 5088)
    assert conn.execute.await_count == expected_writes
    queries = [call.args[0] for call in conn.execute.await_args_list]
    assert not any('input_params' in query or 'enhance_sessions' in query for query in queries)
    if newest == 'task_newer' or attached:
        assert not any('UPDATE video_segments' in query for query in queries)
