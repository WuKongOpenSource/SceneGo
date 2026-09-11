

































from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import uuid
from typing import Any, Dict, List, Optional, Tuple


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
)
logger = logging.getLogger("migrate_files_to_media_library")



def _safe_meta(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            v = json.loads(value)
            return v if isinstance(v, dict) else {}
        except Exception:
            return {}
    return {}


def _infer_item_type(file_type: Optional[str], mime_type: Optional[str]) -> Optional[str]:
    ft = (file_type or '').lower()
    mt = (mime_type or '').lower()
    if ft == 'image' or mt.startswith('image/'):
        return 'image'
    if ft == 'video' or mt.startswith('video/'):
        return 'video'
    if ft == 'audio' or mt.startswith('audio/'):
        return 'audio'
    return None


def _infer_source(meta: Dict[str, Any], item_type: str) -> str:

    for key in ('source', 'provider', 'model', 'engine'):
        v = meta.get(key)
        if isinstance(v, str) and v:
            v_lower = v.lower()
            if 'gemini' in v_lower:
                return f"generated_{item_type}_gemini"
            if 'gpt' in v_lower or 'openai' in v_lower:
                return f"generated_{item_type}_gpt"
            if 'doubao' in v_lower or 'dashscope' in v_lower or 'volc' in v_lower:
                return f"generated_{item_type}_doubao"
            if 'minimax' in v_lower:
                return f"generated_{item_type}_minimax"
            if 'comfy' in v_lower:
                return f"generated_{item_type}_comfyui"
            if 'seedance' in v_lower:
                return f"generated_{item_type}_seedance"
            return f"generated_{item_type}_{v_lower}"
    return f"generated_{item_type}"



async def _fetch_candidates(
    db, *, user_id: Optional[str], limit: Optional[int], offset: int,
) -> List[Dict[str, Any]]:
    where = ["f.is_deleted = FALSE", "f.file_type IN ('image','video','audio')"]
    params: List[Any] = []
    idx = 1
    if user_id:
        where.append(f"f.user_id = ${idx}"); params.append(user_id); idx += 1
    lim = "" if not limit else f" LIMIT ${idx}"
    if limit:
        params.append(limit)
    params.append(offset)
    rows = await db.fetch(
        f"""
        SELECT f.file_id, f.user_id, f.file_type, f.file_name, f.mime_type,
               f.metadata AS file_metadata, f.created_at,
               v.project_id
        FROM files f
        LEFT JOIN versions v ON v.version_id = f.version_id
        WHERE {' AND '.join(where)}
        ORDER BY f.id
        {lim} OFFSET ${idx + (1 if limit else 0)}
        """,
        *params,
    )
    return [dict(r) for r in rows]


async def _already_in_library(db, file_id: str) -> bool:
    row = await db.fetchrow(
        "SELECT 1 FROM media_library_items WHERE file_id = $1",
        file_id,
    )
    return bool(row)


async def _insert_one(db, file_row: Dict[str, Any]) -> Tuple[bool, str]:
    file_id = file_row['file_id']
    file_type = file_row.get('file_type')
    mime_type = file_row.get('mime_type')
    item_type = _infer_item_type(file_type, mime_type)
    if not item_type:
        return False, 'unsupported_type'

    meta = _safe_meta(file_row.get('file_metadata'))
    source = _infer_source(meta, item_type)

    title_raw = meta.get('prompt') or meta.get('title') or file_row.get('file_name') or ''
    title = (title_raw or '')[:80] or None

    lib_id = f"mlib_{uuid.uuid4().hex[:16]}"
    try:
        await db.execute(
            """
            INSERT INTO media_library_items (
                library_item_id, file_id, user_id, project_id, episode_id, team_id,
                item_type, source, title, description, tags,
                permission_scope, is_favorite, use_count,
                source_task_id, source_entity_type, source_entity_id,
                metadata, is_deleted, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, NULL, NULL,
                $5, $6, $7, '', '[]'::jsonb,
                'private', FALSE, 0,
                NULL, NULL, NULL,
                $8::jsonb, FALSE, COALESCE($9, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
            )
            """,
            lib_id, file_id, file_row['user_id'], file_row.get('project_id'),
            item_type, source, title,
            json.dumps(meta),
            file_row.get('created_at'),
        )
        return True, lib_id
    except Exception as e:

        return False, f'error:{e}'


async def run(*, apply: bool, user_id: Optional[str], limit: Optional[int], batch: int = 500) -> Dict[str, int]:
    from db_manager import get_db_manager, init_db_manager


    db = get_db_manager()
    if not db:
        await init_db_manager()
        db = get_db_manager()
    if not db:
        raise RuntimeError("无法初始化 db_manager")

    stats = {
        'scanned': 0,
        'eligible': 0,
        'skipped_existing': 0,
        'skipped_unsupported': 0,
        'inserted': 0,
        'errors': 0,
    }

    offset = 0
    remaining = limit
    while True:
        page_size = batch if remaining is None else max(0, min(batch, remaining))
        if remaining is not None and page_size == 0:
            break
        rows = await _fetch_candidates(db, user_id=user_id, limit=page_size, offset=offset)
        if not rows:
            break
        for row in rows:
            stats['scanned'] += 1
            item_type = _infer_item_type(row.get('file_type'), row.get('mime_type'))
            if not item_type:
                stats['skipped_unsupported'] += 1
                continue
            stats['eligible'] += 1
            if await _already_in_library(db, row['file_id']):
                stats['skipped_existing'] += 1
                continue
            if not apply:

                continue
            ok, info = await _insert_one(db, row)
            if ok:
                stats['inserted'] += 1
                if stats['inserted'] % 100 == 0:
                    logger.info("已插入 %d 条 …", stats['inserted'])
            else:
                if info.startswith('error:'):
                    stats['errors'] += 1
                    logger.warning("file=%s 插入失败: %s", row['file_id'], info)
                else:
                    stats['skipped_unsupported'] += 1
        if remaining is not None:
            remaining -= len(rows)
            if remaining <= 0:
                break
        offset += len(rows)
    return stats


def main() -> None:
    p = argparse.ArgumentParser(description="把历史 files 表回填到 media_library_items")
    p.add_argument('--apply', action='store_true', help='实际写入（默认 dry-run）')
    p.add_argument('--user-id', default=None, help='只处理某个用户')
    p.add_argument('--limit', type=int, default=None, help='最多处理条数（默认全量）')
    p.add_argument('--batch', type=int, default=500, help='每批读取数（默认 500）')
    args = p.parse_args()

    mode = 'APPLY' if args.apply else 'DRY-RUN'
    logger.info("=" * 60)
    logger.info("migrate_files_to_media_library — %s", mode)
    logger.info("user_id=%s  limit=%s  batch=%d", args.user_id, args.limit, args.batch)
    logger.info("=" * 60)

    stats = asyncio.run(run(
        apply=args.apply,
        user_id=args.user_id,
        limit=args.limit,
        batch=args.batch,
    ))

    logger.info("=" * 60)
    logger.info("完成。%s 模式统计：", mode)
    for k, v in stats.items():
        logger.info("  %-22s = %d", k, v)
    logger.info("=" * 60)


if __name__ == '__main__':
    main()
