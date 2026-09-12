import { expect, it } from 'vitest';
import { buildEnhanceSourceClips } from '../../utils/enhanceSourceClips';
import { restoreEnhanceTimeline, serializeEnhanceTimeline, composeTimelineItems } from '../../utils/enhanceTimelineEditor';

it('places all four merged-shot voices inside the selected video and preserves global music placement', () => {
  const segments: any[] = [{ segmentId: 'intro', durationMs: 5000, sortOrder: 0, videoUrl: '/intro.mp4' },
    { segmentId: 'merged', storyboardItemId: 'shot0', durationMs: 15000, sortOrder: 3, videoUrl: '/merged.mp4' },
    ...[1, 2, 3, 4].map(i => ({ segmentId: `old${i}`, storyboardItemId: `shot${i}`, durationMs: 6000, sortOrder: 3 + i, videoUrl: '/old.mp4' }))];
  const items: any[] = [{ kind: 'video', sourceId: 'intro', durationMs: 5000 }, { kind: 'video', sourceId: 'merged', durationMs: 15000,
    storyboardAnchors: [0, 1, 2, 3, 4].map(i => ({ itemId: `shot${i}`, sourceStartMs: i * 3000, durationMs: 3000 })) },
    ...[1, 2, 3, 4].map(i => ({ kind: 'excluded_video', sourceId: `old${i}` }))];
  const shots: any[] = [1, 2, 3, 4].map(i => ({ itemId: `shot${i}`, mixedAudioUrl: `/voice${i}.wav`, audioDurationMs: 2200 }));
  const music: any[] = [{ trackId: 'm', trackType: 'bgm', durationMs: 30000, audioUrl: '/music.mp3', generationParams: { timeline: { startMs: 36000, volume: .2 } } }];
  const source = buildEnhanceSourceClips(segments, shots, music, url => url, items);
  const restored = restoreEnhanceTimeline(source, items);
  expect(restored.filter(c => c.audioKind === 'voice').map(c => c.startTime)).toEqual([8, 11, 14, 17]);
  expect(restored.find(c => c.audioKind === 'bgm')).toMatchObject({ startTime: 36, volume: .2 });
  const roundtrip = restoreEnhanceTimeline(source, serializeEnhanceTimeline(restored, segments.map(s => s.segmentId)));
  expect(composeTimelineItems(roundtrip)[1].storyboard_anchors).toEqual(items[1].storyboardAnchors);
});

it('clips linked speech to a trimmed, duplicated source and counts black transitions', () => {
  const seg: any[] = [{ segmentId: 'v', storyboardItemId: 's', durationMs: 5000, sortOrder: 0, videoUrl: '/v' }];
  const source = buildEnhanceSourceClips(seg, [{ itemId: 's', mixedAudioUrl: '/a', audioDurationMs: 5000 }] as any, [], u => u,
    [{ kind: 'video', sourceId: 'v', clipId: 'a', sourceOffsetMs: 2000, durationMs: 2000, transitionAfter: 'black', transitionDurationMs: 500 },
      { kind: 'video', sourceId: 'v', clipId: 'b', durationMs: 3000 }]);
  expect(source.filter(c => c.type === 'audio').map(c => [c.startTime, c.duration, c.sourceOffset])).toEqual([[0, 2, 2], [2.5, 3, 0]]);
});
