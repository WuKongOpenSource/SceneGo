


import pytest


async def test_save_creates_script(test_db):
    from dao_episode_script import EpisodeScriptDAO
    result = await EpisodeScriptDAO.save_or_update(
        episode_id="ep_test1",
        original_content="原始剧本内容",
        adapted_script="改编后的剧本"
    )
    assert result is not None
    assert result["script_id"].startswith("script_")
    assert result["original_content"] == "原始剧本内容"


async def test_get_by_episode(test_db):
    from dao_episode_script import EpisodeScriptDAO
    await EpisodeScriptDAO.save_or_update(
        episode_id="ep_1", original_content="内容"
    )
    result = await EpisodeScriptDAO.get_by_episode("ep_1")
    assert result is not None
    assert result["original_content"] == "内容"


async def test_upsert_updates_existing(test_db):
    from dao_episode_script import EpisodeScriptDAO
    await EpisodeScriptDAO.save_or_update(
        episode_id="ep_1", original_content="版本1"
    )
    updated = await EpisodeScriptDAO.save_or_update(
        episode_id="ep_1", original_content="版本2"
    )
    assert updated["original_content"] == "版本2"
