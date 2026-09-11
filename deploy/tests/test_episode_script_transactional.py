from dao.creative.episode_script import EpisodeScriptDAO


class FakeConnection:
    def __init__(self):
        self.fetchrow_calls = []
        self.execute_calls = []

    async def fetchrow(self, query, *args):
        self.fetchrow_calls.append((query, args))
        return {"script_id": args[-1]}

    async def execute(self, query, *args):
        self.execute_calls.append((query, args))


async def test_transactional_upsert_updates_the_explicit_script():
    conn = FakeConnection()

    await EpisodeScriptDAO.upsert_transactional(
        conn,
        "ep_1",
        original_content="second original",
        adapted_script="second adapted",
        metadata={"version": 2},
        script_id="script_2",
    )

    select_query, select_args = conn.fetchrow_calls[0]
    assert "episode_id = $1 AND script_id = $2" in select_query
    assert select_args == ("ep_1", "script_2")
    assert conn.execute_calls[0][1][-1] == "script_2"
