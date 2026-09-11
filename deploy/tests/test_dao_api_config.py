




async def test_create_api_config(test_db):
    from dao_api_config import ApiConfigDAO

    row = await ApiConfigDAO.create(
        name="cfg-openai",
        provider="openai",
        endpoint="https://api.openai.com/v1",
        api_key="sk-test-secret",
        model_name="gpt-4",
        proxy_mode="direct",
    )
    assert row is not None
    assert row["config_id"].startswith("apicfg_")
    assert row["name"] == "cfg-openai"
    assert row["provider"] == "openai"
    assert row["endpoint"] == "https://api.openai.com/v1"
    assert row["model_name"] == "gpt-4"
    assert row["proxy_mode"] == "direct"
    assert row["enabled"] is True
    assert row["api_key_encrypted"] != "sk-test-secret"
    assert ApiConfigDAO._decrypt_key(row["api_key_encrypted"]) == "sk-test-secret"


async def test_get_api_key_decrypts(test_db):
    from dao_api_config import ApiConfigDAO

    secret = "test-placeholder-credential"
    created = await ApiConfigDAO.create(
        name="cfg-decrypt",
        provider="x",
        endpoint="http://e",
        api_key=secret,
    )
    plain = await ApiConfigDAO.get_decrypted_key(created["config_id"])
    assert plain == secret


async def test_list_enabled_configs(test_db):
    from dao_api_config import ApiConfigDAO

    a = await ApiConfigDAO.create(
        name="z-enabled",
        provider="p",
        endpoint="http://a",
        api_key="k",
    )
    b = await ApiConfigDAO.create(
        name="m-disabled",
        provider="p",
        endpoint="http://b",
        api_key="k",
    )
    await ApiConfigDAO.update(b["config_id"], enabled=False)

    rows = await ApiConfigDAO.list_enabled()
    ids = {r["config_id"] for r in rows}
    assert a["config_id"] in ids
    assert b["config_id"] not in ids


async def test_list_by_proxy_mode(test_db):
    from dao_api_config import ApiConfigDAO

    agent_row = await ApiConfigDAO.create(
        name="proxy-agent-one",
        provider="p",
        endpoint="http://x",
        api_key="k",
        proxy_mode="agent",
    )
    await ApiConfigDAO.create(
        name="proxy-direct-one",
        provider="p",
        endpoint="http://y",
        api_key="k",
        proxy_mode="direct",
    )
    disabled_agent = await ApiConfigDAO.create(
        name="proxy-agent-off",
        provider="p",
        endpoint="http://z",
        api_key="k",
        proxy_mode="agent",
    )
    await ApiConfigDAO.update(disabled_agent["config_id"], enabled=False)

    agent_list = await ApiConfigDAO.list_by_proxy_mode("agent")
    agent_ids = {r["config_id"] for r in agent_list}
    assert agent_row["config_id"] in agent_ids
    assert disabled_agent["config_id"] not in agent_ids
