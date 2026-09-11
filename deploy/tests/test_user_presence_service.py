from datetime import datetime, timedelta, timezone

import pytest

from services import user_presence_service as svc


class FakePipeline:
    def __init__(self, store):
        self.store = store
        self.commands = []

    def set(self, key, value, ex=None):
        self.commands.append(("set", key, value, ex))
        return self

    def get(self, key):
        self.commands.append(("get", key))
        return self

    async def execute(self):
        output = []
        for command in self.commands:
            if command[0] == "set":
                self.store[command[1]] = command[2]
                output.append(True)
            else:
                output.append(self.store.get(command[1]))
        return output


class FakeRedis:
    def __init__(self):
        self.store = {}

    def pipeline(self, transaction=False):
        return FakePipeline(self.store)

    async def delete(self, key):
        self.store.pop(key, None)


@pytest.mark.asyncio
async def test_presence_is_online_after_touch_and_offline_after_logout():
    redis = FakeRedis()
    svc.configure_presence_store(lambda: redis)
    now = datetime(2026, 9, 1, 9, 0, tzinfo=timezone.utc)
    await svc.touch_user_presence("user_1", now=now)
    online = await svc.get_users_presence(["user_1"], now=now + timedelta(minutes=1))
    assert online["user_1"]["is_online"] is True
    assert online["user_1"]["last_active_at"] == now.isoformat()

    await svc.clear_user_presence("user_1", now=now + timedelta(minutes=2))
    offline = await svc.get_users_presence(["user_1"], now=now + timedelta(minutes=2))
    assert offline["user_1"]["is_online"] is False
    assert offline["user_1"]["last_active_at"] == now.isoformat()
