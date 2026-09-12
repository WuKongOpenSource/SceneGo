import { expect, it } from 'vitest';
import { createBlackClip, insertBlackClip, moveTimelineClip, serializeEnhanceTimeline, restoreEnhanceTimeline, composeTimelineItems } from '../../utils/enhanceTimelineEditor';
import { reanchorLinkedAudio } from '../../utils/enhanceAudioAnchors';
import { buildSubtitleChunks } from '../../utils/subtitleTranscription';

it('inserts and moves black between videos without needing a generated file', () => {
  const videos: any[] = [0, 1].map(i => ({ id: `v${i}`, type: 'video', url: '/v', startTime: i * 5, duration: 5, sourceOffset: 0 }));
  const voice: any = { id: 'voice', type: 'audio', audioKind: 'voice', anchorVideoClipId: 'v1', url: '/a', startTime: 6, duration: 2, sourceOffset: 0 };
  const music: any = { ...voice, id: 'music', audioKind: 'bgm', anchorVideoClipId: undefined, startTime: 1 };
  const before = [...videos, voice, music];
  const clips = reanchorLinkedAudio(before, insertBlackClip(before, 'black_test', 5));
  expect(clips.find(c => c.id === 'v1')?.startTime).toBe(6);
  expect(clips.find(c => c.id === 'voice')?.startTime).toBe(7);
  expect(clips.find(c => c.id === 'music')?.startTime).toBe(1);
  const snapshot = serializeEnhanceTimeline(clips, ['v0', 'v1']);
  const restored = restoreEnhanceTimeline(before, snapshot);
  expect(restored.find(c => c.isBlack)).toMatchObject({ duration: 1, startTime: 5 });
  expect(composeTimelineItems(restored).find(c => c.is_black)).toMatchObject({ duration_ms: 1000, source_offset_ms: 0 });
  expect(buildSubtitleChunks(restored, 'video_original').map(c => c.timelineStartMs)).toEqual([0, 6000]);
  expect(moveTimelineClip(restored, 'black_test', 20, { ripple: true, snap: false }).clips.find(c => c.isBlack)?.startTime).toBe(10);
  expect(createBlackClip('x', 999).duration).toBe(300);
});
