"""Resolve an explicit workspace export without replacing or deleting history."""
import json
from urllib.parse import urlsplit

TIMELINE_NAME = '优化合成时间线'


def decode(value, default):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return default
    return value if value is not None else default


def media_key(value):
    value = str(value or '').strip()
    parsed = urlsplit(value)
    # Managed file identities are independent of the site's public hostname.
    if parsed.path.startswith(('/storage/', '/api/files/')):
        return parsed.path
    return value.split('?', 1)[0]


def plan_export(session, segments, files, items):
    groups = session.get('task_groups') or []
    statuses = session.get('tasks_status') or {}
    by_id = {s['segment_id']: s for s in segments}
    selected, used = [], set()
    for group in groups:
        status = statuses.get(group.get('uuid')) or {}
        result = media_key(status.get('result'))
        if not result:
            if status.get('videos'):
                raise ValueError('有视频卡片尚未选择美化使用版本，请先选择')
            continue
        sid = group.get('videoSegmentId')
        if not sid:
            candidates = [s for s in segments if s.get('storyboard_item_id') in (group.get('ids') or [])]
            if len(candidates) == 1:
                sid = candidates[0]['segment_id']
        if sid not in by_id or sid in used:
            raise ValueError('视频卡片与片段关联不明确，请重新选择美化使用版本')
        matches = [f for f in files if f['entity_id'] == sid and not f.get('is_deleted')
                   and (media_key(f.get('file_url')) == result or result == f"/api/files/{f['file_id']}/download")]
        if not matches:
            raise ValueError('选中的视频文件不存在或已删除，请重新选择美化使用版本')
        file = matches[0]
        source = by_id[sid]
        duration = round(float(file.get('duration_seconds') or 0) * 1000)
        duration = duration or source.get('duration_ms') or round(float(group.get('duration') or 5) * 1000)
        selected.append({'segment_id': sid, 'file_id': file['file_id'], 'video_url': file['file_url'],
                         'duration_ms': max(100, duration), 'source_changed': media_key(source.get('video_url')) != result})
        used.add(sid)
    if not selected:
        raise ValueError('没有已选择美化使用的视频')
    # Keep cuts/transitions for surviving sources, but never append obsolete merged cards.
    result_items, cursor = [], 0
    for selection in selected:
        sid = selection['segment_id']
        old_cuts = [i for i in items if i.get('kind') == 'video' and i.get('sourceId') == sid]
        for cut in old_cuts or [{'kind': 'video', 'clipId': sid, 'sourceId': sid}]:
            cut = dict(cut)
            offset = max(0, int(cut.get('sourceOffsetMs') or 0))
            maximum = selection['duration_ms']
            if offset >= maximum:
                offset = 0
            duration = min(maximum - offset, max(100, int(cut.get('durationMs') or maximum)))
            cut.update(startMs=cursor, durationMs=duration, sourceOffsetMs=offset)
            result_items.append(cut)
            cursor += duration
    result_items.extend({'kind': 'excluded_video', 'sourceId': sid} for sid in by_id if sid not in used)
    result_items.extend(i for i in items if i.get('kind') not in ('video', 'excluded_video'))
    return selected, result_items


def apply_audio_edits(rows, items):
    """Use the editor snapshot for known tracks; still include newly added tracks."""
    by_source = {f"aud_track_{row['track_id']}": row for row in rows}
    known = {source for item in items if item.get('kind') == 'audio_sources' for source in item.get('sourceIds', [])}
    result = []
    for item in items:
        if item.get('kind') != 'audio':
            continue
        source = by_source.get(item.get('sourceId'))
        if not source:
            continue
        params = decode(source.get('generation_params'), {})
        result.append({**source, 'generation_params': {**params, 'timeline': {
            name: item.get(name, 0) for name in ('startMs', 'durationMs', 'sourceOffsetMs', 'fadeInMs', 'fadeOutMs', 'volume')
        }}})
        known.add(item['sourceId'])
    result.extend(row for source, row in by_source.items() if source not in known)
    return result
