import asyncio
import logging
import sqlite3
import threading
import time

import pytest
from fastapi import HTTPException
from PIL import Image

from dao.content import entity_file as dao_module
from services import file_route_service as thumbnails
from test_entity_files_route_access import EmptyDAO, build_router, endpoint
from routers import entity_files as routes


@pytest.mark.asyncio
async def test_enhance_media_batch_checks_episode_access_once_before_query(monkeypatch):
    checked, queried = [], []

    async def allow(*args, **kwargs):
        checked.append(args)

    async def query(episode_id):
        queried.append(episode_id)
        return [{"file_id": "selected"}]

    monkeypatch.setattr(routes, "require_entity_access", allow)
    monkeypatch.setattr(EmptyDAO, "get_episode_enhance_files", query, raising=False)
    handler = endpoint(build_router(), "/api/episodes/{episode_id}/enhance-files", "GET")
    result = await handler(episode_id="owned_episode", user_id="alice")
    assert checked == [("episode", "owned_episode", "alice", "readonly")]
    assert queried == ["owned_episode"]
    assert result["items"][0]["file_id"] == "selected"

    async def deny(*args, **kwargs):
        raise routes.EntityAccessDenied("denied")

    monkeypatch.setattr(routes, "require_entity_access", deny)
    with pytest.raises(HTTPException) as error:
        await handler(episode_id="other_episode", user_id="alice")
    assert error.value.status_code == 404
    assert queried == ["owned_episode"]


@pytest.mark.asyncio
async def test_batch_query_preserves_selected_original_and_deleted_scope_boundaries(monkeypatch):
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.executescript("""
        CREATE TABLE video_segments(segment_id TEXT, episode_id TEXT);
        CREATE TABLE files(file_id TEXT, file_url TEXT, file_type TEXT, file_role TEXT,
            is_selected BOOLEAN, created_at INTEGER, entity_id TEXT, entity_type TEXT, is_deleted BOOLEAN);
        INSERT INTO video_segments VALUES ('s1', 'ep1'), ('s2', 'ep1'), ('other', 'ep2');
    """)
    rows = [(f"history{i}", f"/original/{i}.mp4", "video", "video", False, i, "s1", "video_segment", False) for i in range(100)]
    rows += [
        ("selected", "/original/selected.mp4", "video", "video", True, -1, "s1", "video_segment", False),
        ("deleted", "/deleted.mp4", "video", "video", True, 200, "s1", "video_segment", True),
        ("foreign", "/foreign.mp4", "video", "video", True, 200, "other", "video_segment", False),
        ("wrong_type", "/asset.mp4", "video", "video", True, 300, "s2", "asset", False),
        ("fallback", "/original/latest.mp4", "video", "video", False, 20, "s2", "video_segment", False),
    ]
    rows += [(f"voice{i}", f"/voice/{i}.wav", "audio", "actor_dubbing", False, i, "s1", "video_segment", False) for i in range(65)]
    db.executemany("INSERT INTO files VALUES (?,?,?,?,?,?,?,?,?)", rows)
    calls = []

    class Database:
        async def fetch(self, query, *args):
            calls.append(args)
            return db.execute(query.replace("$1", "?"), args).fetchall()

    monkeypatch.setattr(dao_module, "get_db_manager", lambda: Database())
    result = await dao_module.EntityFileDAO.get_episode_enhance_files("ep1")
    assert calls == [("ep1",)]
    assert {r["file_id"] for r in result if r["file_role"] == "video"} == {"selected", "fallback"}
    assert len([r for r in result if r["file_role"] == "actor_dubbing"]) == 50
    assert not any("file_path" in r or "metadata" in r for r in result)
    db.close()


def thumbnail_options(tmp_path, count=1):
    uploads = tmp_path / "temp" / "uploads"
    uploads.mkdir(parents=True)
    for i in range(count):
        Image.new("RGB", (500, 300), (70, 180, 90)).save(uploads / f"{i}.png")
    return dict(width=160, height=90, file_dao=None, logger=logging.getLogger(__name__),
                deploy_root=tmp_path, cache_dir=tmp_path / "cache")


@pytest.mark.asyncio
async def test_duplicate_thumbnail_work_runs_once_off_event_loop_and_survives_disconnect(tmp_path, monkeypatch):
    options = thumbnail_options(tmp_path)
    render = thumbnails._render_image_thumbnail
    worker_threads = []
    main_thread = threading.get_ident()

    def slow_render(*args):
        worker_threads.append(threading.get_ident())
        time.sleep(0.04)
        render(*args)

    monkeypatch.setattr(thumbnails, "_render_image_thumbnail", slow_render)
    requests = [asyncio.create_task(thumbnails.build_thumbnail_file(url="/uploads/0.png", **options)) for _ in range(12)]
    await asyncio.sleep(0.01)
    requests[0].cancel()
    results = await asyncio.gather(*requests, return_exceptions=True)
    assert isinstance(results[0], asyncio.CancelledError)
    assert len(worker_threads) == 1
    assert worker_threads[0] != main_thread
    assert all(result.path.is_file() for result in results[1:])
    assert len({str(result.path) for result in results[1:]}) == 1
    assert not list((tmp_path / "cache").glob("*.tmp"))


@pytest.mark.asyncio
async def test_thumbnail_concurrency_is_bounded_and_failed_jobs_can_retry(tmp_path, monkeypatch):
    options = thumbnail_options(tmp_path, 8)
    render = thumbnails._render_image_thumbnail
    active = maximum = 0
    lock = threading.Lock()

    def slow_render(*args):
        nonlocal active, maximum
        with lock:
            active += 1
            maximum = max(maximum, active)
        try:
            time.sleep(0.01)
            render(*args)
        finally:
            with lock:
                active -= 1

    monkeypatch.setattr(thumbnails, "_render_image_thumbnail", slow_render)
    await asyncio.gather(*(thumbnails.build_thumbnail_file(url=f"/uploads/{i}.png", **options) for i in range(8)))
    assert maximum == 2

    def fail(*args):
        raise ValueError("decode failed")

    monkeypatch.setattr(thumbnails, "_render_image_thumbnail", fail)
    options["width"] = 200
    with pytest.raises(ValueError, match="decode failed"):
        await thumbnails.build_thumbnail_file(url="/uploads/0.png", **options)
    monkeypatch.setattr(thumbnails, "_render_image_thumbnail", render)
    result = await thumbnails.build_thumbnail_file(url="/uploads/0.png", **options)
    assert result.path.is_file()
