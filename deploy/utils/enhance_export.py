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


def plan_export(session, segments, files, items, storyboard_items=None):
    groups = session.get('task_groups') or []
    statuses = session.get('tasks_status') or {}
    by_id = {s['segment_id']: s for s in segments}
    shots = {s['item_id']: s for s in (storyboard_items or [])}
    images = {i.get('id'): i.get('storyboardItemId') for i in session.get('uploaded_images', [])}
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
        shot_ids = list(dict.fromkeys(images.get(i) or i for i in group.get('ids', [])))
        shot_ids = [i for i in shot_ids if i in shots]
        if not shot_ids and source.get('storyboard_item_id') in shots:
            shot_ids = [source['storyboard_item_id']]
        if shot_ids:
            weights = [max(100, int(shots[i].get('planned_duration_ms') or shots[i].get('audio_duration_ms') or 3000)) for i in shot_ids]
            total = sum(weights)
            elapsed = 0
            anchors = []
            for item_id, weight in zip(shot_ids, weights):
                start = round(duration * elapsed / total)
                elapsed += weight
                anchors.append({'itemId': item_id, 'sourceStartMs': start,
                                'durationMs': round(duration * elapsed / total) - start})
            selected[-1]['storyboardAnchors'] = anchors
        used.add(sid)
    if not selected:
        raise ValueError('没有已选择美化使用的视频')
    # Keep cuts/transitions for surviving sources, but never append obsolete merged cards.
    black_after = {}
    previous_cut = None
    for item in items:
        if item.get('kind') == 'video' and item.get('sourceId') in used:
            previous_cut = item.get('clipId') or item.get('sourceId')
        elif item.get('kind') == 'black':
            black_after.setdefault(previous_cut, []).append(item)
    result_items, cursor = [], 0
    def append_black(source_id):
        nonlocal cursor
        for original in black_after.get(source_id, []):
            black = {**original, 'startMs': cursor, 'durationMs': max(100, min(300000, int(original.get('durationMs') or 1000)))}
            result_items.append(black)
            cursor += black['durationMs']
    append_black(None)
    for selection in selected:
        sid = selection['segment_id']
        old_cuts = [i for i in items if i.get('kind') == 'video' and i.get('sourceId') == sid]
        for cut in old_cuts or [{'kind': 'video', 'clipId': sid, 'sourceId': sid}]:
            cut = dict(cut)
            offset = max(0, int(cut.get('sourceOffsetMs') or 0))
            maximum = selection['duration_ms']
            old_source_duration = cut.get('sourceDurationMs') or by_id[sid].get('duration_ms') or maximum
            full_source = offset == 0 and abs(int(cut.get('durationMs') or old_source_duration) - old_source_duration) <= 250
            different_source = cut.get('sourceUrl') and media_key(cut['sourceUrl']) != media_key(selection['video_url'])
            if full_source or different_source:
                offset = 0
                cut['durationMs'] = maximum
            if offset >= maximum:
                offset = 0
            duration = min(maximum - offset, max(100, int(cut.get('durationMs') or maximum)))
            cut.update(startMs=cursor, durationMs=duration, sourceOffsetMs=offset)
            cut.update(sourceDurationMs=maximum, sourceUrl=selection['video_url'])
            if 'storyboardAnchors' in selection:
                cut['storyboardAnchors'] = selection['storyboardAnchors']
            result_items.append(cut)
            cursor += duration
            if cut.get('transitionAfter') == 'black':
                cursor += max(100, min(3000, int(cut.get('transitionDurationMs') or 500)))
            append_black(cut.get('clipId') or sid)
    result_items.extend({'kind': 'excluded_video', 'sourceId': sid} for sid in by_id if sid not in used)
    # Reference speech is regenerated from the selected cuts. Global music and
    # effects remain independent edits and must never be reset by an export.
    for item in items:
        if item.get('kind') in ('video', 'excluded_video', 'black'):
            continue
        if item.get('kind') == 'audio' and str(item.get('sourceId', '')).startswith(('aud_sb_', 'aud_actor_')):
            continue
        if item.get('kind') == 'audio_sources':
            item = {**item, 'sourceIds': [s for s in item.get('sourceIds', []) if not s.startswith(('aud_sb_', 'aud_actor_'))]}
        result_items.append(item)
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
