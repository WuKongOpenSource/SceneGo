from dao.creative import episode_compose as episode_compose_module


class FakeDB:
    def __init__(self, rows):
        self.rows = rows
        self.query = ""
        self.params = ()

    async def fetch(self, query, *params):
        self.query = query
        self.params = params
        return self.rows


async def test_list_shot_takes_falls_back_to_latest_entity_video(monkeypatch):
    rows = [
        {
            "item_id": "shot_1",
            "segment_id": "seg_1",
            "video_url": "/storage/videos/latest.mp4",
        }
    ]
    db = FakeDB(rows)
    monkeypatch.setattr(episode_compose_module, "get_db_manager", lambda: db)

    result = await episode_compose_module.EpisodeComposeDAO.list_shot_take_rows("ep_1")

    assert result == rows
    assert db.params == ("ep_1",)
    assert "LEFT JOIN LATERAL" in db.query
    assert "f.entity_type = 'video_segment'" in db.query
    assert "f.file_role = 'video'" in db.query
    assert "f.is_deleted = FALSE" in db.query
    assert "ORDER BY f.is_selected DESC, f.created_at DESC" in db.query
    assert "COALESCE(entity_video.file_url, vs.video_url)" in db.query
