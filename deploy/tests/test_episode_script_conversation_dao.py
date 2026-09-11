import json

from dao.creative import episode_script_conversation as conversation_module


class _AsyncContext:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _Connection:
    def __init__(self, *, base_exists=True):
        self.base_exists = base_exists
        self.calls = []
        self.insert_args = None

    def transaction(self):
        return _AsyncContext(self)

    async def fetchval(self, query, *args):
        self.calls.append((query, args))
        return 3

    async def fetchrow(self, query, *args):
        self.calls.append((query, args))
        normalized = " ".join(query.split())
        if "SELECT script_id, current_version_id, adapted_script" in normalized:
            return {
                "script_id": "script_1",
                "current_version_id": "ver_current",
                "adapted_script": "current content",
            }
        if "SELECT content FROM episode_script_versions" in normalized:
            return {"content": "explicit V2 content"} if self.base_exists else None
        if "INSERT INTO episode_script_versions" in normalized:
            self.insert_args = args
            return {
                "version_id": args[0],
                "script_id": args[2],
                "version_no": args[4],
                "base_version_id": args[13],
                "content": args[5],
            }
        raise AssertionError(f"Unexpected query: {normalized}")

    async def execute(self, query, *args):
        self.calls.append((query, args))
        return "UPDATE 1"


class _DB:
    def __init__(self, connection):
        self.connection = connection

    def acquire(self):
        return _AsyncContext(self.connection)


class _ConfirmConnection:
    def __init__(self):
        self.version_update_args = None

    def transaction(self):
        return _AsyncContext(self)

    async def fetchrow(self, query, *args):
        normalized = " ".join(query.split())
        if "SELECT * FROM episode_scripts" in normalized:
            return {
                "script_id": "script_1",
                "current_version_id": "ver_2",
                "adapted_script": "V2 adopted content",
            }
        if "SELECT * FROM episode_script_versions" in normalized:
            return {
                "version_id": "ver_4",
                "script_id": "script_1",
                "status": "draft",
                "content": "V4 final content",
                "metadata": {},
            }
        if "UPDATE episode_script_versions" in normalized:
            self.version_update_args = args
            return {
                "version_id": "ver_4",
                "script_id": "script_1",
                "status": "ready",
                "content": "V4 final content",
                "metadata": json.loads(args[3]),
            }
        raise AssertionError(f"Unexpected query: {normalized}")

    async def execute(self, query, *args):
        return "UPDATE 1"


async def test_create_version_uses_explicit_same_script_base_for_patch(monkeypatch):
    connection = _Connection()
    patch_inputs = {}
    monkeypatch.setattr(conversation_module, "get_db_manager", lambda: _DB(connection))
    monkeypatch.setattr(
        conversation_module,
        "build_script_patch",
        lambda base, candidate: patch_inputs.update(base=base, candidate=candidate) or {"format": "test"},
    )

    result = await conversation_module.EpisodeScriptConversationDAO.create_version(
        episode_id="ep_1",
        script_id="script_1",
        message_id=None,
        base_version_id="ver_2",
        content="V3 content",
        storyboard_items=[],
        status="draft",
        set_current=False,
    )

    assert result["base_version_id"] == "ver_2"
    assert patch_inputs == {"base": "explicit V2 content", "candidate": "V3 content"}
    base_queries = [
        call for call in connection.calls
        if "SELECT content FROM episode_script_versions" in " ".join(call[0].split())
    ]
    assert base_queries[0][1] == ("ver_2", "script_1")


async def test_create_version_rejects_a_base_from_another_script(monkeypatch):
    connection = _Connection(base_exists=False)
    monkeypatch.setattr(conversation_module, "get_db_manager", lambda: _DB(connection))

    result = await conversation_module.EpisodeScriptConversationDAO.create_version(
        episode_id="ep_1",
        script_id="script_1",
        message_id=None,
        base_version_id="ver_other_script",
        content="candidate",
        storyboard_items=[],
        status="draft",
        set_current=False,
    )

    assert result is None
    assert connection.insert_args is None


async def test_confirm_version_persists_the_adoption_base_patch(monkeypatch):
    connection = _ConfirmConnection()
    monkeypatch.setattr(conversation_module, "get_db_manager", lambda: _DB(connection))

    result = await conversation_module.EpisodeScriptConversationDAO.confirm_version(
        "script_1",
        "ver_4",
        "user_1",
    )

    confirmation = result["metadata"]
    assert result["previous_version_id"] == "ver_2"
    assert confirmation["confirmationBaseVersionId"] == "ver_2"
    assert confirmation["confirmationPatch"]["baseHash"]
    assert confirmation["confirmationPatch"]["candidateHash"]
