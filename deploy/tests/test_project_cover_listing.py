from __future__ import annotations

import pytest

from dao.content import content as content_dao


class _RecordingDB:
    def __init__(self) -> None:
        self.queries: list[str] = []

    async def fetch(self, query: str, *_args):
        self.queries.append(query)
        return []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("loader", "args"),
    [
        (content_dao.ProjectDAO.get_user_projects, ("user_1", True)),
        (content_dao.ProjectDAO.get_projects_for_org, ("user_1", "org_1", True)),
        (content_dao.ProjectMemberDAO.get_user_accessible_projects, ("user_1", True)),
        (content_dao.ProjectMemberDAO.get_org_accessible_projects, ("user_1", "org_1", True)),
    ],
)
async def test_project_list_queries_return_persisted_cover_and_tags(monkeypatch, loader, args):
    db = _RecordingDB()
    monkeypatch.setattr(content_dao, "get_db_manager", lambda: db)

    await loader(*args)

    assert len(db.queries) == 1
    normalized_query = " ".join(db.queries[0].split())
    assert "p.cover_url" in normalized_query
    assert "p.tags" in normalized_query
