"""Group actual ASR word clocks into readable subtitle cues."""
import math
import re
import unicodedata


def _join(left, right):
    space = ' ' if re.search(r'[A-Za-z0-9][,.;:!?]?$', left) and re.match(r'[A-Za-z0-9]', right) else ''
    return left + space + right


def word_timestamps_to_cues(body, duration_ms):
    rows = body.get('words') if isinstance(body, dict) else None
    if not isinstance(rows, list) or len(rows) > 5000:
        raise ValueError('Missing word clocks')
    if not rows:
        if str(body.get('text') or '').strip():
            raise ValueError('Text without word clocks')
        return []
    words, previous_end = [], 0
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('Invalid word row')
        start, end, text = row.get('start'), row.get('end'), row.get('word')
        if (type(start) not in (int, float) or type(end) not in (int, float)
                or not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start
                or end * 1000 > duration_ms + 150 or not isinstance(text, str) or not text.strip() or len(text) > 500):
            raise ValueError('Invalid word clock')
        start, end = round(start * 1000), min(duration_ms, round(end * 1000))
        if start < previous_end - 40 or end < previous_end or start > end:
            raise ValueError('Out of order word clock')
        words.append({'start_ms': max(start, previous_end), 'end_ms': end, 'text': text.strip()})
        previous_end = end
    # Punctuation may be restored only when the transcript has identical letters.
    significant = lambda c: unicodedata.category(c)[0] in ('L', 'N')
    letters = lambda text: ''.join(c for c in text if significant(c))
    transcript = body.get('text')
    if isinstance(transcript, str) and all(letters(w['text']) for w in words) and letters(transcript) == letters(''.join(w['text'] for w in words)):
        cursor = 0
        for word in words:
            count = len(letters(word['text']))
            if not count:
                continue
            while cursor < len(transcript) and not significant(transcript[cursor]):
                cursor += 1
            start = cursor
            while cursor < len(transcript) and count:
                count -= int(significant(transcript[cursor]))
                cursor += 1
            while cursor < len(transcript) and not significant(transcript[cursor]):
                cursor += 1
            word['text'] = transcript[start:cursor].strip()
    timed, pending = [], ''
    for word in words:
        if word['end_ms'] == word['start_ms']:
            if timed:
                timed[-1]['text'] = _join(timed[-1]['text'], word['text'])
            else:
                pending = _join(pending, word['text'])
        else:
            if pending:
                word['text'], pending = _join(pending, word['text']), ''
            timed.append(word)
    if not timed:
        raise ValueError('No timed words')
    silent_regions = []
    for segment in body.get('segments') or []:
        if not isinstance(segment, dict):
            continue
        start, end, probability = segment.get('start'), segment.get('end'), segment.get('no_speech_prob')
        if all(type(value) in (int, float) and math.isfinite(value) for value in (start, end, probability)) and probability >= 0.6:
            silent_regions.append((start * 1000, end * 1000))
    cues, current = [], None
    for word in timed:
        if any(start <= word['start_ms'] and end >= word['end_ms'] for start, end in silent_regions):
            continue
        merged = _join(current['text'], word['text']) if current else word['text']
        limit = 24 if re.search(r'[\u3400-\u9fff]', merged) else 48
        if current and (word['start_ms'] - current['end_ms'] >= 320 or len(merged) > limit or word['end_ms'] - current['start_ms'] > 4000):
            cues.append(current)
            current = None
        current = {**current, 'text': _join(current['text'], word['text']), 'end_ms': word['end_ms']} if current else dict(word)
        if re.search(r'[。！？!?；;.]$', word['text']) or (len(current['text']) >= 8 and re.search(r'[，,]$', word['text'])):
            cues.append(current)
            current = None
    if current:
        cues.append(current)
    return cues
