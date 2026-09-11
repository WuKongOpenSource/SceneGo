


import pytest

from dao.creative.asset import _rename_bound_asset_tokens


def test_rename_bound_asset_tokens_updates_only_exact_asset_references():
    renamed = _rename_bound_asset_tokens(
        [
            "meta:bindings-initialized",
            "char:阿壳",
            "char:阿壳二号",
            "sel:阿壳:asset_robot_0",
            "nosel:阿壳",
            "scene:茶馆室内",
        ],
        asset_type="character",
        old_name="阿壳",
        new_name="机器人阿壳",
    )

    assert renamed == [
        "meta:bindings-initialized",
        "char:机器人阿壳",
        "char:阿壳二号",
        "sel:机器人阿壳:asset_robot_0",
        "nosel:机器人阿壳",
        "scene:茶馆室内",
    ]


async def test_create_asset_returns_complete_record(test_db):
    from dao_asset import AssetDAO
    result = await AssetDAO.create(
        project_id="proj_test1", episode_id=None,
        asset_type="character", name="主角",
        description="黑发少年", created_by="user_test"
    )
    assert result is not None
    assert result["asset_id"].startswith("asset_")
    assert result["name"] == "主角"
    assert result["asset_type"] == "character"
    assert result["episode_id"] is None


async def test_get_project_assets_includes_shared(test_db):
    from dao_asset import AssetDAO
    await AssetDAO.create(project_id="proj_1", episode_id=None,
                          asset_type="scene", name="学校", created_by="u1")
    await AssetDAO.create(project_id="proj_1", episode_id="ep_1",
                          asset_type="scene", name="教室", created_by="u1")
    results = await AssetDAO.get_by_project("proj_1", episode_id="ep_1")
    names = [r["name"] for r in results]
    assert "学校" in names
    assert "教室" in names


async def test_get_assets_filters_by_project(test_db):
    from dao_asset import AssetDAO
    await AssetDAO.create(project_id="proj_A", episode_id=None,
                          asset_type="prop", name="剑", created_by="u1")
    results = await AssetDAO.get_by_project("proj_B")
    assert len(results) == 0


async def test_update_asset_name(test_db):
    from dao_asset import AssetDAO
    created = await AssetDAO.create(project_id="proj_1", episode_id=None,
                                     asset_type="character", name="旧名", created_by="u1")
    updated = await AssetDAO.update(created["asset_id"], name="新名")
    assert updated["name"] == "新名"


async def test_delete_asset(test_db):
    from dao_asset import AssetDAO
    created = await AssetDAO.create(project_id="proj_1", episode_id=None,
                                     asset_type="prop", name="盾牌", created_by="u1")
    await AssetDAO.delete(created["asset_id"])
    result = await AssetDAO.get_by_id(created["asset_id"])
    assert result is None


async def test_filter_assets_by_type(test_db):
    from dao_asset import AssetDAO
    await AssetDAO.create(project_id="proj_1", episode_id=None,
                          asset_type="character", name="人物A", created_by="u1")
    await AssetDAO.create(project_id="proj_1", episode_id=None,
                          asset_type="scene", name="场景A", created_by="u1")
    chars = await AssetDAO.get_by_project("proj_1", asset_type="character")
    assert all(r["asset_type"] == "character" for r in chars)


async def test_export_asset_creation_backfills_only_blank_existing_descriptions():
    from dao_asset import AssetDAO

    class FakeConnection:
        def __init__(self):
            self.executions = []

        async def fetch(self, _query, *_args):
            return [
                {"asset_id": "asset_blank", "name": "阿壳", "description": ""},
                {"asset_id": "asset_custom", "name": "女店主", "description": "用户已编辑的设定"},
            ]

        async def execute(self, query, *args):
            self.executions.append((" ".join(query.split()), args))
            return "UPDATE 1"

    conn = FakeConnection()
    created = await AssetDAO.create_missing_episode_assets_transactional(
        conn,
        project_id="proj_1",
        episode_id="ep_1",
        script_id="script_1",
        asset_type="character",
        items=[
            {"name": "阿壳", "description": "银灰色圆润外壳，胸口屏幕显示淡蓝光"},
            {"name": "女店主", "description": "不应覆盖"},
        ],
        created_by="user_1",
    )

    assert created == 0
    assert len(conn.executions) == 1
    query, args = conn.executions[0]
    assert query.startswith("UPDATE assets SET description")
    assert args == ("银灰色圆润外壳，胸口屏幕显示淡蓝光", "asset_blank")
