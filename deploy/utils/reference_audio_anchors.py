"""Normalize source-relative storyboard timing without trusting client media URLs."""
import math


def milliseconds(value, fallback=0):
    try:
        parsed = float(value)
        return max(0, min(3_600_000, round(parsed))) if math.isfinite(parsed) else fallback
    except (TypeError, ValueError):
        return fallback


def normalize_anchors(raw):
    if not isinstance(raw, list):
        return []
    if len(raw) > 128:
        raise ValueError('Too many storyboard audio anchors')
    result = []
    for item in raw:
        if not isinstance(item, dict) or not isinstance(item.get('itemId'), str):
            raise ValueError('Invalid storyboard audio anchor')
        result.append({'itemId': item['itemId'], 'sourceStartMs': milliseconds(item.get('sourceStartMs')),
                       'durationMs': max(100, milliseconds(item.get('durationMs'), 3000))})
    return sorted(result, key=lambda a: a['sourceStartMs'])


def reference_layers(anchors, rows):
    owned = {row['item_id']: row for row in rows}
    result = []
    for anchor in anchors:
        row = owned.get(anchor['itemId'])
        if row is None:
            raise ValueError('Referenced storyboard does not belong to this episode')
        urls = ([row['mixed_audio_url']] if row.get('mixed_audio_url') else
                list(dict.fromkeys(row[k] for k in ('dialogue_audio_url', 'narration_audio_url', 'sfx_audio_url') if row.get(k))))
        for url in urls:
            result.append({'audio_url': url, 'start_ms': anchor['sourceStartMs'],
                           'duration_ms': min(anchor['durationMs'], milliseconds(row.get('audio_duration_ms')) or anchor['durationMs'])})
    return result
