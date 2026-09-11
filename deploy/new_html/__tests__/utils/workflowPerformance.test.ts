import { describe, expect, it } from 'vitest';
import { buildShotDurationIndex, resolveShotDurationMs } from '../../utils/audioTimeline';
import { overlapsTimelineWindow, timelineWindow } from '../../hooks/useTimelineViewport';
import type { StoryboardItemDB, AudioClipInfo } from '../../types';

describe('long-workflow performance budgets', () => {
  it('indexes audio once instead of scanning every clip for every shot', () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({
      itemId: `shot${i}`, plannedDurationMs: 5000, audioSegments: [],
    } as unknown as StoryboardItemDB));
    let reads = 0;
    const clips = items.flatMap(item => [0, 1].map(sequenceIndex => ({
      get itemId() { reads++; return item.itemId; },
      clipId: `${item.itemId}:${sequenceIndex}`, sequenceIndex,
      audioUrl: '/speech.wav', durationMs: 3000, text: '台词',
    } as AudioClipInfo)));
    const key = (clip: AudioClipInfo) => clip.clipId;
    const legacyStart = performance.now();
    const legacy = new Map(items.map(item => [item.itemId,
      resolveShotDurationMs({ item, clips, localAudio: {}, clipKeyFn: key })]));
    const legacyMs = performance.now() - legacyStart;
    const legacyReads = reads;
    reads = 0;
    const indexedStart = performance.now();
    const indexed = buildShotDurationIndex(items, clips, {}, key);
    const indexedMs = performance.now() - indexedStart;
    expect(indexed).toEqual(legacy);
    expect(reads).toBeLessThanOrEqual(clips.length * 4);
    expect(legacyReads).toBeGreaterThanOrEqual(items.length * clips.length);
    process.stdout.write(`workflow-duration-benchmark ${JSON.stringify({ shots: items.length, clips: clips.length,
      legacyReads, indexedReads: reads, legacyMs, indexedMs })}\n`);
  });

  it('bounds the visible timeline even for a multi-hour project', () => {
    const clips = Array.from({ length: 10000 }, (_, i) => ({ startTime: i * 5, duration: 5 }));
    const first = clips.filter(clip => overlapsTimelineWindow(clip, timelineWindow(0, 1200, 20)));
    const middle = clips.filter(clip => overlapsTimelineWindow(clip, timelineWindow(50000, 1200, 20)));
    expect(first.length).toBeLessThanOrEqual(21);
    expect(middle.length).toBeLessThanOrEqual(22);
    expect(middle[0].startTime).toBeGreaterThan(2400);
    expect(timelineWindow(10, 1200, 20)).toEqual(timelineWindow(20, 1200, 20));
  });
});
