import type { EnhanceMediaClip } from './enhanceSourceClips';

export interface StoryboardAudioAnchor {
  itemId: string;
  sourceStartMs: number;
  durationMs: number;
}

export function reanchorLinkedAudio(previous: EnhanceMediaClip[], next: EnhanceMediaClip[]): EnhanceMediaClip[] {
  const before = new Map(previous.filter(c => c.type === 'video').map(c => [c.id, c]));
  const after = new Map(next.filter(c => c.type === 'video').map(c => [c.id, c]));
  return next.flatMap(clip => {
    if (!clip.anchorVideoClipId) return [clip];
    const old = before.get(clip.anchorVideoClipId), current = after.get(clip.anchorVideoClipId);
    if (!old) return [clip];
    if (!current) return [];
    if (old.startTime === current.startTime && old.duration === current.duration && old.sourceOffset === current.sourceOffset) return [clip];
    const start = clip.startTime + current.startTime - old.startTime - (current.sourceOffset - old.sourceOffset);
    const left = Math.max(start, current.startTime);
    const end = Math.min(start + clip.duration, current.startTime + current.duration);
    return end > left ? [{ ...clip, startTime: left, duration: end - left, sourceOffset: clip.sourceOffset + left - start }] : [];
  });
}

export interface AudioAnchorVideoItem {
  kind?: string;
  sourceId?: string;
  clipId?: string;
  durationMs?: number;
  sourceOffsetMs?: number;
  transitionAfter?: string;
  transitionDurationMs?: number;
  storyboardAnchors?: StoryboardAudioAnchor[];
}

/** Reference speech follows the exported cuts, never historical segment sort order. */
export function storyboardAudioPositions(
  segments: { segmentId: string; storyboardItemId?: string | null; durationMs?: number | null }[],
  editorItems?: AudioAnchorVideoItem[],
) {
  const byId = new Map(segments.map(s => [s.segmentId, s]));
  const cuts = editorItems?.some(i => i.kind === 'video' || i.kind === 'black')
    ? editorItems.filter(i => i.kind === 'video' || i.kind === 'black')
    : segments.map(s => ({ sourceId: s.segmentId, durationMs: s.durationMs || 5000 } as AudioAnchorVideoItem));
  const positions = new Map<string, { startMs: number; sourceOffsetMs: number; durationMs: number; clipId: string }[]>();
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.kind === 'black') { cursor += Math.max(100, cut.durationMs || 1000); continue; }
    const source = byId.get(cut.sourceId || '');
    if (!source) continue;
    const duration = Math.max(100, cut.durationMs || source.durationMs || 5000);
    const offset = Math.max(0, cut.sourceOffsetMs || 0);
    const anchors = cut.storyboardAnchors ?? (source.storyboardItemId
      ? [{ itemId: source.storyboardItemId, sourceStartMs: 0, durationMs: source.durationMs || duration }] : []);
    for (const anchor of anchors) {
      const left = Math.max(offset, anchor.sourceStartMs);
      const right = Math.min(offset + duration, anchor.sourceStartMs + anchor.durationMs);
      if (right <= left) continue;
      const list = positions.get(anchor.itemId) || [];
      list.push({ startMs: cursor + left - offset, sourceOffsetMs: left - anchor.sourceStartMs,
        durationMs: right - left, clipId: cut.clipId || cut.sourceId || '' });
      positions.set(anchor.itemId, list);
    }
    cursor += duration + (cut.transitionAfter === 'black' ? cut.transitionDurationMs || 500 : 0);
  }
  return positions;
}
