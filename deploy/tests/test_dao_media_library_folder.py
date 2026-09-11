
import pytest


async def _make_project(conn):
    await conn.execute(
        "INSERT INTO users (user_id, username, password_hash) VALUES ($1,$2,$3) "
        "ON CONFLICT (user_id) DO NOTHING",
        "user_mlf_test", "mlf_tester", "x",
    )
    await conn.execute(
        "INSERT INTO projects (project_id, user_id, project_name) VALUES ($1,$2,$3) "
        "ON CONFLICT (project_id) DO NOTHING",
        "proj_mlf_test", "user_mlf_test", "测试项目",
    )
    return "proj_mlf_test"


async def test_create_and_list(test_db):
    from dao_media_library_folder import MediaLibraryFolderDAO
    project_id = await _make_project(test_db)
    root = await MediaLibraryFolderDAO.create(project_id, "人物", conn=test_db)
    assert root["folder_id"].startswith("mlf_")
    child = await MediaLibraryFolderDAO.create(project_id, "主角", parent_folder_id=root["folder_id"], conn=test_db)
    rows = await MediaLibraryFolderDAO.list_by_project(project_id, conn=test_db)
    assert {r["name"] for r in rows} == {"人物", "主角"}
    assert next(r for r in rows if r["name"] == "主角")["parent_folder_id"] == root["folder_id"]


async def test_rename_and_move(test_db):
    from dao_media_library_folder import MediaLibraryFolderDAO
    project_id = await _make_project(test_db)
    a = await MediaLibraryFolderDAO.create(project_id, "场景", conn=test_db)
    b = await MediaLibraryFolderDAO.create(project_id, "道具", conn=test_db)
    updated = await MediaLibraryFolderDAO.update(a["folder_id"], {"name": "场景库", "parent_folder_id": b["folder_id"]}, conn=test_db)
    assert updated["name"] == "场景库"
    assert updated["parent_folder_id"] == b["folder_id"]


async def test_cycle_guard(test_db):
    from dao_media_library_folder import MediaLibraryFolderDAO
    project_id = await _make_project(test_db)
    a = await MediaLibraryFolderDAO.create(project_id, "A", conn=test_db)
    b = await MediaLibraryFolderDAO.create(project_id, "B", parent_folder_id=a["folder_id"], conn=test_db)

    assert await MediaLibraryFolderDAO.would_create_cycle(a["folder_id"], b["folder_id"], conn=test_db) is True

    assert await MediaLibraryFolderDAO.would_create_cycle(a["folder_id"], a["folder_id"], conn=test_db) is True

    assert await MediaLibraryFolderDAO.would_create_cycle(b["folder_id"], None, conn=test_db) is False


async def test_delete_sets_item_folder_null(test_db):
    from dao_media_library_folder import MediaLibraryFolderDAO
    project_id = await _make_project(test_db)
    f = await MediaLibraryFolderDAO.create(project_id, "临时", conn=test_db)

    await test_db.execute(
        "INSERT INTO files "
        "(file_id, user_id, file_type, file_name, file_path, file_url) "
        "VALUES ($1,$2,$3,$4,$5,$6) "
        "ON CONFLICT (file_id) DO NOTHING",
        "file_mlf_test", "user_mlf_test", "image", "x.png",
        "/tmp/x.png", "/files/x.png",
    )
    await test_db.execute(
        "INSERT INTO media_library_items (library_item_id, file_id, user_id, project_id, item_type, source, folder_id) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7)",
        "mli_mlf_test", "file_mlf_test", "user_mlf_test", project_id, "image", "upload", f["folder_id"],
    )
    await MediaLibraryFolderDAO.delete(f["folder_id"], conn=test_db)
    folder_id = await test_db.fetchval(
        "SELECT folder_id FROM media_library_items WHERE library_item_id = $1", "mli_mlf_test",
    )
    assert folder_id is None
