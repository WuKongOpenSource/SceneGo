import pytest

from dao.content import entity_file as entity_file_module


class FakeDB:
    def __init__(self, row):
        self.row = row
        self.executed = []

    async def fetchrow(self, query, *params):
        if "user_id = $2" in query and self.row and params[1] != self.row["user_id"]:
            return None
        return self.row

    async def execute(self, query, *params):
        self.executed.append((query, params))
        return "DELETE 1"


@pytest.mark.asyncio
async def test_hard_delete_removes_only_owned_recycled_file_and_record(tmp_path, monkeypatch):
    storage_root = tmp_path / "persistent_storage"
    storage_root.mkdir()
    physical = storage_root / "deleted.png"
    physical.write_bytes(b"owned-file")
    db = FakeDB({
        "file_id": "file_owned",
        "user_id": "user_1",
        "file_path": str(physical),
        "file_size_bytes": 999,
        "is_deleted": True,
    })
    monkeypatch.setattr(entity_file_module, "get_db_manager", lambda: db)

    result = await entity_file_module.EntityFileDAO.hard_delete(
        "file_owned",
        "user_1",
        storage_root=storage_root,
    )

    assert result == {"file_id": "file_owned", "freed_bytes": len(b"owned-file")}
    assert not physical.exists()
    assert len(db.executed) == 1
    assert db.executed[0][1] == ("file_owned", "user_1")


@pytest.mark.asyncio
async def test_hard_delete_rejects_other_owner_without_touching_disk(tmp_path, monkeypatch):
    storage_root = tmp_path / "persistent_storage"
    storage_root.mkdir()
    physical = storage_root / "other.png"
    physical.write_bytes(b"other-file")
    db = FakeDB({
        "file_id": "file_other",
        "user_id": "user_2",
        "file_path": str(physical),
        "file_size_bytes": len(b"other-file"),
        "is_deleted": True,
    })
    monkeypatch.setattr(entity_file_module, "get_db_manager", lambda: db)

    result = await entity_file_module.EntityFileDAO.hard_delete(
        "file_other",
        "user_1",
        storage_root=storage_root,
    )

    assert result is None
    assert physical.exists()
    assert db.executed == []


@pytest.mark.asyncio
async def test_hard_delete_refuses_path_outside_managed_storage(tmp_path, monkeypatch):
    storage_root = tmp_path / "persistent_storage"
    storage_root.mkdir()
    outside = tmp_path / "outside.png"
    outside.write_bytes(b"keep-me")
    db = FakeDB({
        "file_id": "file_unsafe",
        "user_id": "user_1",
        "file_path": str(outside),
        "file_size_bytes": len(b"keep-me"),
        "is_deleted": True,
    })
    monkeypatch.setattr(entity_file_module, "get_db_manager", lambda: db)

    with pytest.raises(ValueError, match="outside managed persistent storage"):
        await entity_file_module.EntityFileDAO.hard_delete(
            "file_unsafe",
            "user_1",
            storage_root=storage_root,
        )

    assert outside.exists()
    assert db.executed == []
