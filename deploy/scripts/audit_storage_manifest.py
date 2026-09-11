from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from utils.storage_layout import canonical_file_type  # noqa: E402


STORAGE_URL_PREFIX = "/storage/"


def _dict(row: Any) -> Dict[str, Any]:
    return dict(row) if row is not None else {}


def _write_csv(path: Path, rows: List[Dict[str, Any]], fieldnames: List[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def _normalize_rel(value: Any, storage_root: Path) -> Optional[str]:
    if not value:
        return None
    raw = str(value).strip().replace("\\", "/")
    if not raw:
        return None

    parsed_path = urlparse(raw).path if "://" in raw or raw.startswith("/") else raw
    parsed_path = parsed_path.split("?", 1)[0].replace("\\", "/")

    if parsed_path.startswith(STORAGE_URL_PREFIX):
        return parsed_path[len(STORAGE_URL_PREFIX):].lstrip("/")

    marker = "/persistent_storage/"
    lowered = parsed_path.lower()
    marker_index = lowered.find(marker)
    if marker_index >= 0:
        return parsed_path[marker_index + len(marker):].lstrip("/")

    if lowered.startswith("persistent_storage/"):
        return parsed_path[len("persistent_storage/"):].lstrip("/")

    try:
        path = Path(raw)
        if path.is_absolute():
            return path.resolve().relative_to(storage_root.resolve()).as_posix()
    except Exception:
        return None

    return None


def _file_refs(row: Dict[str, Any], storage_root: Path) -> Set[str]:
    refs: Set[str] = set()
    for key in ("file_url", "file_path", "thumbnail_url"):
        rel = _normalize_rel(row.get(key), storage_root)
        if rel:
            refs.add(rel)
    return refs


async def _table_exists(db: Any, table: str) -> bool:
    return bool(await db.fetchval("SELECT to_regclass($1) IS NOT NULL", f"public.{table}"))


async def _columns(db: Any, table: str) -> Set[str]:
    rows = await db.fetch(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        """,
        table,
    )
    return {row["column_name"] for row in rows}


async def _fetch_files(db: Any, include_deleted: bool) -> List[Dict[str, Any]]:
    rows = await db.fetch(
        """
        SELECT *
        FROM files
        WHERE ($1::boolean OR COALESCE(is_deleted, FALSE) = FALSE)
        ORDER BY id
        """,
        include_deleted,
    )
    return [_dict(row) for row in rows]


def _merge_context(target: Dict[str, Dict[str, Any]], row: Dict[str, Any], source: str) -> None:
    file_id = row.get("file_id")
    if not file_id:
        return
    current = target.setdefault(file_id, {"context_sources": []})
    current["context_sources"].append(source)
    for key in ("project_id", "episode_id", "source", "entity_type", "entity_id"):
        value = row.get(key)
        if value and not current.get(key):
            current[key] = value


async def _collect_file_context(db: Any, include_deleted: bool) -> Dict[str, Dict[str, Any]]:
    context: Dict[str, Dict[str, Any]] = {}
    file_columns = await _columns(db, "files")

    if {"project_id", "episode_id", "source"}.intersection(file_columns):
        select_bits = ["file_id"]
        for key in ("project_id", "episode_id", "source", "entity_type", "entity_id"):
            select_bits.append(key if key in file_columns else f"NULL::text AS {key}")
        rows = await db.fetch(
            f"""
            SELECT {', '.join(select_bits)}
            FROM files
            WHERE ($1::boolean OR COALESCE(is_deleted, FALSE) = FALSE)
            """,
            include_deleted,
        )
        for row in rows:
            _merge_context(context, _dict(row), "files")

    if await _table_exists(db, "media_library_items"):
        rows = await db.fetch(
            """
            SELECT file_id, project_id, episode_id, source,
                   source_entity_type AS entity_type, source_entity_id AS entity_id
            FROM media_library_items
            WHERE ($1::boolean OR COALESCE(is_deleted, FALSE) = FALSE)
            """,
            include_deleted,
        )
        for row in rows:
            _merge_context(context, _dict(row), "media_library_items")

    if await _table_exists(db, "storyboard_items") and await _table_exists(db, "episodes"):
        rows = await db.fetch(
            """
            SELECT f.file_id, e.project_id, si.episode_id,
                   COALESCE(f.file_role, 'storyboard_file') AS source,
                   'storyboard_item'::text AS entity_type,
                   si.item_id AS entity_id
            FROM files f
            JOIN storyboard_items si
              ON f.entity_type = 'storyboard_item' AND f.entity_id = si.item_id
            LEFT JOIN episodes e ON e.episode_id = si.episode_id
            WHERE ($1::boolean OR COALESCE(f.is_deleted, FALSE) = FALSE)
            """,
            include_deleted,
        )
        for row in rows:
            _merge_context(context, _dict(row), "storyboard_items")

    if await _table_exists(db, "assets"):
        rows = await db.fetch(
            """
            SELECT f.file_id, a.project_id, a.episode_id,
                   COALESCE(f.file_role, 'asset_file') AS source,
                   'asset'::text AS entity_type,
                   a.asset_id AS entity_id
            FROM files f
            JOIN assets a ON f.entity_type = 'asset' AND f.entity_id = a.asset_id
            WHERE ($1::boolean OR COALESCE(f.is_deleted, FALSE) = FALSE)
            """,
            include_deleted,
        )
        for row in rows:
            _merge_context(context, _dict(row), "assets")

    if await _table_exists(db, "video_segments") and await _table_exists(db, "episodes"):
        rows = await db.fetch(
            """
            SELECT f.file_id, e.project_id, vs.episode_id,
                   COALESCE(f.file_role, 'video_segment_file') AS source,
                   'video_segment'::text AS entity_type,
                   vs.segment_id AS entity_id
            FROM files f
            JOIN video_segments vs
              ON f.entity_type = 'video_segment' AND f.entity_id = vs.segment_id
            LEFT JOIN episodes e ON e.episode_id = vs.episode_id
            WHERE ($1::boolean OR COALESCE(f.is_deleted, FALSE) = FALSE)
            """,
            include_deleted,
        )
        for row in rows:
            _merge_context(context, _dict(row), "video_segments")

    if await _table_exists(db, "episodes"):
        rows = await db.fetch(
            """
            SELECT f.file_id, e.project_id, e.episode_id,
                   COALESCE(f.file_role, 'episode_file') AS source,
                   'episode'::text AS entity_type,
                   e.episode_id AS entity_id
            FROM files f
            JOIN episodes e ON f.entity_type = 'episode' AND f.entity_id = e.episode_id
            WHERE ($1::boolean OR COALESCE(f.is_deleted, FALSE) = FALSE)
            """,
            include_deleted,
        )
        for row in rows:
            _merge_context(context, _dict(row), "episodes")

    if await _table_exists(db, "canvas_nodes") and await _table_exists(db, "canvas_boards"):
        rows = await db.fetch(
            """
            SELECT f.file_id, cb.project_id, NULL::text AS episode_id,
                   COALESCE(f.file_role, 'canvas_file') AS source,
                   'canvas_node'::text AS entity_type,
                   cn.node_id AS entity_id
            FROM files f
            JOIN canvas_nodes cn
              ON f.entity_type = 'canvas_node' AND f.entity_id = cn.node_id
            JOIN canvas_boards cb ON cb.board_id = cn.board_id
            WHERE ($1::boolean OR COALESCE(f.is_deleted, FALSE) = FALSE)
            """,
            include_deleted,
        )
        for row in rows:
            _merge_context(context, _dict(row), "canvas_nodes")

    return context


async def _collect_legacy_storage_refs(db: Any, storage_root: Path) -> Dict[str, List[str]]:
    refs: Dict[str, List[str]] = defaultdict(list)

    async def add_url(table: str, column: str, id_column: str) -> None:
        if not await _table_exists(db, table):
            return
        cols = await _columns(db, table)
        if column not in cols:
            return
        rows = await db.fetch(
            f"""
            SELECT {id_column} AS entity_id, {column} AS url
            FROM {table}
            WHERE {column} IS NOT NULL AND {column} <> ''
            """
        )
        for row in rows:
            rel = _normalize_rel(row.get("url"), storage_root)
            if rel:
                refs[rel].append(f"{table}.{column}:{row.get('entity_id')}")

    for column in (
        "generated_image_url",
        "dialogue_audio_url",
        "narration_audio_url",
        "sfx_audio_url",
        "mixed_audio_url",
    ):
        await add_url("storyboard_items", column, "item_id")

    for column in ("video_url", "thumbnail_url"):
        await add_url("video_segments", column, "segment_id")

    await add_url("assets", "thumbnail_url", "asset_id")

    if await _table_exists(db, "assets"):
        cols = await _columns(db, "assets")
        if "reference_images" in cols:
            rows = await db.fetch(
                """
                SELECT asset_id, jsonb_array_elements_text(reference_images) AS url
                FROM assets
                WHERE reference_images IS NOT NULL
                  AND jsonb_typeof(reference_images) = 'array'
                """
            )
            for row in rows:
                rel = _normalize_rel(row.get("url"), storage_root)
                if rel:
                    refs[rel].append(f"assets.reference_images:{row.get('asset_id')}")

    return refs


def _scan_disk(storage_root: Path) -> Dict[str, Dict[str, Any]]:
    files: Dict[str, Dict[str, Any]] = {}
    if not storage_root.exists():
        return files
    for path in storage_root.rglob("*"):
        if not path.is_file():
            continue
        try:
            stat = path.stat()
        except FileNotFoundError:
            continue
        rel = path.relative_to(storage_root).as_posix()
        files[rel] = {
            "rel_path": rel,
            "path": str(path),
            "size_bytes": stat.st_size,
            "mtime": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
        }
    return files


def _context_for(file_row: Dict[str, Any], contexts: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    meta = file_row.get("metadata") or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            meta = {}
    ctx = dict(contexts.get(file_row.get("file_id"), {}))
    for key in ("project_id", "episode_id", "source"):
        if not ctx.get(key):
            ctx[key] = file_row.get(key) or meta.get(key)
    return ctx


async def run(args: argparse.Namespace) -> Dict[str, Any]:
    from db_manager import get_db_manager, init_db_manager

    storage_root = Path(args.storage_root).resolve()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    await init_db_manager()
    db = get_db_manager()

    files = await _fetch_files(db, args.include_deleted)
    contexts = await _collect_file_context(db, args.include_deleted)
    legacy_refs = await _collect_legacy_storage_refs(db, storage_root)
    disk_files = _scan_disk(storage_root)

    referenced_rels: Set[str] = set(legacy_refs.keys())
    active_rows: List[Dict[str, Any]] = []
    missing_rows: List[Dict[str, Any]] = []
    unowned_rows: List[Dict[str, Any]] = []

    for row in files:
        refs = _file_refs(row, storage_root)
        referenced_rels.update(refs)
        ctx = _context_for(row, contexts)
        existing_refs = sorted(rel for rel in refs if rel in disk_files)
        missing_refs = sorted(refs - set(existing_refs))
        file_type = canonical_file_type(row.get("file_type"))
        active_row = {
            "file_id": row.get("file_id"),
            "user_id": row.get("user_id"),
            "file_type": file_type,
            "file_name": row.get("file_name"),
            "file_url": row.get("file_url"),
            "file_path": row.get("file_path"),
            "file_size_bytes": row.get("file_size_bytes"),
            "project_id": ctx.get("project_id"),
            "episode_id": ctx.get("episode_id"),
            "source": ctx.get("source"),
            "entity_type": ctx.get("entity_type") or row.get("entity_type"),
            "entity_id": ctx.get("entity_id") or row.get("entity_id"),
            "file_role": row.get("file_role"),
            "context_sources": "|".join(ctx.get("context_sources", [])),
            "existing_storage_refs": "|".join(existing_refs),
            "missing_storage_refs": "|".join(missing_refs),
            "created_at": row.get("created_at"),
        }
        active_rows.append(active_row)
        if refs and not existing_refs:
            missing_rows.append(active_row)
        if file_type in {"image", "video", "audio"} and not ctx.get("project_id"):
            unowned_rows.append(active_row)

    orphan_rows = []
    for rel, info in disk_files.items():
        if rel in referenced_rels:
            continue
        orphan_rows.append(
            {
                **info,
                "legacy_refs": "|".join(legacy_refs.get(rel, [])),
            }
        )

    active_fields = [
        "file_id",
        "user_id",
        "file_type",
        "file_name",
        "file_url",
        "file_path",
        "file_size_bytes",
        "project_id",
        "episode_id",
        "source",
        "entity_type",
        "entity_id",
        "file_role",
        "context_sources",
        "existing_storage_refs",
        "missing_storage_refs",
        "created_at",
    ]
    _write_csv(output_dir / "active_files.csv", active_rows, active_fields)
    _write_csv(output_dir / "missing_files.csv", missing_rows, active_fields)
    _write_csv(output_dir / "unowned_files.csv", unowned_rows, active_fields)
    _write_csv(
        output_dir / "disk_orphans.csv",
        orphan_rows,
        ["rel_path", "path", "size_bytes", "mtime", "legacy_refs"],
    )

    by_type: Dict[str, Dict[str, int]] = defaultdict(lambda: {"count": 0, "bytes": 0})
    for row in active_rows:
        bucket = by_type[row["file_type"]]
        bucket["count"] += 1
        try:
            bucket["bytes"] += int(row.get("file_size_bytes") or 0)
        except (TypeError, ValueError):
            pass

    summary = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "storage_root": str(storage_root),
        "include_deleted": args.include_deleted,
        "db_files": len(files),
        "disk_files": len(disk_files),
        "legacy_storage_refs": len(legacy_refs),
        "missing_files": len(missing_rows),
        "unowned_files": len(unowned_rows),
        "disk_orphans": len(orphan_rows),
        "active_by_type": by_type,
        "outputs": {
            "active_files": str(output_dir / "active_files.csv"),
            "missing_files": str(output_dir / "missing_files.csv"),
            "unowned_files": str(output_dir / "unowned_files.csv"),
            "disk_orphans": str(output_dir / "disk_orphans.csv"),
        },
    }
    (output_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )

    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Read-only persistent_storage audit manifest")
    parser.add_argument("--storage-root", default=os.getenv("LOCAL_STORAGE_PATH", "persistent_storage"))
    parser.add_argument("--output-dir", default="storage_audit_reports")
    parser.add_argument("--include-deleted", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    summary = asyncio.run(run(args))
    print(json.dumps(summary, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
