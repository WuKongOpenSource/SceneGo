import pytest

from dao.business import video_reverse as video_reverse_dao


class _FakeDb:
    def __init__(self):
        self.query = ''
        self.params = ()

    async def fetch(self, query, *params):
        self.query = query
        self.params = params
        return []


@pytest.mark.asyncio
async def test_list_video_reverse_tasks_can_be_scoped_to_episode(monkeypatch):
    db = _FakeDb()
    monkeypatch.setattr(video_reverse_dao, 'get_db_manager', lambda: db)

    rows = await video_reverse_dao.VideoReverseTaskDAO.list_for_user(
        'user_1',
        project_id='proj_1',
        episode_id='ep_1',
        status='completed',
        limit=20,
        offset=5,
    )

    assert rows == []
    assert 'vrt.project_id = $2' in db.query
    assert 'vrt.episode_id = $3' in db.query
    assert 'vrt.status = $4' in db.query
    assert db.params == ('user_1', 'proj_1', 'ep_1', 'completed', 20, 5)
