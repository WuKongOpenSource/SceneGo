from contextlib import asynccontextmanager
import re
import sqlite3

import pytest

from dao.content import entity_file as dao
from utils.video_enhancement_labels import video_enhancement_kinds


@pytest.mark.parametrize('metadata,expected', [
    ({'model': 'upscale'}, ['upscale']),
    ('{"model":"viedo_upscaler"}', ['upscale']),
    ({'generation_params': {'requested_workflow_type': 'video_upscale'}}, ['upscale']),
    ({'model': 'interpolate'}, ['interpolate']),
    ({'model': 'video_infinitetalk'}, ['lipSync']),
    ({'model': 'Seedance', 'filename': 'upscale.mp4'}, []),
    ({'model': 'image_upscale'}, []), (None, []), ('bad json', []), ('[]', []),
    ({'model': 'Wan2', 'timing_contract': {'source_duration_ms': 5086, 'output_duration_ms': 5086,
                                        'source_frame_count': 121, 'source_fps': '24'}}, ['upscale']),
    ({'model': 'Wan2'}, []),
    ({'timing_contract': {'source_duration_ms': 5086, 'output_duration_ms': 4840,
                         'source_frame_count': 121, 'source_fps': '24'}}, []),
    ({'timing_contract': {}}, []),
])
def test_labels_use_explicit_provenance_only(metadata, expected):
    assert video_enhancement_kinds(metadata) == expected


@pytest.fixture
def source_db(monkeypatch):
    db = sqlite3.connect(':memory:', isolation_level=None)
    db.row_factory = sqlite3.Row
    db.executescript('''
        CREATE TABLE video_segments(segment_id TEXT PRIMARY KEY, video_url TEXT, thumbnail_url TEXT, duration_ms INTEGER);
        CREATE TABLE files(file_id TEXT PRIMARY KEY, file_url TEXT, thumbnail_url TEXT, file_type TEXT,
            entity_type TEXT, entity_id TEXT, file_role TEXT, is_deleted BOOLEAN, is_selected BOOLEAN);
        INSERT INTO video_segments VALUES ('segment', '/hd.mp4', '/hd.jpg', 12000);
        INSERT INTO files VALUES ('hd', '/hd.mp4', '/hd.jpg', 'video', 'video_segment', 'segment', 'video', FALSE, TRUE);
        INSERT INTO files VALUES ('original', '/original.mp4', NULL, 'video', 'video_segment', 'segment', 'video', FALSE, FALSE);
        INSERT INTO files VALUES ('foreign', '/foreign.mp4', NULL, 'video', 'video_segment', 'other', 'video', FALSE, FALSE);
        INSERT INTO files VALUES ('deleted', '/deleted.mp4', NULL, 'video', 'video_segment', 'segment', 'video', TRUE, FALSE);
    ''')
    queries = []

    class Connection:
        fail_selection = False

        @asynccontextmanager
        async def transaction(self):
            db.execute('BEGIN')
            try:
                yield
                db.commit()
            except Exception:
                db.rollback()
                raise

        def query(self, sql, args):
            queries.append(sql)
            if self.fail_selection and 'SET is_selected = TRUE' in sql:
                raise RuntimeError('injected write failure')
            return db.execute(re.sub(r'\$(\d+)', r'?\1', sql.replace(' FOR UPDATE', '')), args)

        async def fetchrow(self, sql, *args):
            row = self.query(sql, args).fetchone()
            return dict(row) if row else None

        async def execute(self, sql, *args):
            return self.query(sql, args)

    conn = Connection()

    class Pool:
        @asynccontextmanager
        async def acquire(self):
            yield conn

    class Database:
        pool = Pool()

    monkeypatch.setattr(dao, 'get_db_manager', lambda: Database())
    yield db, conn, queries
    db.close()


@pytest.mark.asyncio
async def test_source_selection_commits_url_and_flags_without_changing_duration(source_db):
    db, conn, queries = source_db
    result = await dao.EntityFileDAO.select_file('original', 'video_segment', 'segment', 'video')
    assert result['file_id'] == 'original'
    assert tuple(db.execute('SELECT video_url,thumbnail_url,duration_ms FROM video_segments').fetchone()) == ('/original.mp4', None, 12000)
    assert [r[0] for r in db.execute('SELECT file_id FROM files WHERE is_selected')] == ['original']
    assert 'video_segments' in queries[0] and 'FOR UPDATE' in queries[0]
    assert db.execute('SELECT COUNT(*) FROM files').fetchone()[0] == 4


@pytest.mark.asyncio
async def test_failed_source_selection_rolls_back_flags_and_preview_url(source_db):
    db, conn, _ = source_db
    conn.fail_selection = True
    with pytest.raises(RuntimeError, match='injected'):
        await dao.EntityFileDAO.select_file('original', 'video_segment', 'segment', 'video')
    assert db.execute('SELECT video_url FROM video_segments').fetchone()[0] == '/hd.mp4'
    assert [r[0] for r in db.execute('SELECT file_id FROM files WHERE is_selected')] == ['hd']


@pytest.mark.asyncio
@pytest.mark.parametrize('file_id', ['foreign', 'deleted', 'missing'])
async def test_source_selection_rejects_unlinked_deleted_and_missing_files(source_db, file_id):
    db, _, _ = source_db
    assert await dao.EntityFileDAO.select_file(file_id, 'video_segment', 'segment', 'video') is None
    assert db.execute('SELECT video_url FROM video_segments').fetchone()[0] == '/hd.mp4'
