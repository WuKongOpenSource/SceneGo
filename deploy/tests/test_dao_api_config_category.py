
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from dao.admin import api_config as api_config_module


@pytest.fixture
def mock_db(monkeypatch):
    db = MagicMock()
    db.fetchrow = AsyncMock(return_value={"config_id": "apicfg_test1"})
    db.execute = AsyncMock(return_value="UPDATE 1")
    monkeypatch.setattr(api_config_module, "get_db_manager", lambda: db)
    return db


async def test_create_passes_category_to_sql(mock_db):
    await api_config_module.ApiConfigDAO.create(
        name="飞升 Test",
        provider="seedance",
        endpoint="https://x",
        api_key="k",
        model_name="doubao-seedance-2-0",
        category="video",
    )

    args = mock_db.fetchrow.await_args.args
    sql = args[0]
    assert "category" in sql, f"INSERT SQL 应包含 category 列: {sql}"

    assert "video" in args, f"category 'video' 应作为 bind 参数传入: {args}"


async def test_create_defaults_category_to_empty_string(mock_db):
    await api_config_module.ApiConfigDAO.create(
        name="未分类",
        provider="custom",
        endpoint="https://y",
        api_key="k2",
    )
    args = mock_db.fetchrow.await_args.args

    assert "" in args, "未传 category 时应默认 '' 作为 bind 值"


async def test_update_by_id_accepts_category(mock_db):

    db = mock_db
    db.fetchrow = AsyncMock(return_value={"config_id": "apicfg_test1", "category": "audio"})
    await api_config_module.ApiConfigDAO.update_by_id("apicfg_test1", {"category": "audio"})

    assert db.fetchrow.await_count + db.execute.await_count >= 1
